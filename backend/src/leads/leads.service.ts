import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type EstateOnboardingStatus, type LeadOrigin, type LeadStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins/admins.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ConvertLeadDto, CreateFollowUpDto, CreateLeadDto, UpdateLeadDto } from './dto/leads.dto';

export const LEAD_ORIGIN_LABEL: Record<LeadOrigin, string> = {
  web: 'Web',
  referido: 'Referido',
  comercial: 'Comercial',
  solicitud_alta: 'Solicitud de alta de comunidad',
};

/** Lead statuses that resolve the community request the lead came from. */
const REQUEST_RESOLUTION: Partial<Record<LeadStatus, Exclude<EstateOnboardingStatus, 'pending'>>> = {
  contactado: 'contacted',
  en_prueba: 'contacted',
  convertido: 'contacted',
  descartado: 'dismissed',
};

const LIST_INCLUDE = {
  onboardingRequest: {
    select: { id: true, communityName: true, communityAddress: true, status: true, requestedByUser: { select: { fullName: true } } },
  },
  convertedAdministrator: { select: { id: true, name: true } },
  followUps: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
  _count: { select: { followUps: true } },
} satisfies Prisma.LeadInclude;

type LeadFields = Partial<
  Pick<Prisma.LeadUncheckedCreateInput, 'contactName' | 'contactEmail' | 'contactPhone' | 'city' | 'planOfInterest' | 'nextAction' | 'nextActionAt' | 'notes'>
>;

type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof LIST_INCLUDE }>;

const dateOnly = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value.slice(0, 10));

/**
 * Potential clients of Domora and their «seguimiento comercial»
 * (odd/tasks/role-a-panel.md S13). A lead converts into the despacho through
 * `AdminsService.create`, the only creation path, so Clientes and
 * Administradores de fincas keep one record.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admins: AdminsService,
  ) {}

  async list() {
    const leads = await this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, include: LIST_INCLUDE });
    return leads.map((l) => this.toView(l));
  }

  async get(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, include: LIST_INCLUDE });
    if (!lead) throw new NotFoundException('Oportunidad no encontrada.');
    const followUps = await this.prisma.commercialFollowUp.findMany({
      where: { leadId: id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: { authorUser: { select: { fullName: true } } },
    });
    return {
      ...this.toView(lead),
      followUps: followUps.map((f) => ({
        id: f.id,
        occurredAt: f.occurredAt,
        text: f.text,
        author: f.authorUser?.fullName ?? 'Sistema',
      })),
    };
  }

  async create(dto: CreateLeadDto, _user: AuthenticatedUser) {
    if (dto.origin === 'solicitud_alta') {
      throw new BadRequestException('Las oportunidades con origen «Solicitud de alta de comunidad» se crean solas al recibir la solicitud.');
    }
    const lead = await this.prisma.lead.create({
      data: { ...this.fields(dto), name: dto.name, origin: dto.origin },
      include: LIST_INCLUDE,
    });
    return this.toView(lead);
  }

  async update(id: string, dto: UpdateLeadDto, user: AuthenticatedUser) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Oportunidad no encontrada.');
    if (lead.status === 'convertido') {
      throw new ConflictException('Esta oportunidad ya es cliente: sigue su relación desde su ficha.');
    }
    if (dto.status === 'convertido') {
      throw new BadRequestException('Para marcarla como convertida, usa «Convertir en cliente».');
    }
    if (dto.origin === 'solicitud_alta' && lead.origin !== 'solicitud_alta') {
      throw new BadRequestException('El origen «Solicitud de alta de comunidad» no se puede asignar a mano.');
    }
    if (dto.origin && lead.origin === 'solicitud_alta' && dto.origin !== 'solicitud_alta') {
      throw new BadRequestException('Esta oportunidad viene de una solicitud de alta de comunidad: su origen no se cambia.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Conditional: a conversion that lands in between is never overwritten.
      const { count } = await tx.lead.updateMany({
        where: { id, status: { not: 'convertido' } },
        data: {
          ...this.fields(dto),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.origin !== undefined ? { origin: dto.origin } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      if (count !== 1) throw new ConflictException('Esta oportunidad ya es cliente: sigue su relación desde su ficha.');
      if (dto.status && lead.onboardingRequestId) {
        await this.resolveRequest(tx, lead.onboardingRequestId, dto.status, user);
      }
    });
    return this.toView(await this.reload(id));
  }

  async addFollowUp(id: string, dto: CreateFollowUpDto, user: AuthenticatedUser) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!lead) throw new NotFoundException('Oportunidad no encontrada.');
    const row = await this.prisma.commercialFollowUp.create({
      data: {
        leadId: id,
        authorUserId: user.id,
        text: dto.text,
        ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
      },
      include: { authorUser: { select: { fullName: true } } },
    });
    return { id: row.id, occurredAt: row.occurredAt, text: row.text, author: row.authorUser?.fullName ?? 'Sistema' };
  }

  /**
   * The lead becomes the despacho (S13: when its trial starts, or when it
   * contracts without trial). One transaction: the despacho, its billing
   * data, the signup entry of its activity (noting the conversion) and the
   * link on the lead are written together or not at all.
   */
  async convert(id: string, dto: ConvertLeadDto, user: AuthenticatedUser) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Oportunidad no encontrada.');
    if (lead.status === 'convertido' || lead.convertedAdministratorId) {
      throw new ConflictException('Esta oportunidad ya se convirtió en cliente.');
    }
    const plan = dto.plan ?? lead.planOfInterest;
    if (!plan) throw new BadRequestException('Elige el plan con el que empieza el cliente.');

    const admin = await this.admins.create(
      {
        name: dto.name ?? lead.name,
        cif: dto.cif.trim(),
        plan,
        contactName: dto.contactName ?? lead.contactName ?? undefined,
        contactEmail: dto.contactEmail ?? lead.contactEmail ?? undefined,
        phone: dto.phone ?? lead.contactPhone ?? undefined,
      },
      user,
      {
        signupNote: `convertida desde oportunidad (${LEAD_ORIGIN_LABEL[lead.origin]})`,
        afterCreate: async (tx, created) => {
          // Conditional on the lead still being open: two concurrent conversions cannot both link it.
          const { count } = await tx.lead.updateMany({
            where: { id, convertedAdministratorId: null, status: { not: 'convertido' } },
            data: { status: 'convertido', convertedAdministratorId: created.id, convertedAt: new Date() },
          });
          if (count !== 1) throw new ConflictException('Esta oportunidad ya se convirtió en cliente.');
          if (lead.onboardingRequestId) await this.resolveRequest(tx, lead.onboardingRequestId, 'convertido', user);
        },
      },
    );
    return { administratorId: admin.id, lead: this.toView(await this.reload(id)) };
  }

  private async reload(id: string): Promise<LeadWithRelations> {
    return this.prisma.lead.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE });
  }

  /** Resolves the still-pending community request of a lead that is being worked. */
  private async resolveRequest(tx: Prisma.TransactionClient, requestId: string, status: LeadStatus, user: AuthenticatedUser) {
    const resolution = REQUEST_RESOLUTION[status];
    if (!resolution) return;
    await tx.estateOnboardingRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: resolution, resolvedAt: new Date(), resolvedByUserId: user.id },
    });
  }

  private fields(dto: CreateLeadDto | UpdateLeadDto): LeadFields {
    const data: LeadFields = {};
    const text = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
    if (dto.contactName !== undefined) data.contactName = text(dto.contactName);
    if (dto.contactEmail !== undefined) data.contactEmail = text(dto.contactEmail);
    if (dto.contactPhone !== undefined) data.contactPhone = text(dto.contactPhone);
    if (dto.city !== undefined) data.city = text(dto.city);
    if (dto.planOfInterest !== undefined) data.planOfInterest = dto.planOfInterest;
    if (dto.nextAction !== undefined) data.nextAction = text(dto.nextAction);
    if (dto.nextActionAt !== undefined) data.nextActionAt = dateOnly(dto.nextActionAt);
    if (dto.notes !== undefined) data.notes = text(dto.notes);
    return data;
  }

  private toView(lead: LeadWithRelations) {
    const { onboardingRequest, convertedAdministrator, followUps, _count, ...rest } = lead;
    return {
      ...rest,
      nextActionAt: rest.nextActionAt ? rest.nextActionAt.toISOString().slice(0, 10) : null,
      onboardingRequest: onboardingRequest
        ? {
            id: onboardingRequest.id,
            communityName: onboardingRequest.communityName,
            communityAddress: onboardingRequest.communityAddress,
            requestedByName: onboardingRequest.requestedByUser.fullName,
            status: onboardingRequest.status,
          }
        : null,
      convertedAdministrator,
      followUpCount: _count.followUps,
      lastFollowUpAt: followUps[0]?.occurredAt ?? null,
    };
  }
}
