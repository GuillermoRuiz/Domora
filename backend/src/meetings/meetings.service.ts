import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../prisma/client';
import { LibraryService } from '../documents/library.service';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ConvocatoriaPreviewDto,
  CreateMeetingDto,
} from './dto/create-meeting.dto';
import type { UpdateMeetingDto } from './dto/update-meeting.dto';
import type { UpdateMeetingStateDto } from './dto/update-meeting-state.dto';
import type { UpdateMeetingStatusDto } from './dto/update-meeting-status.dto';
import type { PostChatMessageDto } from './dto/post-chat-message.dto';
import type { PresenceHeartbeatDto } from './dto/presence-heartbeat.dto';
import type { RecordAttendanceDto } from './dto/record-attendance.dto';
import type { MarkRollCallDto } from './dto/mark-roll-call.dto';
import { ConvocatoriaDocxService } from './convocatoria-docx.service';
import {
  buildDefaultConvocatoria,
  type ConvocatoriaDocument,
} from './convocatoria-document';
import { ActaDocxService } from './acta-docx.service';
import type { ActaDocumentModel } from './acta/acta-document.model';
import {
  MeetingQuorumService,
  type QuorumResult,
} from './meeting-quorum.service';
import { MeetingEligibilityService } from './meeting-eligibility.service';
import type { SignActaDto } from './dto/sign-acta.dto';
import type { SaveActaVersionDto } from './dto/save-acta-version.dto';
import type { UpdateRequire2faDto } from './dto/update-require-2fa.dto';
import {
  buildJitsiRoomName,
  buildJitsiUrl,
  generateMeetingPassword,
} from './meeting-room.util';
import { resolveFrontendBaseUrl } from '../common/frontend-url';
import { ownerMeetingsLink } from '../common/owner-links';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer) — mismo tipo que en files.controller.ts. */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** "Presente ahora" = heartbeat de presencia visto dentro de esta ventana. */
const PRESENCE_WINDOW_MS = 30_000;

/** Punto del orden del día tal y como se guarda en `Meeting.agenda` (JSON). */
interface AgendaItemRecord {
  id: string;
  title: string;
  hasVote?: boolean;
  voteTemplate?: { questions?: { type?: string }[] };
  treatedAt?: string;
  comments?: string;
}

/** Una clave a `undefined` significa «quitarla»: no debe llegar al JSON. */
function withoutUndefined(entry: AgendaItemRecord): AgendaItemRecord {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as unknown as AgendaItemRecord;
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly docx: ConvocatoriaDocxService,
    private readonly notifications: NotificationsService,
    private readonly quorum: MeetingQuorumService,
    private readonly eligibility: MeetingEligibilityService,
    private readonly actaDocx: ActaDocxService,
    private readonly library: LibraryService,
  ) {}

  private frontendBaseUrl(): string {
    return resolveFrontendBaseUrl(this.config);
  }

  private withLinks<T extends { id: string; jitsiRoomName: string | null }>(
    meeting: T,
  ) {
    const base = this.frontendBaseUrl();
    return {
      ...meeting,
      waitRoomUrl: `${base}/wait/${meeting.id}`,
      beaconUrl: `${base}/beacon/${meeting.id}`,
      jitsiUrl: meeting.jitsiRoomName
        ? buildJitsiUrl(meeting.jitsiRoomName)
        : null,
    };
  }

  private async resolveDisplayName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    return user?.fullName ?? 'Usuario';
  }

  /** Crear/gestionar juntas (incluido el panel de anfitrión) es Rol B — ver plan, decisión #4. */
  private assertManager(user: AuthenticatedUser): void {
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo un administrador de finca puede gestionar la videollamada.',
      );
    }
  }

  private async findMeetingOrThrow(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException(`Junta ${meetingId} no encontrada.`);
    }
    this.estateAccess.assertAccess(meeting.estateId, user);
    return meeting;
  }

  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const meetings = await this.prisma.meeting.findMany({
      where: { estateId },
      include: { state: true },
      orderBy: { scheduledAt1: 'desc' },
    });
    return meetings.map((m) => this.withLinks(m));
  }

  /**
   * Alta de junta. Como es código nuevo (no se reutiliza el Edge Function
   * de React), el toggle `includeJitsi` se respeta desde el día uno: solo
   * se genera sala/password si viene `true`. Sala y estado inicial se
   * crean en la misma transacción para que nunca quede una junta con
   * videollamada a medio crear.
   */
  async create(
    estateId: string,
    dto: CreateMeetingDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    this.assertManager(user);

    const scheduledAt1 = new Date(dto.scheduledAt1);
    const scheduledAt2 = new Date(dto.scheduledAt2);

    const created = await this.prisma.$transaction(async (tx) => {
      const meeting = await tx.meeting.create({
        data: {
          estateId,
          title: dto.title,
          type: dto.type,
          scheduledAt1,
          scheduledAt2,
          // class-validator/class-transformer produce instancias de AgendaItemDto,
          // no objetos planos — Prisma exige InputJsonValue (estructural, con
          // índice de string) para columnas Json, de ahí el cast: el dato en sí
          // ya es JSON-serializable (son instancias con solo propiedades planas).
          agenda: dto.agenda as unknown as Prisma.InputJsonValue,
          convokedBy: dto.convokedBy,
          location: dto.location ?? null,
          locationPlaceId: dto.locationPlaceId ?? null,
          locationLat: dto.locationLat ?? null,
          locationLng: dto.locationLng ?? null,
          signerRole: dto.signerRole,
          signerName: dto.signerName ?? null,
          convocatoriaDoc: dto.convocatoria
            ? (dto.convocatoria as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          attendeeEmails: dto.attendeeEmails,
          includeJitsi: dto.includeJitsi,
          createdByUserId: user.id,
          telematicBackingConfirmedAt:
            dto.includeJitsi && dto.telematicBackingConfirmed
              ? new Date()
              : null,
          telematicBackingConfirmedByUserId:
            dto.includeJitsi && dto.telematicBackingConfirmed ? user.id : null,
        },
      });

      let jitsiRoomName: string | null = null;
      let jitsiAccessPassword: string | null = null;
      if (dto.includeJitsi) {
        // El nombre depende del meeting.id ya asignado — por eso la sala se
        // rellena en un UPDATE dentro de la misma transacción, no en el
        // CREATE inicial (mejora sobre el original: dos juntas simultáneas
        // de la misma finca nunca comparten sala, porque cada una deriva la
        // suya del propio id, no del estateId).
        jitsiRoomName = buildJitsiRoomName(meeting.id);
        jitsiAccessPassword = generateMeetingPassword();
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { jitsiRoomName, jitsiAccessPassword },
        });
      }

      await tx.meetingState.create({
        data: { meetingId: meeting.id, scheduledStartAt: scheduledAt1 },
      });

      return { ...meeting, jitsiRoomName, jitsiAccessPassword };
    });

    const result = this.withLinks(created);

    // Invitaciones por email — solo si hay videollamada de verdad a la que
    // enlazar (el envío de convocatorias para juntas SIN videollamada es
    // una funcionalidad aparte, fuera de alcance de esta historia). Un
    // fallo de un destinatario no debe tumbar la creación de la junta, que
    // ya persistió correctamente — se loguea y se sigue con el resto.
    if (created.includeJitsi && dto.attendeeEmails.length > 0) {
      await Promise.all(
        dto.attendeeEmails.map((email) =>
          this.mail
            .sendMeetingInvite(
              email,
              dto.title,
              result.waitRoomUrl,
              created.jitsiAccessPassword,
            )
            .catch((error: unknown) =>
              this.logger.warn(
                `No se pudo enviar la invitación a ${email}: ${String(error)}`,
              ),
            ),
        ),
      );
    }

    return result;
  }

  async findOne(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    return this.withLinks(meeting);
  }

  /** ¿El DTO modifica algún dato con el que se redactó la convocatoria (comparado con lo guardado)? */
  private changesConvocatoriaData(
    meeting: {
      title: string;
      type: string;
      convokedBy: string;
      location: string | null;
      signerRole: string;
      signerName: string | null;
      agenda: unknown;
      scheduledAt1: Date;
      scheduledAt2: Date;
    },
    dto: UpdateMeetingDto,
    scheduledAt1: Date,
    scheduledAt2: Date,
  ): boolean {
    const titles = (agenda: unknown) =>
      JSON.stringify(
        (Array.isArray(agenda) ? agenda : []).map((item) =>
          String((item as { title?: unknown })?.title ?? '').trim(),
        ),
      );
    return (
      (dto.title !== undefined && dto.title !== meeting.title) ||
      (dto.type !== undefined && dto.type !== meeting.type) ||
      (dto.convokedBy !== undefined && dto.convokedBy !== meeting.convokedBy) ||
      (dto.scheduledAt1 !== undefined &&
        scheduledAt1.getTime() !== meeting.scheduledAt1.getTime()) ||
      (dto.scheduledAt2 !== undefined &&
        scheduledAt2.getTime() !== meeting.scheduledAt2.getTime()) ||
      (dto.location !== undefined &&
        (dto.location || null) !== (meeting.location || null)) ||
      (dto.signerRole !== undefined && dto.signerRole !== meeting.signerRole) ||
      (dto.signerName !== undefined &&
        (dto.signerName || null) !== (meeting.signerName || null)) ||
      (dto.agenda !== undefined &&
        titles(dto.agenda) !== titles(meeting.agenda))
    );
  }

  /**
   * Edita los datos de la convocatoria de una junta que sigue `convocada`
   * (una celebrada/cancelada es un registro cerrado). Solo se toca lo que
   * viene en el DTO. Una vez abierta
   * alguna votación (abierta o cerrada) la junta ya no se puede editar.
   */
  async update(
    meetingId: string,
    dto: UpdateMeetingDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);

    if (meeting.status !== 'convocada') {
      throw new ConflictException(
        `La junta ya está ${meeting.status}: no se puede editar.`,
      );
    }

    // Con alguna votación abierta o cerrada la junta queda congelada: los votos ya emitidos
    // se refieren a su convocatoria, fecha y orden del día.
    if ((await this.prisma.voteSession.count({ where: { meetingId } })) > 0) {
      throw new ConflictException(
        'No se puede editar la junta: ya se han iniciado votaciones.',
      );
    }

    const scheduledAt1 = dto.scheduledAt1
      ? new Date(dto.scheduledAt1)
      : meeting.scheduledAt1;
    const scheduledAt2 = dto.scheduledAt2
      ? new Date(dto.scheduledAt2)
      : meeting.scheduledAt2;
    if (scheduledAt2.getTime() <= scheduledAt1.getTime()) {
      throw new BadRequestException(
        'La 2ª convocatoria debe ser posterior a la 1ª convocatoria.',
      );
    }

    const data: Prisma.MeetingUpdateManyMutationInput = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.scheduledAt1 !== undefined && { scheduledAt1 }),
      ...(dto.scheduledAt2 !== undefined && { scheduledAt2 }),
      ...(dto.agenda !== undefined && {
        agenda: dto.agenda as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.convokedBy !== undefined && { convokedBy: dto.convokedBy }),
      ...(dto.location !== undefined && {
        location: dto.location,
        // El lugar cambió: el place-id y las coordenadas anteriores ya no valen.
        locationPlaceId: dto.locationPlaceId ?? null,
        locationLat: dto.locationLat ?? null,
        locationLng: dto.locationLng ?? null,
      }),
      ...(dto.signerRole !== undefined && { signerRole: dto.signerRole }),
      ...(dto.signerName !== undefined && {
        signerName: dto.signerName || null,
      }),
      // La convocatoria editada a mano se escribió con los datos de entonces: si cambian, se vuelve a
      // redactar la habitual con los nuevos (el asistente de edición no incluye el paso de la convocatoria).
      // El asistente reenvía todos los campos aunque no se toquen: solo cuenta lo que de verdad cambia.
      ...(meeting.convocatoriaDoc != null &&
        this.changesConvocatoriaData(
          meeting,
          dto,
          scheduledAt1,
          scheduledAt2,
        ) && { convocatoriaDoc: Prisma.DbNull }),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      // `status: 'convocada'` en el propio UPDATE: si otro gestor cierra la
      // junta a la vez, la edición no pisa una junta ya cerrada.
      const { count } = await tx.meeting.updateMany({
        where: { id: meetingId, status: 'convocada' },
        data,
      });
      if (count === 0) {
        throw new ConflictException(
          'La junta ya no está pendiente: no se puede editar.',
        );
      }
      if (dto.scheduledAt1 !== undefined) {
        await tx.meetingState.updateMany({
          where: { meetingId },
          data: { scheduledStartAt: scheduledAt1 },
        });
      }
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'meeting',
          subjectId: meetingId,
          verb: 'updated',
          summary: `Junta "${dto.title ?? meeting.title}" editada`,
          occurredAt: new Date(),
          estateId: meeting.estateId,
          propertyId: null,
        },
      });
      return tx.meeting.findUniqueOrThrow({
        where: { id: meetingId },
        include: { state: true },
      });
    });
    return this.withLinks(updated);
  }

  async getState(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    return this.prisma.meetingState.findUnique({ where: { meetingId } });
  }

  /**
   * Aplica solo los campos presentes en el DTO (merge, no reemplazo) — cada
   * acción del panel de anfitrión ("Estoy listo", reprogramar, anunciar,
   * "Redirigir ahora") toca un subconjunto distinto. `redirectNow` es un
   * disparador: cuando llega en true se escribe `redirectRequestedAt =
   * now()`, nunca se persiste el booleano en sí (equivalente al
   * `broadcast('redirect_now')` del canal realtime original).
   */
  async updateState(
    meetingId: string,
    dto: UpdateMeetingStateDto,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);

    const data: {
      adminReady?: boolean;
      adminLastSeenAt?: Date;
      scheduledStartAt?: Date;
      announcement?: string;
      announcementSetAt?: Date;
      redirectRequestedAt?: Date;
    } = {};

    if (dto.adminReady !== undefined) {
      data.adminReady = dto.adminReady;
      data.adminLastSeenAt = new Date();
    }
    if (dto.scheduledStartAt) {
      data.scheduledStartAt = new Date(dto.scheduledStartAt);
    }
    if (dto.announcement !== undefined) {
      data.announcement = dto.announcement;
      data.announcementSetAt = new Date();
    }
    if (dto.redirectNow) {
      data.redirectRequestedAt = new Date();
    }

    return this.prisma.meetingState.upsert({
      where: { meetingId },
      update: data,
      create: { meetingId, ...data },
    });
  }

  private agendaOf(meeting: { agenda: unknown }): AgendaItemRecord[] {
    return (meeting.agenda as AgendaItemRecord[] | null) ?? [];
  }

  /**
   * Cambia un punto del orden del día (JSON) y deja constancia en el log. `guard` va en el
   * propio UPDATE: si otro gestor cierra la junta o se firma el acta a la vez, no se escribe.
   */
  private async patchAgendaItem(
    meeting: { id: string; estateId: string; title: string; agenda: unknown },
    item: AgendaItemRecord,
    changes: Partial<AgendaItemRecord>,
    guard: Prisma.MeetingWhereInput,
    conflictMessage: string,
    summary: string,
    user: AuthenticatedUser,
  ) {
    const nextAgenda = this.agendaOf(meeting).map((entry) =>
      entry.id === item.id ? withoutUndefined({ ...entry, ...changes }) : entry,
    );
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.meeting.updateMany({
        where: { id: meeting.id, ...guard },
        data: { agenda: nextAgenda as unknown as Prisma.InputJsonValue },
      });
      if (count === 0) throw new ConflictException(conflictMessage);
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'meeting',
          subjectId: meeting.id,
          verb: 'updated',
          summary,
          occurredAt: new Date(),
          estateId: meeting.estateId,
        },
      });
      return tx.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    });
  }

  private findAgendaItemOrThrow(
    meeting: { agenda: unknown },
    itemId: string,
  ): AgendaItemRecord {
    const item = this.agendaOf(meeting).find((entry) => entry.id === itemId);
    if (!item)
      throw new NotFoundException(
        `No hay ningún punto del orden del día con id "${itemId}".`,
      );
    return item;
  }

  /**
   * Da por tratado un punto del orden del día que no lleva votación (los puntos con
   * votación se dan por tratados al cerrar su votación). Solo con la junta convocada.
   * Es idempotente: marcar dos veces el mismo punto no cambia la fecha.
   */
  async markAgendaItemTreated(
    meetingId: string,
    itemId: string,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    if (meeting.status !== 'convocada') {
      throw new ConflictException(
        `La junta ya está ${meeting.status}: no se pueden cambiar sus puntos.`,
      );
    }
    const item = this.findAgendaItemOrThrow(meeting, itemId);
    const votable =
      !!item.hasVote &&
      !!item.voteTemplate?.questions?.some(
        (question) => question.type !== 'text',
      );
    if (votable) {
      throw new BadRequestException(
        'Un punto con votación se da por tratado al cerrar su votación.',
      );
    }
    if (item.treatedAt) return meeting;
    return this.patchAgendaItem(
      meeting,
      item,
      { treatedAt: new Date().toISOString() },
      { status: 'convocada' },
      'La junta ya no está convocada: no se pueden cambiar sus puntos.',
      `Punto "${item.title}" tratado en "${meeting.title}"`,
      user,
    );
  }

  /** Quita la marca de «tratado» de un punto sin votación (mismas reglas que al marcarlo). Idempotente. */
  async clearAgendaItemTreated(
    meetingId: string,
    itemId: string,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    if (meeting.status !== 'convocada') {
      throw new ConflictException(
        `La junta ya está ${meeting.status}: no se pueden cambiar sus puntos.`,
      );
    }
    const item = this.findAgendaItemOrThrow(meeting, itemId);
    if (!item.treatedAt) return meeting;
    return this.patchAgendaItem(
      meeting,
      item,
      { treatedAt: undefined },
      { status: 'convocada' },
      'La junta ya no está convocada: no se pueden cambiar sus puntos.',
      `Marca de tratado quitada del punto "${item.title}" en "${meeting.title}"`,
      user,
    );
  }

  /**
   * Comentarios del administrador sobre un punto (salen en el acta). Se pueden escribir
   * mientras la junta está convocada o celebrada y el acta aún no se ha firmado — firmada,
   * el acta es un documento cerrado. Un texto vacío borra los comentarios.
   */
  async setAgendaItemComments(
    meetingId: string,
    itemId: string,
    comments: string,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    if (meeting.status === 'cancelada') {
      throw new ConflictException(
        'La junta está cancelada: no se pueden cambiar sus puntos.',
      );
    }
    if (meeting.status === 'firmada') {
      throw new ConflictException(
        'El acta ya está firmada: no se pueden cambiar los comentarios de los puntos.',
      );
    }
    const item = this.findAgendaItemOrThrow(meeting, itemId);
    const text = comments.trim();
    if ((item.comments ?? '') === text) return meeting;
    return this.patchAgendaItem(
      meeting,
      item,
      { comments: text || undefined },
      { status: { in: ['convocada', 'celebrada'] } },
      'La junta ya no admite cambios en sus puntos (cancelada o con el acta firmada).',
      `Comentarios del punto "${item.title}" ${text ? 'actualizados' : 'eliminados'} en "${meeting.title}"`,
      user,
    );
  }

  /** Versiones guardadas del texto del acta, de la más reciente a la más antigua. */
  async listActaVersions(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    const versions = await this.prisma.meetingActaVersion.findMany({
      where: { meetingId },
      orderBy: { versionNumber: 'desc' },
      include: { savedBy: { select: { fullName: true } } },
    });
    return versions.map((version) => this.toActaVersion(version));
  }

  private toActaVersion(version: {
    id: string;
    versionNumber: number;
    generalComments: string | null;
    nextSteps: string | null;
    pointComments: unknown;
    createdAt: Date;
    savedBy?: { fullName: string } | null;
  }) {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      createdAt: version.createdAt,
      savedByName: version.savedBy?.fullName ?? null,
      generalComments: version.generalComments,
      nextSteps: version.nextSteps,
      pointComments: version.pointComments as {
        id: string;
        title: string;
        comments: string;
      }[],
    };
  }

  /**
   * Guarda una versión del texto del acta (comentarios generales, próximos pasos y comentarios
   * de cada punto) y deja esos textos como los vigentes. Se puede con la junta convocada o
   * celebrada; con el acta firmada o la junta cancelada ya no. Si nada ha cambiado desde la
   * última versión no crea otra: devuelve esa misma.
   */
  async saveActaVersion(
    meetingId: string,
    dto: SaveActaVersionDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    if (meeting.status === 'cancelada') {
      throw new ConflictException('La junta está cancelada: no tiene acta.');
    }
    if (meeting.status === 'firmada') {
      throw new ConflictException(
        'El acta ya está firmada: no se pueden guardar más versiones.',
      );
    }

    const agenda = this.agendaOf(meeting);
    const incoming = new Map<string, string>();
    for (const point of dto.pointComments ?? []) {
      if (!agenda.some((item) => item.id === point.itemId)) {
        throw new NotFoundException(
          `No hay ningún punto del orden del día con id "${point.itemId}".`,
        );
      }
      incoming.set(point.itemId, point.comments.trim());
    }
    const generalComments =
      dto.generalComments !== undefined
        ? dto.generalComments.trim() || null
        : (meeting.actaGeneralComments ?? null);
    const nextSteps =
      dto.nextSteps !== undefined
        ? dto.nextSteps.trim() || null
        : (meeting.actaNextSteps ?? null);
    const nextAgenda = agenda.map((item) =>
      incoming.has(item.id)
        ? withoutUndefined({
            ...item,
            comments: incoming.get(item.id) || undefined,
          })
        : item,
    );
    const pointComments = nextAgenda.map((item) => ({
      id: item.id,
      title: item.title,
      comments: item.comments?.trim() ?? '',
    }));

    try {
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.meetingActaVersion.findFirst({
          where: { meetingId },
          orderBy: { versionNumber: 'desc' },
          include: { savedBy: { select: { fullName: true } } },
        });
        if (
          latest &&
          (latest.generalComments ?? null) === generalComments &&
          (latest.nextSteps ?? null) === nextSteps &&
          JSON.stringify(latest.pointComments) === JSON.stringify(pointComments)
        ) {
          return this.toActaVersion(latest);
        }
        // La guarda va en el propio UPDATE: si el acta se firma o la junta se cancela a la vez, no se escribe.
        const { count } = await tx.meeting.updateMany({
          where: { id: meetingId, status: { in: ['convocada', 'celebrada'] } },
          data: {
            actaGeneralComments: generalComments,
            actaNextSteps: nextSteps,
            agenda: nextAgenda as unknown as Prisma.InputJsonValue,
          },
        });
        if (count === 0) {
          throw new ConflictException(
            'La junta ya no admite cambios en el acta (cancelada o firmada).',
          );
        }
        const created = await tx.meetingActaVersion.create({
          data: {
            meetingId,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            generalComments,
            nextSteps,
            pointComments: pointComments as unknown as Prisma.InputJsonValue,
            savedByUserId: user.id,
          },
          include: { savedBy: { select: { fullName: true } } },
        });
        await tx.activityLogEntry.create({
          data: {
            actorUserId: user.id,
            subjectType: 'meeting',
            subjectId: meetingId,
            verb: 'updated',
            summary: `Acta de "${meeting.title}": versión ${created.versionNumber} guardada`,
            occurredAt: new Date(),
            estateId: meeting.estateId,
          },
        });
        return this.toActaVersion(created);
      });
    } catch (error) {
      // Dos gestores guardando a la vez: gana uno, el otro vuelve a intentarlo.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Otra persona acaba de guardar una versión del acta: vuelve a intentarlo.',
        );
      }
      throw error;
    }
  }

  /**
   * Cierre de la junta — única vía por la que `Meeting.status` sale de
   * `convocada` (hasta ahora nada lo escribía, así que toda junta quedaba
   * "convocada" para siempre y no existía un momento de cierre al que
   * vincular un acta). Los dos destinos son terminales: una junta
   * celebrada o cancelada no se reabre.
   *
   * `celebrada` no se admite antes de la primera convocatoria — es casi
   * seguro un clic equivocado, y una junta no puede haberse celebrado antes
   * de la hora a la que se convocó. `cancelada` sí vale en cualquier
   * momento mientras siga convocada.
   */
  async updateStatus(
    meetingId: string,
    dto: UpdateMeetingStatusDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);

    if (meeting.status !== 'convocada') {
      throw new ConflictException(
        `La junta ya está ${meeting.status}: el estado es definitivo.`,
      );
    }
    if (
      dto.status === 'celebrada' &&
      meeting.scheduledAt1.getTime() > Date.now()
    ) {
      throw new ConflictException(
        'No se puede marcar como celebrada una junta antes de su primera convocatoria.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // La condición `status: 'convocada'` va en el propio UPDATE (no solo
      // en la lectura de arriba): si dos gestores cierran a la vez, solo
      // uno cambia una fila y el otro recibe el conflicto.
      const { count } = await tx.meeting.updateMany({
        where: { id: meetingId, status: 'convocada' },
        data: {
          status: dto.status,
          celebratedAt: dto.status === 'celebrada' ? new Date() : undefined,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'La junta ya no está pendiente: el estado es definitivo.',
        );
      }
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'meeting',
          subjectId: meetingId,
          verb: 'status_changed',
          summary: `Junta "${meeting.title}" ${dto.status}`,
          occurredAt: new Date(),
          estateId: meeting.estateId,
          propertyId: null,
        },
      });
      return tx.meeting.findUniqueOrThrow({
        where: { id: meetingId },
        include: { state: true },
      });
    });
    await this.notifyStatusChange(updated);
    return this.withLinks(updated);
  }

  /**
   * Hasta ahora nadie se enteraba de que una junta se cerró (el propio
   * bug reportado: `Meeting.status` nunca se actualizaba). Avisa al equipo
   * de la gestora y a los residentes de la finca — cada rol con el enlace a
   * su propio panel, ninguno tiene acceso al del otro.
   */
  private async notifyStatusChange(meeting: {
    id: string;
    estateId: string;
    title: string;
    status: string;
  }): Promise<void> {
    const [managerIds, residentIds] = await Promise.all([
      this.notifications.managerIdsOfEstate(meeting.estateId),
      this.notifications.residentIds({ estateId: meeting.estateId }),
    ]);
    const cancelled = meeting.status === 'cancelada';
    await this.notifications.notify({
      userIds: [...managerIds, ...residentIds],
      category: 'meeting',
      title: cancelled
        ? `Junta cancelada: ${meeting.title}`
        : `Junta celebrada: ${meeting.title}`,
      link: {
        B: `/b/estates/${meeting.estateId}?tab=juntas`,
        C: ownerMeetingsLink(meeting.estateId, meeting.id),
      },
      estateId: meeting.estateId,
    });
  }

  /** Heartbeat de vida del admin — llamado cada ~15s mientras el panel de anfitrión está abierto. */
  async heartbeatAdmin(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    return this.prisma.meetingState.upsert({
      where: { meetingId },
      update: { adminLastSeenAt: new Date() },
      create: { meetingId, adminLastSeenAt: new Date() },
    });
  }

  /**
   * Sustituye `presence.track()`/`presence.sync()` de un canal realtime:
   * cada cliente conectado hace upsert de su propia fila cada ~10s.
   */
  async heartbeatPresence(
    meetingId: string,
    dto: PresenceHeartbeatDto,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    const username = await this.resolveDisplayName(user.id);
    return this.prisma.meetingPresence.upsert({
      where: { meetingId_userId: { meetingId, userId: user.id } },
      update: {
        lastSeenAt: new Date(),
        building: dto.building ?? null,
        unit: dto.unit ?? null,
        floor: dto.floor ?? null,
      },
      create: {
        meetingId,
        userId: user.id,
        username,
        building: dto.building ?? null,
        unit: dto.unit ?? null,
        floor: dto.floor ?? null,
      },
    });
  }

  /** "Presentes ahora" = filas con heartbeat dentro de la ventana reciente. */
  async listPresence(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    return this.prisma.meetingPresence.findMany({
      where: {
        meetingId,
        lastSeenAt: { gte: new Date(Date.now() - PRESENCE_WINDOW_MS) },
      },
      orderBy: { username: 'asc' },
    });
  }

  /**
   * Autodeclaración explícita — nunca automática (ver plan de Fase 1): el
   * propio usuario elige por cuál(es) propiedad(es) está presente entre las
   * suyas y las que lleva por delegación. Sigue exigiendo videollamada
   * activa (el pase de lista manual, más abajo, cubre las juntas sin
   * Jitsi).
   */
  async recordAttendance(
    meetingId: string,
    dto: RecordAttendanceDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    if (!meeting.includeJitsi) {
      throw new ForbiddenException(
        'Esta junta no tiene videollamada activada.',
      );
    }
    const displayName = await this.resolveDisplayName(user.id);
    const role = user.role === 'A' || user.role === 'B' ? 'admin' : 'attendee';
    const rows = [];
    for (const propertyId of dto.propertyIds) {
      await this.eligibility.assertEligibleForProperty(
        meetingId,
        propertyId,
        user.id,
      );
      rows.push(
        await this.prisma.meetingAttendance.upsert({
          where: {
            meetingId_propertyId_userId: {
              meetingId,
              propertyId,
              userId: user.id,
            },
          },
          update: {},
          create: {
            meetingId,
            propertyId,
            userId: user.id,
            displayName,
            role,
            source: 'jitsi',
          },
        }),
      );
    }
    return rows;
  }

  /** Propiedades propias + delegaciones activas del usuario para esta junta — puebla el selector de la sala de espera. */
  async listMyAttendanceOptions(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const [memberships, delegations] = await Promise.all([
      this.prisma.propertyMembership.findMany({
        where: {
          userId: user.id,
          status: 'linked',
          roleType: { in: ['Propietario', 'Representante'] },
          property: { estateId: meeting.estateId, deletedAt: null },
        },
        include: { property: { select: { id: true, ref: true } } },
      }),
      this.prisma.meetingVoteDelegation.findMany({
        where: { meetingId, representativeUserId: user.id, revokedAt: null },
        include: { property: { select: { id: true, ref: true } } },
      }),
    ]);
    return [
      ...memberships.map((m) => ({
        propertyId: m.property.id,
        label: m.property.ref ?? m.property.id,
        kind: 'own' as const,
      })),
      ...delegations.map((d) => ({
        propertyId: d.property.id,
        label: d.property.ref ?? d.property.id,
        kind: 'delegated' as const,
      })),
    ];
  }

  /** Sin gating de rol — cualquiera con acceso a la finca puede ver quién ha asistido, igual que `listPresence`. */
  async listAttendance(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    return this.prisma.meetingAttendance.findMany({
      where: { meetingId },
      include: { property: { select: { ref: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async getQuorum(
    meetingId: string,
    user: AuthenticatedUser,
  ): Promise<QuorumResult> {
    await this.findMeetingOrThrow(meetingId, user);
    return this.quorum.computeQuorum(meetingId);
  }

  /** Identidades elegibles para el desplegable del pase de lista de una propiedad. */
  async listRollCallEligible(
    meetingId: string,
    propertyId: string,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    return this.eligibility.listEligibleAttendeeIds(meetingId, propertyId);
  }

  /** Titulares de cada propiedad de la finca de la junta, para mostrar sus nombres en la participación. */
  async listRollCallHolders(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    return this.eligibility.listHoldersByEstate(meeting.estateId);
  }

  /** Pase de lista presencial — la gestora marca asistencia por propiedad, con o sin videollamada. */
  async markRollCall(
    meetingId: string,
    dto: MarkRollCallDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    await this.eligibility.assertEligibleForProperty(
      meetingId,
      dto.propertyId,
      dto.userId,
    );
    const displayName = await this.resolveDisplayName(dto.userId);
    const created = await this.prisma.meetingAttendance.upsert({
      where: {
        meetingId_propertyId_userId: {
          meetingId,
          propertyId: dto.propertyId,
          userId: dto.userId,
        },
      },
      update: { source: 'manual', markedByUserId: user.id },
      create: {
        meetingId,
        propertyId: dto.propertyId,
        userId: dto.userId,
        displayName,
        role: 'attendee',
        source: 'manual',
        markedByUserId: user.id,
      },
    });
    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'created',
        summary: `Asistencia marcada a mano para "${meeting.title}"`,
        occurredAt: new Date(),
        estateId: meeting.estateId,
        propertyId: dto.propertyId,
      },
    });
    return created;
  }

  /** Corrige un pase de lista equivocado — también sirve para deshacer una entrada registrada por Jitsi. */
  async undoRollCall(
    meetingId: string,
    attendanceId: string,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    const attendance = await this.prisma.meetingAttendance.findFirst({
      where: { id: attendanceId, meetingId },
    });
    if (!attendance) {
      throw new NotFoundException(`Asistencia ${attendanceId} no encontrada.`);
    }
    await this.prisma.meetingAttendance.delete({ where: { id: attendanceId } });
    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'deleted',
        summary: `Asistencia deshecha en "${meeting.title}"`,
        occurredAt: new Date(),
        estateId: meeting.estateId,
        propertyId: attendance.propertyId,
      },
    });
  }

  async listChatMessages(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    return this.prisma.meetingChatMessage.findMany({
      where: { meetingId },
      orderBy: { sentAt: 'asc' },
      take: 200,
    });
  }

  async postChatMessage(
    meetingId: string,
    dto: PostChatMessageDto,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    const senderName = await this.resolveDisplayName(user.id);
    return this.prisma.meetingChatMessage.create({
      data: { meetingId, senderId: user.id, senderName, text: dto.text },
    });
  }

  /**
   * Redacta la convocatoria habitual con los datos de una junta que todavía no existe: es el punto de
   * partida que la gestora edita en el tercer paso del alta.
   */
  async previewConvocatoria(
    estateId: string,
    dto: ConvocatoriaPreviewDto,
    user: AuthenticatedUser,
  ): Promise<ConvocatoriaDocument> {
    this.estateAccess.assertAccess(estateId, user);
    this.assertManager(user);
    const scheduledAt1 = new Date(dto.scheduledAt1);
    const scheduledAt2 = new Date(dto.scheduledAt2);
    if (scheduledAt2.getTime() <= scheduledAt1.getTime()) {
      throw new BadRequestException(
        'La 2ª convocatoria debe ser posterior a la 1ª convocatoria.',
      );
    }
    const estate = await this.prisma.estate.findUnique({
      where: { id: estateId },
      select: { name: true, location: true },
    });
    if (!estate)
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    return buildDefaultConvocatoria({
      communityName: estate.name,
      communityLocation: estate.location,
      type: dto.type,
      convokedBy: dto.convokedBy,
      scheduledAt1,
      scheduledAt2,
      location: dto.location,
      agenda: dto.agenda,
      signerRole: dto.signerRole,
      signerName: dto.signerName,
      issuedAt: new Date(),
    });
  }

  /** Convocatoria en `.docx`: la que editó la gestora o, si no hay, la habitual con los datos de la junta. */
  async generateConvocatoriaDocx(
    meetingId: string,
    user: AuthenticatedUser,
  ): Promise<{ fileName: string; content: Buffer }> {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const estate = await this.prisma.estate.findUnique({
      where: { id: meeting.estateId },
      select: { name: true, location: true },
    });
    const content = await this.docx.generate(meeting, {
      name: estate?.name ?? '',
      location: estate?.location ?? null,
    });
    const safeName = meeting.title.trim().replace(/\s+/g, '-') || 'junta';
    return { fileName: `convocatoria-${safeName}.docx`, content };
  }

  async listAttachments(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    return this.prisma.meetingAttachment.findMany({
      where: { meetingId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /** Adjuntar documentos a la convocatoria es Rol B/A, igual que crear/gestionar la junta. */
  async uploadAttachment(
    meetingId: string,
    file: UploadedMulterFile,
    title: string | undefined,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(
      `meetings/${meetingId}`,
      file.originalname,
      file.buffer,
    );
    return this.prisma.meetingAttachment.create({
      data: {
        meetingId,
        title: title?.trim() || file.originalname,
        s3Key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  /** Elimina un adjunto (fichero y registro) — solo Rol B/A, igual que subirlo. */
  async deleteAttachment(
    meetingId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    const attachment = await this.prisma.meetingAttachment.findFirst({
      where: { id: attachmentId, meetingId },
    });
    if (!attachment) {
      throw new NotFoundException(`Adjunto ${attachmentId} no encontrado.`);
    }
    await this.prisma.meetingAttachment.delete({ where: { id: attachmentId } });
    await this.storage.delete(attachment.s3Key);
    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'deleted',
        summary: `Documento "${attachment.title}" eliminado de "${meeting.title}"`,
        occurredAt: new Date(),
        estateId: meeting.estateId,
      },
    });
  }

  async downloadAttachment(
    meetingId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ title: string; content: Buffer }> {
    await this.findMeetingOrThrow(meetingId, user);
    const attachment = await this.prisma.meetingAttachment.findFirst({
      where: { id: attachmentId, meetingId },
    });
    if (!attachment) {
      throw new NotFoundException(`Adjunto ${attachmentId} no encontrado.`);
    }
    const content = await this.storage.get(attachment.s3Key);
    return { title: attachment.title, content };
  }

  // ── Acta digital (Fase 2.2) ──────────────────────────────────────────

  /** Réplica local de `PropertiesService.listOwnerEmails` — evita un ciclo de módulos por una sola query. */
  private async listEstateOwnerEmails(
    estateId: string,
  ): Promise<{ email: string; fullName: string }[]> {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { status: 'linked', property: { estateId, deletedAt: null } },
      include: { user: { select: { email: true, fullName: true } } },
    });
    const byEmail = new Map<string, string>();
    for (const m of memberships) {
      if (m.user?.email) byEmail.set(m.user.email, m.user.fullName);
    }
    return [...byEmail.entries()].map(([email, fullName]) => ({
      email,
      fullName,
    }));
  }

  /**
   * Firma el acta (art. 19 LPH: presidente + secretario, la gestora elige
   * qué `User` de la finca firma cada rol — ver comentario en el DTO). Solo
   * genera y persiste el `.docx` cuando AMBAS firmas ya están puestas; hasta
   * entonces solo registra la firma parcial.
   */
  async signActa(meetingId: string, dto: SignActaDto, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    const canonical = await this.assertCanSign(meeting, dto.role);

    const signer = await this.prisma.user.findUnique({
      where: { email: dto.signerEmail },
      select: { id: true },
    });
    if (!signer) {
      throw new NotFoundException(
        `No hay ninguna cuenta de Domora con el email ${dto.signerEmail}.`,
      );
    }
    return this.registerSignature(
      meeting,
      canonical,
      dto.role,
      signer.id,
      user,
    );
  }

  /**
   * Firma de quien está conectado: el presidente de la comunidad (mandato vigente) firma como
   * presidente, y un administrador de finca firma como secretario/administrador. Mismas reglas de
   * orden que `signActa`.
   */
  async signActaAsSelf(
    meetingId: string,
    role: 'presidente' | 'secretario',
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    if (role === 'presidente') {
      if (!(await this.isCurrentPresident(meeting.estateId, user.id))) {
        throw new ForbiddenException(
          'Solo el presidente de la comunidad puede firmar como presidente.',
        );
      }
    } else if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo un administrador de finca puede firmar como secretario/administrador.',
      );
    }
    const alreadySigned =
      role === 'presidente'
        ? meeting.actaSignedByPresidenteUserId
        : meeting.actaSignedBySecretarioUserId;
    if (alreadySigned)
      throw new ConflictException('Esta firma ya está registrada.');
    const canonical = await this.assertCanSign(meeting, role);
    return this.registerSignature(meeting, canonical, role, user.id, user);
  }

  /** ¿Puede firmar ya quien está conectado, y qué firmas faltan? Lo usan las pantallas para mostrar «Firmar». */
  async getActaSigning(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const ready =
      meeting.status === 'celebrada' &&
      (this.hasPendingUpload(meeting) ||
        !!(await this.findReadyActaVersion(meetingId)));
    const presidenteSigned = !!meeting.actaSignedByPresidenteUserId;
    const secretarioSigned = !!meeting.actaSignedBySecretarioUserId;
    const isManager = user.role === 'A' || user.role === 'B';
    return {
      readyForSignature: ready,
      presidenteSigned,
      secretarioSigned,
      canSign: {
        presidente:
          ready &&
          !presidenteSigned &&
          (await this.isCurrentPresident(meeting.estateId, user.id)),
        secretario: ready && presidenteSigned && !secretarioSigned && isManager,
      },
    };
  }

  /** Presidente de la comunidad hoy: mandato de presidente vigente asignado a esta cuenta. */
  private async isCurrentPresident(
    estateId: string,
    userId: string,
  ): Promise<boolean> {
    const now = new Date();
    const term = await this.prisma.estateOfficeTerm.findFirst({
      where: {
        estateId,
        role: 'PRESIDENT',
        userId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true },
    });
    return !!term;
  }

  /** El acta que se firma es un archivo subido (no el borrador generado). */
  private hasPendingUpload(meeting: {
    actaOrigin?: string | null;
    actaUploadS3Key?: string | null;
  }): boolean {
    return meeting.actaOrigin === 'uploaded' && !!meeting.actaUploadS3Key;
  }

  private findReadyActaVersion(meetingId: string) {
    return this.prisma.meetingActaVersion.findFirst({
      where: {
        meetingId,
        generatedAt: { not: null },
        status: 'readyForSignature',
      },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, documentModel: true },
    });
  }

  /** Orden del proceso: acta creada → preparada para firma → presidente → secretario. */
  private async assertCanSign(
    meeting: {
      id: string;
      status: string;
      actaSignedByPresidenteUserId: string | null;
      actaOrigin?: string | null;
      actaUploadS3Key?: string | null;
    },
    role: 'presidente' | 'secretario',
  ): Promise<{ id: string; documentModel: unknown } | null> {
    if (meeting.status === 'firmada') {
      throw new ConflictException('El acta ya está firmada.');
    }
    if (meeting.status !== 'celebrada') {
      throw new ConflictException(
        'Solo se puede firmar el acta de una junta ya celebrada.',
      );
    }
    // Acta subida pendiente de firma: se firma el archivo (no hay versión generada que preparar).
    const uploaded = this.hasPendingUpload(meeting);
    const canonical = uploaded
      ? null
      : await this.findReadyActaVersion(meeting.id);
    if (!uploaded && !canonical) {
      throw new ConflictException(
        'El acta aún no está enviada a firma: revísala y prepárala para la firma primero.',
      );
    }
    if (role === 'secretario' && !meeting.actaSignedByPresidenteUserId) {
      throw new ConflictException(
        'El presidente debe firmar el acta antes que el secretario.',
      );
    }
    return canonical;
  }

  private async registerSignature(
    meeting: {
      id: string;
      estateId: string;
      title: string;
      actaUploadS3Key?: string | null;
    },
    canonical: { id: string; documentModel: unknown } | null,
    role: 'presidente' | 'secretario',
    signerId: string,
    user: AuthenticatedUser,
  ) {
    const meetingId = meeting.id;
    const data =
      role === 'presidente'
        ? { actaSignedByPresidenteUserId: signerId }
        : { actaSignedBySecretarioUserId: signerId };
    let updated = await this.prisma.meeting.update({
      where: { id: meetingId },
      data,
    });

    if (
      updated.actaSignedByPresidenteUserId &&
      updated.actaSignedBySecretarioUserId &&
      !updated.actaSignedAt
    ) {
      // Acta subida: el documento definitivo es el propio archivo. Si no, el .docx sale del modelo de la versión
      // canónica lista para firma (el mismo que el visor y el PDF).
      let s3Key: string;
      if (!canonical) {
        s3Key = meeting.actaUploadS3Key as string;
      } else {
        const content = await this.actaDocx.generateFromModel(
          canonical.documentModel as unknown as ActaDocumentModel,
        );
        const safeName = meeting.title.trim().replace(/\s+/g, '-') || 'junta';
        s3Key = await this.storage.put(
          `meetings/${meetingId}/acta`,
          `acta-${safeName}.docx`,
          content,
        );
      }

      updated = await this.prisma.meeting.update({
        where: { id: meetingId },
        // Con las dos firmas puestas la junta pasa a `firmada`, estado terminal.
        data: { actaS3Key: s3Key, actaSignedAt: new Date(), status: 'firmada' },
      });
      // Punto de integración de la firma avanzada: la versión canónica que se ha firmado queda marcada.
      if (canonical)
        await this.prisma.meetingActaVersion.update({
          where: { id: canonical.id },
          data: { status: 'signed' },
        });
      // The signed acta enters the estate library as «Solo gestora» (documentos-finca D4). Never blocks the signature.
      await this.library
        .registerSignedActa(meetingId)
        .catch((error: unknown) =>
          this.logger.warn(
            `No se pudo añadir el acta firmada a la biblioteca de documentos: ${String(error)}`,
          ),
        );

      await this.prisma.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'meeting',
          subjectId: meetingId,
          verb: 'created',
          summary: `Acta firmada para "${meeting.title}"`,
          occurredAt: new Date(),
          estateId: meeting.estateId,
        },
      });
    }

    return updated;
  }

  async downloadActa(
    meetingId: string,
    user: AuthenticatedUser,
  ): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    if (!meeting.actaS3Key) {
      throw new NotFoundException('Esta junta todavía no tiene acta firmada.');
    }
    const content = await this.storage.get(meeting.actaS3Key);
    // Un acta subida se devuelve con su nombre y tipo; el resto es el Word generado.
    if (meeting.actaOrigin === 'uploaded' && meeting.actaUploadFileName) {
      return {
        content,
        fileName: meeting.actaUploadFileName,
        mimeType: meeting.actaUploadMimeType ?? 'application/octet-stream',
      };
    }
    return {
      content,
      fileName: 'acta.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  /** Distribuye el acta ya firmada a TODOS los propietarios vinculados de la finca, presentes o no (art. 19 LPH). */
  async sendActaNotice(
    meetingId: string,
    user: AuthenticatedUser,
  ): Promise<{ sentCount: number }> {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    if (!meeting.actaSignedAt) {
      throw new ConflictException('El acta todavía no está firmada.');
    }

    const recipients = await this.listEstateOwnerEmails(meeting.estateId);
    // Enlaza a la app, no directo al endpoint de descarga: la API exige el
    // token JWT del propio usuario (Authorization header), que un clic en
    // un email nunca lleva consigo — mismo criterio que sendMeetingInvite,
    // que enlaza a una ruta de la SPA, no a una respuesta cruda de la API.
    const downloadUrl = this.frontendBaseUrl();
    let sentCount = 0;
    await Promise.all(
      recipients.map((r) =>
        this.mail
          .sendActaNotice(r.email, meeting.title, downloadUrl)
          .then(() => {
            sentCount += 1;
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `No se pudo enviar el acta a ${r.email}: ${String(error)}`,
            ),
          ),
      ),
    );

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { actaDistributedAt: new Date() },
    });
    // Sending the acta is what opens it to the owners in the library (D4).
    await this.library
      .publishActa(meetingId)
      .catch((error: unknown) =>
        this.logger.warn(
          `No se pudo publicar el acta en la biblioteca de documentos: ${String(error)}`,
        ),
      );
    return { sentCount };
  }

  /**
   * Fase 2.3 — la gestora exige (o no) 2FA para votar en esta junta. Solo
   * editable antes de que exista ninguna `VoteSession`: cambiarlo después
   * invalidaría implícitamente los votos ya emitidos bajo otra regla.
   */
  async updateRequire2fa(
    meetingId: string,
    dto: UpdateRequire2faDto,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);
    const sessionCount = await this.prisma.voteSession.count({
      where: { meetingId },
    });
    if (sessionCount > 0) {
      throw new ConflictException(
        'Ya hay votaciones en esta junta — no se puede cambiar el requisito de 2FA ahora.',
      );
    }
    return this.prisma.meeting.update({
      where: { id: meetingId },
      data: { require2faForVoting: dto.require2faForVoting },
    });
  }

  // ── Histórico de participación (Fase 2.4) ────────────────────────────

  /**
   * Un método más en el servicio existente, no un módulo de analítica
   * aparte — una sola consulta de solo lectura no justifica esa
   * separación (ver plan, "genuinamente ligero").
   */
  async getParticipationHistory(
    estateId: string,
    user: AuthenticatedUser,
    reporting?: { from?: Date; to?: Date; limit: number },
  ) {
    this.estateAccess.assertAccess(estateId, user);

    const reportingRange = reporting
      ? {
          ...(reporting.from ? { gte: reporting.from } : {}),
          ...(reporting.to
            ? { lte: new Date(reporting.to.getTime() + 86399999) }
            : {}),
        }
      : undefined;

    const [meetings, propertyCount] = await Promise.all([
      this.prisma.meeting.findMany({
        where: {
          estateId,
          status: { in: ['celebrada', 'firmada'] },
          ...(reportingRange
            ? {
                OR: [
                  { celebratedAt: reportingRange },
                  { celebratedAt: null, scheduledAt2: reportingRange },
                ],
              }
            : {}),
        },
        orderBy: { scheduledAt1: 'desc' },
        take: reporting ? reporting.limit + 1 : 20,
      }),
      this.prisma.property.count({ where: { estateId, deletedAt: null } }),
    ]);

    if (reporting && meetings.length > reporting.limit) {
      throw new BadRequestException(
        `El informe supera ${reporting.limit} juntas por comunidad. Reduce el periodo.`,
      );
    }
    return Promise.all(
      meetings.map(async (meeting) => {
        const [quorumResult, delegationCount] = await Promise.all([
          this.quorum.computeQuorum(
            meeting.id,
            meeting.celebratedAt ?? meeting.scheduledAt2,
          ),
          this.prisma.meetingVoteDelegation.count({
            where: { meetingId: meeting.id },
          }),
        ]);
        return {
          meetingId: meeting.id,
          title: meeting.title,
          celebratedAt: meeting.celebratedAt,
          quorumMet: quorumResult.quorumMet,
          delegationUsageRate:
            propertyCount > 0
              ? Math.round((delegationCount / propertyCount) * 10000) / 100
              : 0,
        };
      }),
    );
  }
}
