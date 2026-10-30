import { issuesOfEstate } from '../issues/issue-estate';
import { documentVisibleWhere } from '../documents/document-access.service';
import { documentMime, mimeFromKey } from '../documents/file-signature';
import { executedByAccount, executedByCostCentre } from '../ledger/executed';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../prisma/client';
import type {
  AlertSourceType,
  Communication,
  CommunicationCategory,
  TimelineAuthorRole,
} from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  AddCommunicationReplyDto,
  CreateCommunicationDto,
  CreateDocumentDto,
  UpdateCommunicationDto,
} from './dto/resources.dto';
import { MEMBERSHIP_SETTINGS_DEFAULTS } from '../property-memberships/membership-settings.defaults';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { type PageParams, resolvePage, toPage } from '../common/pagination';
import { ownerEstateSectionLink, ownerPropertyLink } from '../common/owner-links';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const LEGAL_NOTICE_EFFECTIVE_MS = 3 * 24 * 60 * 60 * 1000;

export interface AlertItem {
  id: string;
  sourceType: AlertSourceType;
  sourceId: string;
  type: 'pago' | 'incidencia' | 'junta' | 'documento' | 'comunidad' | 'proveedor' | 'presupuesto';
  title: string;
  description: string;
  date: string;
  urgent: boolean;
  propertyId?: string | null;
  /** Solo poblado en el feed de rol B — deep-link a estate-detail/accounting-detail sin depender de propertyId. */
  estateId?: string | null;
  read: boolean;
}

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly currentAuthorization: RagAuthorizationService,
  ) {}

  private frontendBaseUrl(): string {
    const raw = this.config.get<string>('CORS_ORIGIN') ?? 'http://localhost:4200';
    return raw.split(',')[0].trim();
  }

  private authorRoleFor(user: AuthenticatedUser): TimelineAuthorRole {
    return user.role === 'C' ? 'Propietario' : 'Administrador';
  }

  /** Propiedades con membresía `linked` del usuario (alcance del feed). */
  private async linkedPropertyIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { userId, status: 'linked', revokedAt: null },
      select: { propertyId: true },
    });
    return memberships.map((m) => m.propertyId);
  }

  /**
   * Preferencias de notificación por propiedad, para filtrar el feed de
   * alertas (Apéndice de privacidad por membresía). `byEstate` agrega "algún
   * vínculo del usuario en esa finca permite comunicados" — necesario
   * porque comunicados/documentos/eventos son de finca, no de propiedad
   * concreta, y un usuario puede tener varias membresías en la misma finca.
   */
  private async notificationPrefsByProperty(userId: string): Promise<{
    byProperty: Map<string, { notifyReceipts: string; notifyIssues: string }>;
    estatesAllowingCommunications: Set<string>;
    /** Fincas en las que el usuario no ha silenciado las incidencias en TODAS sus propiedades (las incidencias son de la finca). */
    estatesAllowingIssues: Set<string>;
    /** Una propiedad "representativa" por finca del usuario — comunicados son
     * de finca, no de propiedad concreta, así que para el deep-link de una
     * alerta de comunicado basta cualquier propiedad suya en esa finca. */
    propertyIdByEstate: Map<string, string>;
  }> {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { userId, status: 'linked', revokedAt: null },
      include: { property: { select: { estateId: true } }, settings: true },
    });

    const byProperty = new Map<
      string,
      { notifyReceipts: string; notifyIssues: string }
    >();
    const estatesAllowingCommunications = new Set<string>();
    const estatesAllowingIssues = new Set<string>();
    const propertyIdByEstate = new Map<string, string>();

    for (const m of memberships) {
      byProperty.set(m.propertyId, {
        notifyReceipts:
          m.settings?.notifyReceipts ??
          MEMBERSHIP_SETTINGS_DEFAULTS.notifyReceipts,
        notifyIssues:
          m.settings?.notifyIssues ?? MEMBERSHIP_SETTINGS_DEFAULTS.notifyIssues,
      });
      if (
        m.property.estateId &&
        (m.settings?.notifyIssues ?? MEMBERSHIP_SETTINGS_DEFAULTS.notifyIssues) !==
          'none'
      ) {
        estatesAllowingIssues.add(m.property.estateId);
      }
      const notifyCommunications =
        m.settings?.notifyCommunications ??
        MEMBERSHIP_SETTINGS_DEFAULTS.notifyCommunications;
      if (notifyCommunications !== 'none' && m.property.estateId) {
        estatesAllowingCommunications.add(m.property.estateId);
      }
      if (m.property.estateId && !propertyIdByEstate.has(m.property.estateId)) {
        propertyIdByEstate.set(m.property.estateId, m.propertyId);
      }
    }
    return {
      byProperty,
      estatesAllowingCommunications,
      estatesAllowingIssues,
      propertyIdByEstate,
    };
  }

  // ── Comunicados (tablón de anuncios) ────────────────────────────────────
  //
  // El archivado por `activeUntil` NUNCA se persiste: se calcula en cada
  // consulta comparando contra `now`. Solo `archivedByAdmin` (el archivado
  // manual de la gestora) es un estado real en base de datos — ver el
  // comentario en el modelo `Communication` (schema.prisma).

  private communicationArchivedWhere(now: Date): Prisma.CommunicationWhereInput {
    return { OR: [{ archivedByAdmin: true }, { activeUntil: { lte: now } }] };
  }

  private communicationNotArchivedWhere(now: Date): Prisma.CommunicationWhereInput {
    return {
      archivedByAdmin: false,
      OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
    };
  }

  /**
   * Rol A/B: administra todo, `filter` decide qué subconjunto ve.
   * Rol C: nunca ve lo archivado/vencido de otros vecinos — solo lo propio
   * en ese estado. El tablón compartido (`filter` por defecto) es siempre
   * "lo no archivado de cualquiera".
   */
  private communicationFilterWhere(
    user: AuthenticatedUser,
    filter: 'active' | 'archived' | 'all',
    now: Date,
  ): Prisma.CommunicationWhereInput {
    const archived = this.communicationArchivedWhere(now);
    const notArchived = this.communicationNotArchivedWhere(now);

    if (user.role !== 'C') {
      if (filter === 'archived') return archived;
      if (filter === 'all') return {};
      return notArchived;
    }

    if (filter === 'archived') {
      return { authorUserId: user.id, ...archived };
    }
    if (filter === 'all') {
      return { OR: [notArchived, { authorUserId: user.id, ...archived }] };
    }
    return notArchived;
  }

  /**
   * `activeUntil`/notificación-legal calculados + nombres de autor/último
   * editor/respuestas resueltos para mostrar. `legalNoticeEffectiveAt`/
   * `legalNoticeEffective` (LPH art. 9.1.h, 3 días naturales desde `date`)
   * NUNCA se persisten — mismo criterio que `archived`.
   */
  private async attachCommunicationDisplayFields<
    T extends {
      authorUserId: string | null;
      lastEditedByUserId: string | null;
      archivedByAdmin: boolean;
      activeUntil: Date | null;
      date: Date;
      isLegalNotice: boolean;
      replies?: { authorUserId: string | null }[];
    },
  >(items: T[], now: Date) {
    const userIds = [
      ...new Set(
        items
          .flatMap((i) => [
            i.authorUserId,
            i.lastEditedByUserId,
            ...(i.replies?.map((r) => r.authorUserId) ?? []),
          ])
          .filter((id): id is string => !!id),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    return items.map((c) => {
      const legalNoticeEffectiveAt = c.isLegalNotice
        ? new Date(c.date.getTime() + LEGAL_NOTICE_EFFECTIVE_MS)
        : null;
      return {
        ...c,
        archived:
          c.archivedByAdmin ||
          (c.activeUntil !== null && c.activeUntil <= now),
        authorName: c.authorUserId ? (nameById.get(c.authorUserId) ?? null) : null,
        lastEditedByName: c.lastEditedByUserId
          ? (nameById.get(c.lastEditedByUserId) ?? null)
          : null,
        legalNoticeEffectiveAt: legalNoticeEffectiveAt?.toISOString() ?? null,
        legalNoticeEffective: legalNoticeEffectiveAt
          ? now.getTime() >= legalNoticeEffectiveAt.getTime()
          : false,
        replies: c.replies?.map((r) => ({
          ...r,
          authorName: r.authorUserId ? (nameById.get(r.authorUserId) ?? 'Sistema') : 'Sistema',
        })),
      };
    });
  }

  private async assertCommunicationAccess(id: string, user: AuthenticatedUser) {
    const comm = await this.prisma.communication.findFirst({
      where: { id, deletedAt: null },
    });
    if (!comm || !comm.estateId) {
      throw new NotFoundException(`Comunicado ${id} no encontrado.`);
    }
    this.estateAccess.assertAccess(comm.estateId, user);
    return comm;
  }

  private assertCommunicationOwnership(
    comm: { authorUserId: string | null },
    user: AuthenticatedUser,
    action: string,
  ) {
    if (user.role === 'C' && comm.authorUserId !== user.id) {
      throw new ForbiddenException(`Solo puedes ${action} tus propios comunicados.`);
    }
  }

  /**
   * Rol C nunca puede publicar como Urgente, dirigir un comunicado a una
   * propiedad concreta, ni marcarlo como notificación fehaciente — son
   * capacidades exclusivas de la gestora (A/B).
   */
  private assertPrivilegedFields(
    dto: {
      category?: string;
      targetPropertyId?: string | null;
      isLegalNotice?: boolean;
    },
    user: AuthenticatedUser,
  ) {
    if (user.role !== 'C') return;
    if (dto.category === 'Urgente') {
      throw new ForbiddenException('Solo la gestora puede publicar como Urgente.');
    }
    if (dto.targetPropertyId || dto.isLegalNotice) {
      throw new ForbiddenException(
        'Solo la gestora puede dirigir o marcar como notificación fehaciente un comunicado.',
      );
    }
  }

  private async assertTargetPropertyInEstate(
    estateId: string,
    targetPropertyId: string,
  ): Promise<void> {
    const property = await this.prisma.property.findFirst({
      where: { id: targetPropertyId, estateId, deletedAt: null },
      select: { id: true },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${targetPropertyId} no encontrada en esta finca.`);
    }
  }

  /** Rechaza fechas pasadas o inválidas — `activeUntil` solo tiene sentido hacia el futuro. */
  private parseFutureActiveUntil(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      throw new BadRequestException(
        'La fecha de vigencia debe ser una fecha futura válida.',
      );
    }
    return date;
  }

  async listCommunications(
    estateId: string,
    user: AuthenticatedUser,
    params: PageParams & { filter?: 'active' | 'archived' | 'all'; category?: string } = {},
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const resolved = resolvePage(params);
    const now = new Date();
    // Rol C nunca ve un comunicado dirigido a una propiedad que no es la
    // suya — mismo patrón que `listDocuments`'s `visibilityWhere`.
    const visibilityWhere: Prisma.CommunicationWhereInput =
      user.role === 'C'
        ? {
            AND: [
              {
                OR: [
                  { targetPropertyId: null },
                  { targetPropertyId: { in: await this.linkedPropertyIds(user.id) } },
                ],
              },
            ],
          }
        : {};
    const where: Prisma.CommunicationWhereInput = {
      estateId,
      deletedAt: null,
      ...this.communicationFilterWhere(user, params.filter ?? 'active', now),
      ...visibilityWhere,
      ...(params.category ? { category: params.category as CommunicationCategory } : {}),
    };
    const [total, communications, reads] = await Promise.all([
      this.prisma.communication.count({ where }),
      this.prisma.communication.findMany({
        where,
        orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { date: 'desc' }],
        include: {
          replies: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
          attachments: { orderBy: { uploadedAt: 'desc' } },
        },
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.readSet(user.id, 'communication'),
    ]);
    const withDisplay = await this.attachCommunicationDisplayFields(
      communications,
      now,
    );
    return toPage(
      total,
      resolved,
      withDisplay.map((c) => ({ ...c, read: reads.has(c.id) })),
    );
  }

  async createCommunication(
    estateId: string,
    dto: CreateCommunicationDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    this.assertPrivilegedFields(dto, user);
    const activeUntil = dto.activeUntil
      ? this.parseFutureActiveUntil(dto.activeUntil)
      : null;
    if (dto.targetPropertyId) {
      await this.assertTargetPropertyInEstate(estateId, dto.targetPropertyId);
    }
    // `from` siempre server-derived: nunca se confía en un valor del cliente.
    const author = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { fullName: true },
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.communication.create({
        data: {
          estateId,
          title: dto.title,
          body: dto.body,
          from: author.fullName,
          authorUserId: user.id,
          date: new Date(),
          activeUntil,
          category: dto.category ?? 'General',
          targetPropertyId: dto.targetPropertyId ?? null,
          isLegalNotice: dto.isLegalNotice ?? false,
          legalNoticeSignerRole: dto.legalNoticeSignerRole,
          legalNoticeSignerName: dto.legalNoticeSignerName,
          legalNoticeReason: dto.legalNoticeReason,
          legalNoticeCountersignedByPresident: dto.legalNoticeCountersignedByPresident ?? false,
        },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'communication',
          subjectId: row.id,
          verb: 'published',
          summary: `Comunicado "${row.title}" publicado`,
          occurredAt: new Date(),
          estateId,
          propertyId: null,
        },
      });
      return row;
    });
    // Solo al crear, nunca al editar — evita reenvíos duplicados si alguien
    // cambia la categoría más tarde. Fire-and-forget con log propio: un
    // fallo de envío no debe tumbar la creación del comunicado.
    if (created.category === 'Urgente' || created.isLegalNotice) {
      void this.notifyCommunicationByEmail(created);
    }
    const [withDisplay] = await this.attachCommunicationDisplayFields(
      [{ ...created, replies: [] }],
      new Date(),
    );
    return withDisplay;
  }

  async updateCommunication(
    id: string,
    dto: UpdateCommunicationDto,
    user: AuthenticatedUser,
  ) {
    const comm = await this.assertCommunicationAccess(id, user);
    this.assertCommunicationOwnership(comm, user, 'editar');
    this.assertPrivilegedFields(dto, user);

    const data: Prisma.CommunicationUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.activeUntil !== undefined) {
      data.activeUntil =
        dto.activeUntil === null
          ? null
          : this.parseFutureActiveUntil(dto.activeUntil);
    }
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.targetPropertyId !== undefined) {
      if (dto.targetPropertyId && comm.estateId) {
        await this.assertTargetPropertyInEstate(comm.estateId, dto.targetPropertyId);
      }
      data.targetPropertyId = dto.targetPropertyId;
    }
    if (dto.isLegalNotice !== undefined) data.isLegalNotice = dto.isLegalNotice;
    if (dto.legalNoticeSignerRole !== undefined) data.legalNoticeSignerRole = dto.legalNoticeSignerRole;
    if (dto.legalNoticeSignerName !== undefined) data.legalNoticeSignerName = dto.legalNoticeSignerName;
    if (dto.legalNoticeReason !== undefined) data.legalNoticeReason = dto.legalNoticeReason;
    if (dto.legalNoticeCountersignedByPresident !== undefined) {
      data.legalNoticeCountersignedByPresident = dto.legalNoticeCountersignedByPresident;
    }

    // Traza de admin: solo cuando A/B edita un comunicado que NO es suyo —
    // que cada quien edite lo propio no necesita marcarse como "admin editó".
    const isAdminEditingOthers =
      (user.role === 'A' || user.role === 'B') &&
      comm.authorUserId !== user.id;
    if (isAdminEditingOthers) {
      data.lastEditedByUserId = user.id;
      data.lastEditedAt = new Date();
    }

    const updated = isAdminEditingOthers
      ? await this.prisma.$transaction(async (tx) => {
          const row = await tx.communication.update({ where: { id }, data });
          await tx.activityLogEntry.create({
            data: {
              actorUserId: user.id,
              subjectType: 'communication',
              subjectId: id,
              verb: 'updated',
              summary: `Comunicado "${row.title}" editado por la gestora`,
              occurredAt: new Date(),
              estateId: comm.estateId,
              propertyId: null,
            },
          });
          return row;
        })
      : await this.prisma.communication.update({ where: { id }, data });

    const [withDisplay] = await this.attachCommunicationDisplayFields(
      [updated],
      new Date(),
    );
    return withDisplay;
  }

  async deleteCommunication(id: string, user: AuthenticatedUser): Promise<void> {
    const comm = await this.assertCommunicationAccess(id, user);
    this.assertCommunicationOwnership(comm, user, 'eliminar');

    const isAdminDeletingOthers =
      (user.role === 'A' || user.role === 'B') &&
      comm.authorUserId !== user.id;

    if (isAdminDeletingOthers) {
      await this.prisma.$transaction(async (tx) => {
        await tx.communication.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await tx.activityLogEntry.create({
          data: {
            actorUserId: user.id,
            subjectType: 'communication',
            subjectId: id,
            verb: 'deleted',
            summary: `Comunicado "${comm.title}" eliminado por la gestora`,
            occurredAt: new Date(),
            estateId: comm.estateId,
            propertyId: null,
          },
        });
      });
      return;
    }
    await this.prisma.communication.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Solo A/B — sin excepción de propiedad, ni siquiera sobre lo propio. */
  async setCommunicationArchived(
    id: string,
    archived: boolean,
    user: AuthenticatedUser,
  ) {
    const comm = await this.assertCommunicationAccess(id, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.communication.update({
        where: { id },
        data: { archivedByAdmin: archived },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'communication',
          subjectId: id,
          verb: 'archived',
          summary: archived
            ? `Comunicado "${row.title}" archivado por la gestora`
            : `Comunicado "${row.title}" desarchivado por la gestora`,
          occurredAt: new Date(),
          estateId: comm.estateId,
          propertyId: null,
        },
      });
      return row;
    });
    const [withDisplay] = await this.attachCommunicationDisplayFields(
      [updated],
      new Date(),
    );
    return withDisplay;
  }

  /** Solo A/B — mismo criterio de "sin excepción de propiedad" que el archivado. `pinnedAt` es la fecha, no un booleano, para que un post refijado más tarde vuelva a subir en el orden. */
  async setCommunicationPinned(id: string, pinned: boolean, user: AuthenticatedUser) {
    await this.assertCommunicationAccess(id, user);
    const updated = await this.prisma.communication.update({
      where: { id },
      data: { pinnedAt: pinned ? new Date() : null },
    });
    const [withDisplay] = await this.attachCommunicationDisplayFields(
      [updated],
      new Date(),
    );
    return withDisplay;
  }

  // ── Respuestas — mismo patrón que IssueTimelineEntry:
  // cualquier rol con acceso puede responder, autor inferido server-side,
  // sin @Roles en el endpoint. ─────────────────────────────────────────────

  async addCommunicationReply(
    id: string,
    dto: AddCommunicationReplyDto,
    user: AuthenticatedUser,
  ) {
    const comm = await this.assertCommunicationAccess(id, user);
    // Un comunicado dirigido a una propiedad concreta no es "accesible" para
    // un rol C que no esté vinculado a ella — mismo criterio de privacidad
    // que la visibilidad en listCommunications.
    if (user.role === 'C' && comm.targetPropertyId) {
      const linked = await this.linkedPropertyIds(user.id);
      if (!linked.includes(comm.targetPropertyId)) {
        throw new NotFoundException(`Comunicado ${id} no encontrado.`);
      }
    }
    const reply = await this.prisma.communicationReply.create({
      data: {
        communicationId: id,
        authorUserId: user.id,
        role: this.authorRoleFor(user),
        text: dto.text,
      },
      include: { authorUser: { select: { fullName: true } } },
    });
    return { ...reply, authorName: reply.authorUser?.fullName ?? 'Sistema' };
  }

  /** Moderación: A/B puede borrar cualquier respuesta; C solo la propia. */
  async deleteCommunicationReply(
    id: string,
    replyId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCommunicationAccess(id, user);
    const reply = await this.prisma.communicationReply.findFirst({
      where: { id: replyId, communicationId: id, deletedAt: null },
    });
    if (!reply) {
      throw new NotFoundException(`Respuesta ${replyId} no encontrada.`);
    }
    if (user.role === 'C' && reply.authorUserId !== user.id) {
      throw new ForbiddenException('Solo puedes eliminar tus propias respuestas.');
    }
    await this.prisma.communicationReply.update({
      where: { id: replyId },
      data: { deletedAt: new Date() },
    });
  }

  // ── Adjuntos — calco de MeetingsService.listAttachments/uploadAttachment/
  // downloadAttachment. ────────────────────────────────────────────────────

  async listCommunicationAttachments(id: string, user: AuthenticatedUser) {
    await this.assertCommunicationAccess(id, user);
    return this.prisma.communicationAttachment.findMany({
      where: { communicationId: id },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /** Adjuntar es A/B, o el propio autor C sobre su comunicado — mismo criterio que editar. */
  async uploadCommunicationAttachment(
    id: string,
    file: UploadedMulterFile,
    title: string | undefined,
    user: AuthenticatedUser,
  ) {
    const comm = await this.assertCommunicationAccess(id, user);
    this.assertCommunicationOwnership(comm, user, 'adjuntar archivos a');
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(`communications/${id}`, file.originalname, file.buffer);
    return this.prisma.communicationAttachment.create({
      data: { communicationId: id, title: title?.trim() || file.originalname, s3Key },
    });
  }

  async downloadCommunicationAttachment(
    id: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ title: string; content: Buffer }> {
    await this.assertCommunicationAccess(id, user);
    const attachment = await this.prisma.communicationAttachment.findFirst({
      where: { id: attachmentId, communicationId: id },
    });
    if (!attachment) {
      throw new NotFoundException(`Adjunto ${attachmentId} no encontrado.`);
    }
    const content = await this.storage.get(attachment.s3Key);
    return { title: attachment.title, content };
  }

  // ── Lecturas — A/B-only (ver controller), útil tanto para engagement como
  // para defensa legal de que un aviso importante llegó a los vecinos. Cruza
  // `PropertyMembership` (destinatarios elegibles) con `ResourceRead`, sin
  // tabla nueva. ────────────────────────────────────────────────────────────

  async listCommunicationReads(id: string, user: AuthenticatedUser) {
    const comm = await this.assertCommunicationAccess(id, user);
    const eligible = await this.prisma.propertyMembership.findMany({
      where: {
        status: 'linked',
        revokedAt: null,
        property: comm.targetPropertyId
          ? { id: comm.targetPropertyId }
          : { estateId: comm.estateId! },
      },
      select: { userId: true, user: { select: { fullName: true } } },
      distinct: ['userId'],
    });
    const reads = await this.prisma.resourceRead.findMany({
      where: {
        sourceType: 'communication',
        sourceId: id,
        userId: { in: eligible.map((e) => e.userId) },
      },
      select: { userId: true, readAt: true },
    });
    const readAtByUser = new Map(reads.map((r) => [r.userId, r.readAt]));
    return eligible.map((e) => ({
      userId: e.userId,
      fullName: e.user.fullName,
      read: readAtByUser.has(e.userId),
      readAt: readAtByUser.get(e.userId)?.toISOString() ?? null,
    }));
  }

  /**
   * Solo para comunicados Urgente o de notificación fehaciente — el resto no
   * interrumpe con email, se ven igual en el tablón. `NotificationsService`
   * decide bandeja/email según `notifyCommunications` de cada destinatario
   * (antes una preferencia modelada pero nunca conectada a un envío real).
   */
  private async notifyCommunicationByEmail(comm: Communication): Promise<void> {
    if (!comm.estateId) return;
    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        status: 'linked',
        revokedAt: null,
        property: comm.targetPropertyId
          ? { id: comm.targetPropertyId }
          : { estateId: comm.estateId },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (memberships.length === 0) return;
    await this.notifications.notify({
      userIds: memberships.map((m) => m.userId),
      category: 'communication',
      title: comm.isLegalNotice ? `Notificación fehaciente: ${comm.title}` : `Aviso urgente: ${comm.title}`,
      body: comm.body.slice(0, 200),
      link: comm.targetPropertyId
        ? ownerPropertyLink(comm.targetPropertyId, 'communications')
        : ownerEstateSectionLink(comm.estateId, 'communications'),
      estateId: comm.estateId,
      propertyId: comm.targetPropertyId,
    });
  }

  // ── Documentos ───────────────────────────────────────────────────────

  async listDocuments(
    estateId: string,
    user: AuthenticatedUser,
    params: PageParams = {},
  ) {
    this.estateAccess.assertAccess(estateId, user);
    // Visibilidad de documentos: la regla única de la biblioteca (gestora, junta, propietarios, una propiedad).
    const resolved = resolvePage(params);
    const where = { AND: [{ estateId }, await documentVisibleWhere(this.prisma, user)] };
    const [total, documents, reads] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: resolved.skip,
        take: resolved.take,
        include: { folder: { select: { name: true, deletedAt: true } } },
      }),
      this.readSet(user.id, 'document'),
    ]);
    // `isNew` per-user: no visto todavía (sin fila en resource_reads). Campos
    // explícitos: la visibilidad interna, la papelera y la clave de almacenamiento
    // no salen nunca (este listado también lo usan los propietarios).
    return toPage(
      total,
      resolved,
      documents.map((d) => ({
        id: d.id,
        estateId: d.estateId,
        title: d.title,
        type: d.type,
        date: d.date,
        size: d.size,
        sizeBytes: d.sizeBytes,
        mimeType: documentMime(d),
        folderId: d.folderId,
        folderName: d.folder && !d.folder.deletedAt ? d.folder.name : null,
        source: d.source,
        description: d.description,
        targetPropertyId: d.targetPropertyId,
        updatedAt: d.updatedAt,
        isNew: !reads.has(d.id),
      })),
    );
  }

  async createDocument(
    estateId: string,
    dto: CreateDocumentDto,
    user: AuthenticatedUser,
  ) {
    await this.currentAuthorization.resolve(user, estateId, true);
    if (dto.s3Key) this.storage.assertDocumentKey(dto.s3Key, estateId);
    this.estateAccess.assertAccess(estateId, user);
    if (user.role === 'C') {
      throw new ForbiddenException('Solo la gestora publica documentos.');
    }
    return this.prisma.document.create({
      data: {
        estateId,
        title: dto.title,
        type: dto.type,
        date: new Date(dto.date),
        size: dto.size,
        s3Key: dto.s3Key ?? null,
        // Type from the stored file, so the library can preview it.
        mimeType: mimeFromKey(dto.s3Key),
      },
    });
  }

  // ── Lecturas (resource_reads: una tabla para todo, Apéndice H) ─────────

  private async readSet(
    userId: string,
    sourceType?: AlertSourceType,
  ): Promise<Set<string>> {
    const reads = await this.prisma.resourceRead.findMany({
      where: { userId, ...(sourceType ? { sourceType } : {}) },
      select: { sourceType: true, sourceId: true },
    });
    return new Set(
      reads.map((r) =>
        sourceType ? r.sourceId : `${r.sourceType}:${r.sourceId}`,
      ),
    );
  }

  /**
   * `POST /resource-reads`. A document marker is only written for a document the user can see
   * (same rule as every document read); anything else is ignored silently and answers null.
   * Other resource types are marked as before.
   */
  async markReadAs(user: AuthenticatedUser, sourceType: AlertSourceType, sourceId: string) {
    if (sourceType === 'document') {
      const visible = await this.prisma.document.findFirst({
        where: { AND: [{ id: sourceId }, await documentVisibleWhere(this.prisma, user)] },
        select: { id: true },
      });
      if (!visible) return null;
    }
    return this.markRead(user.id, sourceType, sourceId);
  }

  /** Idempotente: la PK compuesta (userId, sourceType, sourceId) absorbe repetidos. */
  async markRead(
    userId: string,
    sourceType: AlertSourceType,
    sourceId: string,
  ) {
    return this.prisma.resourceRead.upsert({
      where: { userId_sourceType_sourceId: { userId, sourceType, sourceId } },
      update: {},
      create: { userId, sourceType, sourceId, readAt: new Date() },
    });
  }

  // ── Alertas (100% derivadas — sin tabla, gap #7 / Apéndice H) ──────────

  async listAlerts(
    user: AuthenticatedUser,
    limit?: number,
  ): Promise<AlertItem[]> {
    const alerts =
      user.role === 'B'
        ? await this.listAlertsForAdmin(user)
        : await this.listAlertsForOwner(user);
    return limit ? alerts.slice(0, limit) : alerts;
  }

  /**
   * Rol B — feed de alertas por finca gestionada. `ResourcesService` nació
   * pensada 100% para el rol C (ownerUserId, linkedPropertyIds, preferencias
   * de notificación por membresía); esas nociones no existen para un
   * administrador, así que aquí se re-hace el mismo feed pero filtrado por
   * `estateId` — sin las preferencias de privacidad de propietario, que no
   * aplican al rol que las gestiona.
   */
  private async listAlertsForAdmin(
    user: AuthenticatedUser,
  ): Promise<AlertItem[]> {
    const estateIds = user.estateIds;
    const now = new Date();
    // Mismo umbral que SuppliersService.CONTRACT_EXPIRING_SOON_DAYS — no se
    // importa desde allí para no acoplar ResourcesModule a SuppliersModule
    // por una sola constante; si el umbral cambia, hay que tocar los dos.
    const expiryThreshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const reads = await this.readSet(user.id);
    const isRead = (t: AlertSourceType, id: string) => reads.has(`${t}:${id}`);

    const currentFiscalYear = now.getFullYear();

    const [
      receipts,
      issues,
      communications,
      documents,
      events,
      meetings,
      expiringContracts,
      expiringDocuments,
      budgetItems,
      costCentreBudgets,
      closedFiscalYears,
    ] = await Promise.all([
        estateIds.length
          ? this.prisma.accountingReceipt.findMany({
              where: {
                property: { estateId: { in: estateIds } },
                status: 'Pendiente',
              },
              include: { property: { select: { estateId: true } } },
            })
          : [],
        estateIds.length
          ? this.prisma.issue.findMany({
              where: {
                ...issuesOfEstate(estateIds),
                deletedAt: null,
              },
            })
          : [],
        estateIds.length
          ? this.prisma.communication.findMany({
              where: {
                estateId: { in: estateIds },
                deletedAt: null,
                ...this.communicationNotArchivedWhere(now),
              },
            })
          : [],
        estateIds.length
          ? this.prisma.document.findMany({
              where: { AND: [{ estateId: { in: estateIds } }, await documentVisibleWhere(this.prisma, user)] },
            })
          : [],
        estateIds.length
          ? this.prisma.propertyEvent.findMany({
              where: { estateId: { in: estateIds }, date: { gte: new Date() } },
            })
          : [],
        estateIds.length
          ? this.prisma.meeting.findMany({
              where: {
                estateId: { in: estateIds },
                includeJitsi: true,
                // Solo `convocada`: una junta cancelada (o cerrada) ya no
                // debe avisar como pendiente a nadie.
                status: 'convocada',
                scheduledAt1: { gte: new Date() },
              },
            })
          : [],
        // Tarea 20 — sin cota inferior a propósito: un contrato ya vencido
        // sigue en el feed hasta renovarlo/cancelarlo, mismo criterio que
        // los recibos Pendiente (que también se muestran aunque ya venzan).
        // Rol B/A únicamente — nunca en listAlertsForOwner, un propietario
        // no gestiona proveedores.
        estateIds.length
          ? this.prisma.supplierContract.findMany({
              where: {
                estateId: { in: estateIds },
                cancelledAt: null,
                endDate: { not: null, lte: expiryThreshold },
              },
              include: { supplier: { select: { name: true, estateId: true } } },
            })
          : [],
        estateIds.length
          ? this.prisma.supplierDocument.findMany({
              where: {
                supplier: { estateId: { in: estateIds } },
                expiresAt: { not: null, lte: expiryThreshold },
              },
              include: { supplier: { select: { name: true, estateId: true } } },
            })
          : [],
        // Tarea 43 — solo el ejercicio abierto actual (año natural); un
        // ejercicio cerrado explícitamente se excluye más abajo. Nunca en
        // listAlertsForOwner: un propietario no gestiona presupuestos.
        estateIds.length
          ? this.prisma.budgetItem.findMany({
              where: { estateId: { in: estateIds }, fiscalYear: currentFiscalYear },
              include: { account: { select: { code: true, name: true, shortName: true } } },
            })
          : [],
        estateIds.length
          ? this.prisma.costCentreBudget.findMany({
              where: { estateId: { in: estateIds }, fiscalYear: currentFiscalYear },
              include: { costCentre: { select: { name: true } } },
            })
          : [],
        estateIds.length
          ? this.prisma.fiscalYear.findMany({
              where: { estateId: { in: estateIds }, year: currentFiscalYear, status: 'Cerrado' },
              select: { estateId: true },
            })
          : [],
      ]);

    const alerts: AlertItem[] = [];

    for (const r of receipts) {
      alerts.push({
        id: `receipt:${r.id}`,
        sourceType: 'receipt',
        sourceId: r.id,
        type: 'pago',
        title: `Recibo ${r.no}`,
        description: r.concept,
        date: r.date.toISOString(),
        urgent: !!r.dueDate && r.dueDate.getTime() < Date.now(),
        propertyId: r.propertyId,
        estateId: r.property.estateId,
        read: isRead('receipt', r.id),
      });
    }

    for (const i of issues) {
      const active = ACTIVE_ISSUE_STATUSES.includes(i.status);
      alerts.push({
        id: `issue:${i.id}`,
        sourceType: 'issue',
        sourceId: i.id,
        type: 'incidencia',
        title: i.title,
        description: i.description,
        date: i.date.toISOString(),
        urgent: active && i.priority === 'Urgente',
        estateId: i.estateId,
        read: isRead('issue', i.id),
      });
    }

    for (const c of communications) {
      alerts.push({
        id: `communication:${c.id}`,
        sourceType: 'communication',
        sourceId: c.id,
        type: 'comunidad',
        title: c.title,
        description: c.body.slice(0, 100),
        date: c.date.toISOString(),
        urgent: c.category === 'Urgente' || c.isLegalNotice,
        estateId: c.estateId,
        read: isRead('communication', c.id),
      });
    }

    for (const d of documents) {
      if (isRead('document', d.id)) continue;
      alerts.push({
        id: `document:${d.id}`,
        sourceType: 'document',
        sourceId: d.id,
        type: 'documento',
        title: 'Nuevo documento disponible',
        description: d.title,
        date: d.date.toISOString(),
        urgent: false,
        estateId: d.estateId,
        read: false,
      });
    }

    for (const e of events) {
      alerts.push({
        id: `event:${e.id}`,
        sourceType: 'event',
        sourceId: e.id,
        type: 'junta',
        title: e.title,
        description: `${e.location}${e.room ? ` · ${e.room}` : ''} · ${e.time}`,
        date: e.date.toISOString(),
        urgent: false,
        estateId: e.estateId,
        read: isRead('event', e.id),
      });
    }

    // Juntas con videollamada — `sourceType: 'meeting'` distingue estas
    // (deep-linkable a /beacon/:id, un panel de anfitrión real) de las
    // derivadas de `propertyEvent` arriba (`sourceType: 'event'`, sin
    // ningún módulo al que enlazar todavía). Coexisten a propósito: no se
    // tocó `PropertyEvent` al construir Meetings (ver plan de la historia).
    for (const m of meetings) {
      alerts.push({
        id: `meeting:${m.id}`,
        sourceType: 'meeting',
        sourceId: m.id,
        type: 'junta',
        title: m.title,
        description: m.location ? `Videollamada · ${m.location}` : 'Videollamada',
        date: m.scheduledAt1.toISOString(),
        urgent: false,
        estateId: m.estateId,
        read: isRead('meeting', m.id),
      });
    }

    const URGENT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

    for (const c of expiringContracts) {
      alerts.push({
        id: `supplier_contract:${c.id}`,
        sourceType: 'supplier_contract',
        sourceId: c.id,
        type: 'proveedor',
        title: `Contrato de ${c.supplier.name} por vencer`,
        description: c.serviceType,
        date: c.endDate!.toISOString(),
        urgent: c.endDate!.getTime() - now.getTime() < URGENT_WITHIN_MS,
        estateId: c.supplier.estateId,
        read: isRead('supplier_contract', c.id),
      });
    }

    // Mismo sourceType que los contratos (no hay un enum separado para
    // documentos): el espacio de IDs de SupplierDocument nunca choca con el
    // de SupplierContract, así que el par (sourceType, sourceId) sigue
    // siendo único para el tracking de leído/no leído.
    for (const d of expiringDocuments) {
      alerts.push({
        id: `supplier_contract:doc:${d.id}`,
        sourceType: 'supplier_contract',
        sourceId: d.id,
        type: 'proveedor',
        title: `Documento de ${d.supplier.name} por vencer`,
        description: d.title,
        date: d.expiresAt!.toISOString(),
        urgent: d.expiresAt!.getTime() - now.getTime() < URGENT_WITHIN_MS,
        estateId: d.supplier.estateId,
        read: isRead('supplier_contract', d.id),
      });
    }

    // Tarea 43 — partidas de presupuesto (cuenta o centro de coste) al 90%+
    // de ejecución en el ejercicio en curso. Se excluyen las fincas con ese
    // año explícitamente cerrado — "liquidación" ya hecha, no tiene sentido
    // seguir avisando de algo que ya se cerró. `executed` se recalcula aquí
    // mismo (mismas funciones que BudgetService) en vez de llamar al
    // servicio de presupuesto, siguiendo
    // la convención ya usada arriba para supplier_contract: las alertas
    // consultan Prisma directo, no el servicio dueño del dominio.
    const closedEstateIds = new Set(closedFiscalYears.map((f) => f.estateId));
    const activeBudgetItems = budgetItems.filter((b) => !closedEstateIds.has(b.estateId));
    const activeCostCentreBudgets = costCentreBudgets.filter((c) => !closedEstateIds.has(c.estateId));

    if (activeBudgetItems.length > 0 || activeCostCentreBudgets.length > 0) {
      const yearStart = new Date(Date.UTC(currentFiscalYear, 0, 1));
      const yearEnd = new Date(Date.UTC(currentFiscalYear + 1, 0, 1));

      // Lo ejecutado sale del diario, con el mismo criterio que el
      // presupuesto (ledger/executed.ts).
      const [executedByAccountMap, executedByCentreMap] = await Promise.all([
        activeBudgetItems.length
          ? executedByAccount(this.prisma, estateIds, currentFiscalYear, activeBudgetItems.map((b) => b.accountId))
          : new Map<string, Prisma.Decimal>(),
        activeCostCentreBudgets.length
          ? executedByCostCentre(this.prisma, estateIds, currentFiscalYear, activeCostCentreBudgets.map((c) => c.costCentreId))
          : new Map<string, Prisma.Decimal>(),
      ]);

      for (const b of activeBudgetItems) {
        if (b.budgeted.isZero()) continue;
        const executed = executedByAccountMap.get(b.accountId) ?? new Prisma.Decimal(0);
        const ratio = executed.dividedBy(b.budgeted).toNumber();
        if (ratio < 0.9) continue;
        alerts.push({
          id: `budget_item:${b.id}`,
          sourceType: 'budget_item',
          sourceId: b.id,
          type: 'presupuesto',
          title: `Partida ${b.account.code} · ${b.account.shortName ?? b.account.name} al ${Math.round(ratio * 100)}%`,
          description: `Presupuestado ${b.budgeted.toFixed(2)} € · Ejecutado ${executed.toFixed(2)} €`,
          date: now.toISOString(),
          urgent: ratio >= 1,
          estateId: b.estateId,
          read: isRead('budget_item', b.id),
        });
      }

      for (const c of activeCostCentreBudgets) {
        if (c.budgeted.isZero()) continue;
        const executed = executedByCentreMap.get(c.costCentreId) ?? new Prisma.Decimal(0);
        const ratio = executed.dividedBy(c.budgeted).toNumber();
        if (ratio < 0.9) continue;
        alerts.push({
          id: `budget_item:cc:${c.id}`,
          sourceType: 'budget_item',
          sourceId: c.id,
          type: 'presupuesto',
          title: `Centro de coste "${c.costCentre.name}" al ${Math.round(ratio * 100)}%`,
          description: `Presupuestado ${c.budgeted.toFixed(2)} € · Ejecutado ${executed.toFixed(2)} €`,
          date: now.toISOString(),
          urgent: ratio >= 1,
          estateId: c.estateId,
          read: isRead('budget_item', c.id),
        });
      }
    }

    return alerts.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }

  private async listAlertsForOwner(
    user: AuthenticatedUser,
  ): Promise<AlertItem[]> {
    const propertyIds = await this.linkedPropertyIds(user.id);
    const estateIds = user.estateIds;
    const now = new Date();
    const reads = await this.readSet(user.id);
    const isRead = (t: AlertSourceType, id: string) => reads.has(`${t}:${id}`);
    const {
      byProperty,
      estatesAllowingCommunications,
      estatesAllowingIssues,
      propertyIdByEstate,
    } = await this.notificationPrefsByProperty(user.id);

    const [receipts, issues, communications, documents, events, meetings] =
      await Promise.all([
        this.prisma.accountingReceipt.findMany({
          where: { ownerUserId: user.id },
          include: { period: { select: { label: true } } },
        }),
        // Las incidencias son de la comunidad: al propietario le avisan las que ÉL reportó.
        estateIds.length
          ? this.prisma.issue.findMany({
              where: {
                ...issuesOfEstate(estateIds),
                deletedAt: null,
                reports: { some: { reporterUserId: user.id } },
              },
            })
          : [],
        estateIds.length
          ? this.prisma.communication.findMany({
              where: {
                estateId: { in: estateIds },
                deletedAt: null,
                // `AND` en vez de fundir con el `OR` de abajo — mismo motivo
                // que `listCommunications`'s `visibilityWhere`: el spread de
                // `communicationNotArchivedWhere` trae su propio `OR` y un
                // segundo `OR` a este nivel lo pisaría en vez de sumarse.
                AND: [
                  {
                    OR: [
                      { targetPropertyId: null },
                      { targetPropertyId: { in: propertyIds } },
                    ],
                  },
                ],
                ...this.communicationNotArchivedWhere(now),
              },
            })
          : [],
        estateIds.length
          ? this.prisma.document.findMany({
              where: { AND: [{ estateId: { in: estateIds } }, await documentVisibleWhere(this.prisma, user)] },
            })
          : [],
        estateIds.length
          ? this.prisma.propertyEvent.findMany({
              where: { estateId: { in: estateIds }, date: { gte: new Date() } },
            })
          : [],
        estateIds.length
          ? this.prisma.meeting.findMany({
              where: {
                estateId: { in: estateIds },
                includeJitsi: true,
                // Solo `convocada`: una junta cancelada (o cerrada) ya no
                // debe avisar como pendiente a nadie.
                status: 'convocada',
                scheduledAt1: { gte: new Date() },
              },
            })
          : [],
      ]);

    const alerts: AlertItem[] = [];

    for (const r of receipts) {
      if (
        r.propertyId &&
        byProperty.get(r.propertyId)?.notifyReceipts === 'none'
      )
        continue;
      alerts.push({
        id: `receipt:${r.id}`,
        sourceType: 'receipt',
        sourceId: r.id,
        type: 'pago',
        title: `Recibo ${r.no}`,
        description: r.concept,
        date: r.date.toISOString(),
        urgent: r.status === 'Pendiente',
        propertyId: r.propertyId,
        read: isRead('receipt', r.id),
      });
    }

    for (const i of issues) {
      if (!estatesAllowingIssues.has(i.estateId)) continue;
      const active = ACTIVE_ISSUE_STATUSES.includes(i.status);
      alerts.push({
        id: `issue:${i.id}`,
        sourceType: 'issue',
        sourceId: i.id,
        type: 'incidencia',
        title: i.title,
        description: i.description,
        date: i.date.toISOString(),
        urgent: active && i.priority === 'Urgente',
        estateId: i.estateId,
        read: isRead('issue', i.id),
      });
    }

    for (const c of communications) {
      if (c.estateId && !estatesAllowingCommunications.has(c.estateId))
        continue;
      alerts.push({
        id: `communication:${c.id}`,
        sourceType: 'communication',
        sourceId: c.id,
        type: 'comunidad',
        title: c.title,
        description: c.body.slice(0, 100),
        date: c.date.toISOString(),
        urgent: c.category === 'Urgente' || c.isLegalNotice,
        // Comunicado dirigido: el deep-link usa su propia targetPropertyId
        // (ya filtrada arriba a las del propio usuario). Comunicado de finca
        // completa: cualquier propiedad del usuario en esa finca sirve para
        // el deep-link (gap: alertas-c.component.ts antes no navegaba a
        // ningún sitio).
        propertyId:
          c.targetPropertyId ??
          (c.estateId ? (propertyIdByEstate.get(c.estateId) ?? null) : null),
        read: isRead('communication', c.id),
      });
    }

    // Documentos: solo los NO vistos generan alerta (los vistos desaparecen
    // del feed, misma regla que el mock).
    for (const d of documents) {
      if (isRead('document', d.id)) continue;
      if (d.estateId && !estatesAllowingCommunications.has(d.estateId))
        continue;
      alerts.push({
        id: `document:${d.id}`,
        sourceType: 'document',
        sourceId: d.id,
        type: 'documento',
        title: 'Nuevo documento disponible',
        description: d.title,
        date: d.date.toISOString(),
        urgent: false,
        read: false,
      });
    }

    for (const e of events) {
      if (!estatesAllowingCommunications.has(e.estateId)) continue;
      alerts.push({
        id: `event:${e.id}`,
        sourceType: 'event',
        sourceId: e.id,
        type: 'junta',
        title: e.title,
        description: `${e.location}${e.room ? ` · ${e.room}` : ''} · ${e.time}`,
        date: e.date.toISOString(),
        urgent: false,
        read: isRead('event', e.id),
      });
    }

    // Juntas con videollamada — ver comentario equivalente en listAlertsForAdmin.
    for (const m of meetings) {
      if (!estatesAllowingCommunications.has(m.estateId)) continue;
      alerts.push({
        id: `meeting:${m.id}`,
        sourceType: 'meeting',
        sourceId: m.id,
        type: 'junta',
        title: m.title,
        description: m.location ? `Videollamada · ${m.location}` : 'Videollamada',
        date: m.scheduledAt1.toISOString(),
        urgent: false,
        read: isRead('meeting', m.id),
      });
    }

    return alerts.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }

  async markAllAlertsRead(user: AuthenticatedUser) {
    const alerts = await this.listAlerts(user);
    const unread = alerts.filter((a) => !a.read);
    await this.prisma.resourceRead.createMany({
      data: unread.map((a) => ({
        userId: user.id,
        sourceType: a.sourceType,
        sourceId: a.sourceId,
        readAt: new Date(),
      })),
      skipDuplicates: true,
    });
    return { marked: unread.length };
  }

  // ── Feed de actividad (híbrido, Apéndice H gap #17) ────────────────────

  async listActivity(user: AuthenticatedUser, limit = 10) {
    const propertyIds = await this.linkedPropertyIds(user.id);
    const estateIds = user.estateIds;

    const [issues, receipts, communications, documents, logEntries] =
      await Promise.all([
        // Las incidencias son de la comunidad: en la actividad del propietario salen las que ÉL reportó.
        estateIds.length
          ? this.prisma.issue.findMany({
              where: {
                ...issuesOfEstate(estateIds),
                deletedAt: null,
                reports: { some: { reporterUserId: user.id } },
              },
            })
          : [],
        this.prisma.accountingReceipt.findMany({
          where: { ownerUserId: user.id },
        }),
        estateIds.length
          ? this.prisma.communication.findMany({
              where: { estateId: { in: estateIds }, deletedAt: null },
            })
          : [],
        estateIds.length
          ? this.prisma.document.findMany({
              where: { AND: [{ estateId: { in: estateIds } }, await documentVisibleWhere(this.prisma, user)] },
            })
          : [],
        propertyIds.length
          ? this.prisma.activityLogEntry.findMany({
              where: { propertyId: { in: propertyIds } },
            })
          : [],
      ]);

    const items = [
      ...issues.map((i) => ({
        id: `issue:${i.id}`,
        type: 'incidencia' as const,
        title: i.title,
        description: i.description,
        date: i.date.toISOString(),
        propertyId: null,
        estateId: i.estateId,
      })),
      ...receipts.map((r) => ({
        id: `receipt:${r.id}`,
        type: 'recibo' as const,
        title: r.concept,
        description: `${r.amount.toString()} € · ${r.status}`,
        date: r.date.toISOString(),
        propertyId: r.propertyId,
      })),
      ...communications.map((c) => ({
        id: `communication:${c.id}`,
        type: 'comunicado' as const,
        title: c.title,
        description: c.body.slice(0, 100),
        date: c.date.toISOString(),
        propertyId: null,
      })),
      ...documents.map((d) => ({
        id: `document:${d.id}`,
        type: 'documento' as const,
        title: d.title,
        description: d.type,
        date: d.date.toISOString(),
        propertyId: null,
      })),
      // Filas explícitas del activity_log — solo eventos sin timeline
      // propio (aprobación/rechazo de adhesiones).
      ...logEntries.map((l) => ({
        id: `log:${l.id}`,
        type: 'solicitud' as const,
        title: l.summary,
        description: `${l.subjectType} · ${l.verb}`,
        date: l.occurredAt.toISOString(),
        propertyId: l.propertyId,
      })),
    ];

    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
}
