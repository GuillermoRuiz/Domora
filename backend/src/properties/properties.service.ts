import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { DebtorsService } from '../debtors/debtors.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreatePropertyDto,
  UpdatePropertyDto,
} from './dto/properties.dto';
import type { CreateEstateOnboardingRequestDto } from './dto/create-estate-onboarding-request.dto';
import type { ResolveEstateOnboardingRequestDto } from './dto/resolve-estate-onboarding-request.dto';
import type { CreateEstatePropertyDto } from './dto/create-estate-property.dto';
import type { Property } from '../prisma/client';
import {
  ESTATE_PRIVATE_OMIT,
  USER_SECRETS_OMIT,
  withoutManagerOnlyFields,
} from '../common/secret-omit';

export interface CoefficientAreaPreviewRow {
  propertyId: string;
  ref: string | null;
  type: string;
  builtAreaM2: number;
  currentQuota: number | null;
  proposedQuota: number;
}

export interface CoefficientAreaPreview {
  rows: CoefficientAreaPreviewRow[];
  /** Si hay alguna, `rows` viene vacío — no se reparte sobre un subconjunto. */
  missingArea: { propertyId: string; ref: string | null; type: string }[];
}

/** 100.00 % expresado en centésimas de punto porcentual (2 decimales). */
const QUOTA_HUNDREDTHS = 10_000;

/**
 * Reparte 100.00% proporcional al área entre propiedades con el método del
 * resto mayor (Hamilton), para que la suma redondeada a 2 decimales dé
 * EXACTAMENTE 100.00 — redondear cada fila de forma independiente puede
 * dejar la suma en 99.99 o 100.01 por arrastre de redondeo, justo el
 * problema que esta función existe para evitar.
 */
function distributeQuotaByArea(
  properties: { id: string; area: number }[],
  totalArea: number,
): { id: string; quota: number }[] {
  const shares = properties.map((p) => {
    const hundredths = (p.area / totalArea) * QUOTA_HUNDREDTHS;
    const floor = Math.floor(hundredths);
    return { id: p.id, floor, remainder: hundredths - floor };
  });
  const assigned = shares.reduce((acc, s) => acc + s.floor, 0);
  const deficit = QUOTA_HUNDREDTHS - assigned;
  const bumped = new Set(
    [...shares]
      .sort((a, b) => b.remainder - a.remainder)
      .slice(0, deficit)
      .map((s) => s.id),
  );
  return shares.map((s) => ({
    id: s.id,
    quota: (s.floor + (bumped.has(s.id) ? 1 : 0)) / 100,
  }));
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly debtors: DebtorsService,
    private readonly notifications: NotificationsService,
    private readonly propertyAccess: PropertyAccessService,
  ) {}

  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const properties = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null },
    });
    return properties.sort((a, b) =>
      `${a.staircase ?? ''}${a.floor ?? ''}${a.door ?? ''}`.localeCompare(
        `${b.staircase ?? ''}${b.floor ?? ''}${b.door ?? ''}`,
      ),
    );
  }

  /**
   * Emails de los propietarios vinculados de una finca — usado para
   * autocompletar "asistentes" al convocar una junta (equivalente a
   * `useOwnerEmails` del original React).
   */
  async listOwnerEmails(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { status: 'linked', property: { estateId, deletedAt: null } },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });
    const byEmail = new Map<
      string,
      { userId: string; fullName: string; isOwner: boolean }
    >();
    for (const m of memberships) {
      if (!m.user?.email) continue;
      const isOwner =
        m.roleType === 'Propietario' || m.roleType === 'Representante';
      const known = byEmail.get(m.user.email);
      byEmail.set(m.user.email, {
        userId: m.user.id,
        fullName: m.user.fullName,
        isOwner: isOwner || !!known?.isOwner,
      });
    }
    return [...byEmail.entries()].map(
      ([email, { userId, fullName, isOwner }]) => ({
        email,
        userId,
        fullName,
        isOwner,
      }),
    );
  }

  private async findRawById(id: string, user: AuthenticatedUser) {
    const property = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${id} no encontrada.`);
    }
    // Por PROPIEDAD para el rol C, no por finca — ver PropertyAccessService.
    // Antes esta comprobación era solo por finca para los tres roles, así
    // que un propietario con una sola propiedad en una comunidad de varias
    // unidades podía consultar el saldo de cualquier vecino con solo pedir
    // `GET properties/:id` con su id (`findById`/`resolvePropertyView`
    // exponen `balance`/`advance`) — ver discovery_property_scope_leak.md.
    await this.propertyAccess.assertAccess(property, user);
    return property;
  }

  /**
   * `balance` no vive en `Property` — se calcula al vuelo sumando recibos
   * pendientes/devueltos (`DebtorsService.computePropertyBalance`), mismo
   * criterio que el saldo por vecino del administrador (`computeBalances`)
   * pero en negativo, para cuadrar con la convención "saldo de cuenta" que
   * ya usa `property-detail.component.ts` (`balance < 0` = deuda).
   *
   * `advance` viaja aparte y nunca se resta de `balance`: es dinero cobrado
   * que todavía no se imputó a ningún recibo. Restarlo automáticamente
   * daría un saldo que nadie decidió — aplicarlo es una acción explícita
   * de la gestora (`POST advances/apply`). Ver doc/contabilidad/adr-partida-doble.md.
   */
  async findById(id: string, user: AuthenticatedUser) {
    const property = await this.findRawById(id, user);
    const [balance, advance] = await Promise.all([
      this.debtors.computePropertyBalance(id),
      this.debtors.computePropertyAdvance(id),
    ]);
    return { ...property, balance, advance };
  }

  /**
   * Alta directa dentro de una finca ya gestionada (botón "Nueva
   * propiedad" en estate-detail) — sin AdhesionRequest, sin titular
   * todavía (`primaryUserId` queda null hasta que alguien se vincule).
   * `EstateScopeGuard` + `@Roles('A','B')` en el controller ya garantizan
   * que solo la gestora dueña de la finca (o rol A) llega hasta acá.
   */
  async createForEstate(
    estateId: string,
    dto: CreateEstatePropertyDto,
  ): Promise<Property> {
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }
    return this.prisma.property.create({
      data: {
        estateId,
        administratorId: estate.administratorId,
        type: dto.type,
        status: 'Vacio',
        viaType: dto.viaType,
        viaName: dto.viaName,
        streetNumber: dto.streetNumber,
        staircase: dto.staircase,
        floor: dto.floor,
        door: dto.door,
        municipality: dto.municipality,
        province: dto.province,
        country: 'ES',
        quotaMonthly: dto.quotaMonthly ?? 0,
        participationQuota: dto.participationQuota ?? null,
        builtAreaM2: dto.builtAreaM2 ?? null,
      },
    });
  }

  /**
   * Previsualiza el coeficiente de participación que le tocaría a cada
   * propiedad si se reparte 100% proporcional a la superficie construida
   * (LPH art. 5: el coeficiente se fija en relación a la superficie útil
   * respecto del total del edificio — no es un dato independiente). No
   * escribe nada. Si falta la superficie de alguna propiedad activa, no
   * calcula nada y devuelve cuáles faltan: repartir sobre un subconjunto
   * daría coeficientes que no significan lo que dicen significar.
   */
  async previewQuotasByArea(estateId: string): Promise<CoefficientAreaPreview> {
    const properties = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null },
      select: {
        id: true,
        ref: true,
        type: true,
        builtAreaM2: true,
        participationQuota: true,
      },
    });
    if (properties.length === 0) {
      throw new NotFoundException('La finca no tiene propiedades.');
    }

    const missingArea = properties.filter((p) => p.builtAreaM2 == null);
    if (missingArea.length > 0) {
      return {
        rows: [],
        missingArea: missingArea.map((p) => ({
          propertyId: p.id,
          ref: p.ref,
          type: p.type,
        })),
      };
    }

    const withArea = properties.map((p) => ({
      ...p,
      area: Number(p.builtAreaM2),
    }));
    const totalArea = withArea.reduce((acc, p) => acc + p.area, 0);
    const proposed = new Map(
      distributeQuotaByArea(
        withArea.map((p) => ({ id: p.id, area: p.area })),
        totalArea,
      ).map((p) => [p.id, p.quota]),
    );

    return {
      rows: withArea.map((p) => ({
        propertyId: p.id,
        ref: p.ref,
        type: p.type,
        builtAreaM2: p.area,
        currentQuota:
          p.participationQuota != null ? Number(p.participationQuota) : null,
        proposedQuota: proposed.get(p.id)!,
      })),
      missingArea: [],
    };
  }

  /**
   * Aplica el reparto de `previewQuotasByArea` — SIEMPRE lo recalcula de
   * nuevo acá (no confía en lo que mande el cliente): entre que el admin
   * ve el preview y confirma puede haber pasado cualquier cosa (alguien
   * más edita una propiedad, importa del Catastro, etc.).
   */
  async applyQuotasByArea(estateId: string): Promise<Property[]> {
    const preview = await this.previewQuotasByArea(estateId);
    if (preview.missingArea.length > 0) {
      throw new ConflictException(
        `${preview.missingArea.length} propiedad(es) sin superficie construida: complétala antes de recalcular.`,
      );
    }
    return this.prisma.$transaction(
      preview.rows.map((r) =>
        this.prisma.property.update({
          where: { id: r.propertyId },
          data: { participationQuota: r.proposedQuota },
        }),
      ),
    );
  }

  /**
   * Proyección de lectura descrita en docs/data-model.md Apéndice D — nunca
   * se persiste, se resuelve con JOINs en el momento de la consulta, igual
   * que `DataService.resolvePropertyView` en el mock Angular.
   */
  async resolvePropertyView(
    id: string,
    user: AuthenticatedUser,
    viewerUserId?: string,
  ) {
    const raw = await this.findRawById(id, user);
    // Mismo saldo (y mismo anticipo) que `findById`: el panel del
    // propietario (dashboard-c) lo lee de aquí.
    const [balance, advance] = await Promise.all([
      this.debtors.computePropertyBalance(id),
      this.debtors.computePropertyAdvance(id),
    ]);
    const property = { ...raw, balance, advance };

    const estateRow = property.estateId
      ? await this.prisma.estate.findFirst({
          where: { id: property.estateId },
          omit: ESTATE_PRIVATE_OMIT,
        })
      : null;
    const estate = estateRow
      ? withoutManagerOnlyFields(estateRow, user.role)
      : null;

    const administrator = estate
      ? await this.prisma.administrator.findFirst({
          where: { id: estate.administratorId },
          // Solo datos de contacto: la fila completa trae plan, MRR, descuentos, notas y motivo de bloqueo.
          select: {
            id: true,
            name: true,
            phone: true,
            contactName: true,
            contactEmail: true,
            primaryUser: {
              select: { id: true, fullName: true, email: true, phone: true },
            },
          },
        })
      : null;

    const memberships = await this.prisma.propertyMembership.findMany({
      where: { propertyId: id, revokedAt: null },
      // El NIF de los demás titulares no es para el propietario.
      include: {
        user: {
          omit:
            user.role === 'C'
              ? { ...USER_SECRETS_OMIT, taxId: true, taxIdCountry: true }
              : USER_SECRETS_OMIT,
        },
      },
    });

    const membership =
      (viewerUserId && memberships.find((m) => m.userId === viewerUserId)) ||
      memberships.find((m) => m.isPrimaryContact) ||
      null;

    const addressFull = [
      property.viaType,
      property.viaName,
      property.streetNumber,
      property.staircase && `esc. ${property.staircase}`,
      property.floor && `${property.floor}º`,
      property.door,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      property,
      estate,
      admin: administrator,
      adminContact: administrator?.primaryUser ?? null,
      membership,
      estateName: estate?.name ?? null,
      adminName: administrator?.name ?? null,
      adminContactName: administrator?.primaryUser?.fullName ?? null,
      nickname: membership?.nickname ?? property.type ?? null,
      viewerRoleType: membership?.roleType ?? null,
      isLinked: membership?.status === 'linked',
      linkageStatus: membership?.status ?? null,
      addressFull,
    };
  }

  /**
   * Alta de propiedad por su propietario (rol C). La propiedad se crea
   * siempre desvinculada (`estateId: null`) — si se indica `estateId`, en
   * la misma transacción se abre una `AdhesionRequest` a esa finca, que un
   * rol B deberá aprobar (AdhesionRequestsService.approve) para que la
   * propiedad quede realmente vinculada a la gestora. La membresía del
   * creador se crea ya mismo: `linked` si no hay finca que aprobar (predio
   * privado, sin gestora), `pending` si hay una solicitud de adhesión en
   * curso.
   */
  async create(
    dto: CreatePropertyDto,
    user: AuthenticatedUser,
  ): Promise<Property> {
    const estate = dto.estateId
      ? await this.prisma.estate.findFirst({
          where: { id: dto.estateId, deletedAt: null },
        })
      : null;
    if (dto.estateId && !estate) {
      throw new NotFoundException(`Finca ${dto.estateId} no encontrada.`);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          type: dto.type,
          status: 'Ocupado',
          viaType: dto.viaType,
          viaName: dto.viaName,
          streetNumber: dto.streetNumber,
          staircase: dto.staircase,
          floor: dto.floor,
          door: dto.door,
          municipality: dto.municipality,
          province: dto.province,
          country: dto.country ?? 'ES',
          primaryUserId: user.id,
        },
      });

      await tx.propertyMembership.create({
        data: {
          propertyId: property.id,
          userId: user.id,
          roleType: dto.roleType,
          status: dto.estateId ? 'pending' : 'linked',
          isPrimaryContact: true,
          linkedAt: new Date(),
        },
      });

      if (dto.estateId) {
        const existing = await tx.adhesionRequest.count({
          where: { userId: user.id, estateId: dto.estateId, status: 'pending' },
        });
        if (existing > 0) {
          throw new ConflictException(
            'Ya existe una solicitud de adhesión pendiente para esta finca.',
          );
        }
        await tx.adhesionRequest.create({
          data: {
            estateId: dto.estateId,
            propertyId: property.id,
            userId: user.id,
            roleType: dto.roleType,
            submittedAt: new Date(),
            status: 'pending',
          },
        });
      }

      return property;
    });

    if (estate) {
      await this.notifyAdhesionRequested(estate, created.id, user);
    }
    return created;
  }

  /** Avisa a la gestora de la finca de que hay una solicitud de adhesión que resolver. */
  private async notifyAdhesionRequested(
    estate: { id: string; name: string },
    propertyId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const [requester, managerIds] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true },
      }),
      this.notifications.managerIdsOfEstate(estate.id),
    ]);
    await this.notifications.notify({
      userIds: managerIds,
      category: 'adhesion',
      title: 'Nueva solicitud de adhesión',
      body: `${requester?.fullName ?? 'Un usuario'} solicita unirse a ${estate.name}.`,
      link: `/b/estates/${estate.id}?tab=requests`,
      estateId: estate.id,
      propertyId,
    });
  }

  async update(
    id: string,
    dto: UpdatePropertyDto,
    user: AuthenticatedUser,
  ): Promise<Property> {
    const property = await this.findRawById(id, user);
    this.assertOwnerOrAdmin(property, user);
    // `!== undefined` (no truthiness): `null` es "borrar el coeficiente" y
    // `0` un valor válido — ambos deben pasar por esta comprobación igual
    // que cualquier otro valor.
    if (
      dto.participationQuota !== undefined &&
      !this.isManagerOf(property, user)
    ) {
      throw new ForbiddenException(
        'Solo la gestora de la finca puede modificar el coeficiente de participación.',
      );
    }
    if (dto.quotaMonthly !== undefined && !this.isManagerOf(property, user)) {
      throw new ForbiddenException(
        'Solo la gestora de la finca puede modificar la cuota mensual.',
      );
    }
    if (dto.builtAreaM2 !== undefined && !this.isManagerOf(property, user)) {
      throw new ForbiddenException(
        'Solo la gestora de la finca puede modificar la superficie construida.',
      );
    }
    return this.prisma.property.update({ where: { id }, data: { ...dto } });
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const property = await this.findRawById(id, user);
    this.assertOwnerOrAdmin(property, user);
    await this.prisma.property.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Cola de revisión manual para altas de comunidad NUEVA (sin gestora ni
   * Estate todavía) — a diferencia de `create()` con `estateId`, que abre
   * una `AdhesionRequest` a una finca YA existente. Ningún rol C puede
   * crear una finca directamente (decisión de producto, ver
   * doc/frontend-zoneless-audit-guide.md §5.2): esto solo dispara una
   * notificación para que soporte la dé de alta a mano.
   */
  async createOnboardingRequest(
    dto: CreateEstateOnboardingRequestDto,
    user: AuthenticatedUser,
  ) {
    if (dto.propertyId) {
      await this.findRawById(dto.propertyId, user);
    }
    const pendingCount = await this.prisma.estateOnboardingRequest.count({
      where: { requestedByUserId: user.id, status: 'pending' },
    });
    if (pendingCount >= 3) {
      throw new ConflictException(
        'Ya tienes 3 solicitudes de alta pendientes. Espera a que se resuelvan antes de enviar una nueva.',
      );
    }
    const request = await this.prisma.estateOnboardingRequest.create({
      data: {
        requestedByUserId: user.id,
        propertyId: dto.propertyId,
        communityName: dto.communityName,
        communityAddress: dto.communityAddress,
        adminName: dto.adminName,
        adminEmail: dto.adminEmail,
        status: 'pending',
        // The despacho named in the request is a potential client of Domora:
        // its lead (origin «Solicitud de alta de comunidad») is created with
        // the request, in the same statement (odd/tasks/role-a-panel.md S13).
        lead: {
          create: {
            name: (
              dto.adminName?.trim() || `Administración de ${dto.communityName}`
            ).slice(0, 200),
            contactEmail: dto.adminEmail?.trim()
              ? dto.adminEmail.trim().slice(0, 200)
              : null,
            origin: 'solicitud_alta',
          },
        },
      },
    });
    await this.notifications.notify({
      userIds: await this.notifications.supportIds(),
      category: 'onboarding',
      title: 'Nueva solicitud de alta de comunidad',
      body: dto.communityName,
      link: '/a/admins',
    });
    return request;
  }

  /** Listado para el equipo de soporte (rol A) — sin flujo de aprobación automático. */
  async listOnboardingRequests(user: AuthenticatedUser) {
    if (user.role !== 'A') {
      throw new ForbiddenException(
        'Solo el equipo de soporte puede ver esta cola.',
      );
    }
    return this.prisma.estateOnboardingRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { requestedByUser: { select: { fullName: true, email: true } } },
    });
  }

  /**
   * Marca una solicitud como atendida ('contacted') o descartada
   * ('dismissed') — sigue sin dar de alta la finca automáticamente, eso
   * lo hace soporte a mano desde fuera de la app (ver createOnboardingRequest).
   */
  async resolveOnboardingRequest(
    id: string,
    dto: ResolveEstateOnboardingRequestDto,
    user: AuthenticatedUser,
  ) {
    if (user.role !== 'A') {
      throw new ForbiddenException(
        'Solo el equipo de soporte puede resolver esta cola.',
      );
    }
    const request = await this.prisma.estateOnboardingRequest.findFirst({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException(`Solicitud ${id} no encontrada.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.estateOnboardingRequest.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
        },
      });
      // Its lead moves along only while nobody has worked it yet (S13).
      await tx.lead.updateMany({
        where: { onboardingRequestId: id, status: 'nuevo' },
        data: {
          status: dto.status === 'contacted' ? 'contactado' : 'descartado',
        },
      });
      return updated;
    });
  }

  /** Rol A, o rol B de la gestora que administra esta propiedad. */
  private isManagerOf(property: Property, user: AuthenticatedUser): boolean {
    if (user.role === 'A') return true;
    return (
      user.role === 'B' &&
      !!user.administratorId &&
      property.administratorId === user.administratorId
    );
  }

  /** Solo el propietario (primaryUserId), su gestora, o un rol A pueden mutar la propiedad. */
  private assertOwnerOrAdmin(
    property: Property,
    user: AuthenticatedUser,
  ): void {
    if (this.isManagerOf(property, user)) return;
    if (property.primaryUserId === user.id) return;
    throw new ForbiddenException(
      'No tienes permiso para modificar esta propiedad.',
    );
  }
}
