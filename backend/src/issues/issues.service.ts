import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AssignIssueProviderDto } from './dto/assign-issue-provider.dto';
import type { SendIssueNotificationDto } from './dto/send-issue-notification.dto';
import type { CreateIssueDto } from './dto/create-issue.dto';
import type { SetIssueAssetDto } from './dto/set-issue-asset.dto';
import type { UpdateIssueStatusDto } from './dto/update-issue-status.dto';
import type { UpdateIssueBudgetDto } from './dto/update-issue-budget.dto';
import type { AddIssueTimelineEntryDto } from './dto/add-issue-timeline-entry.dto';
import type {
  IssueStatus,
  IssueTimelineEntry,
  Prisma,
  TimelineAuthorRole,
} from '../prisma/client';
import type { RequestIssueInfoDto } from './dto/owner-issue.dto';
import { issueStatusDates } from './issue-status';
import { assertManualTransition } from './issue-status-transitions';
import { issuePortalLink, issuesOfEstate } from './issue-estate';
import { presentIssueForResident } from './issue-resident-view';
import {
  ACTIVE_ISSUE_STATUSES,
  ISSUE_HAS_PENDING_REQUESTER_NOTICE,
} from './issue-status.constants';
import {
  IssueWorkflowService,
  type RequesterInformResult,
} from '../issue-workflow/issue-workflow.service';
import { actorLabel } from '../issue-workflow/issue-event-kinds';
import {
  ISSUE_HAS_OPEN_INSURANCE_CLAIM,
  NON_TERMINAL_CLAIM_STATUS_FILTER,
} from '../issue-workflow/insurance-claims';
import {
  isTerminalIssueStatus,
  type IssueSituationFilter,
} from '../issue-workflow/issue-situation';
import { IssueSituationService } from '../issue-workflow/issue-situation.service';
import { issueEventData } from '../issue-workflow/issue-events.service';
import { OPEN_STATUSES } from '../agenda-tasks/agenda-task.constants';
import { type PageParams, resolvePage, toPage } from '../common/pagination';

const ISSUE_STATUS_LABELS: Record<string, string> = {
  Abierta: 'Abierta',
  EnReparacion: 'En reparación',
  PendienteProveedor: 'Pendiente proveedor',
  PendienteInformacion: 'Pendiente de información',
  Resuelta: 'Resuelta',
  Cerrada: 'Cerrada',
  Retirada: 'Retirada',
};

/** Instalación a la que se refiere la incidencia (solo la ve la gestión). */
const ASSET_SELECT = { select: { id: true, name: true } };

/**
 * El propietario tampoco recibe el id de la instalación vinculada (`assetId`) ni la vía de gestión
 * (`resolutionRoute`: a quién se atribuye la responsabilidad es cosa de la gestión).
 */
function hideAssetLink<T extends { assetId: string | null }>(
  issue: T,
  user: AuthenticatedUser,
): T {
  if (canSeeInventory(user)) return issue;
  return {
    ...issue,
    assetId: null,
    ...('resolutionRoute' in issue ? { resolutionRoute: null } : {}),
  };
}

/** El inventario de la finca (instalaciones) es cosa de la gestión: el propietario no lo ve. */
function canSeeInventory(user: AuthenticatedUser): boolean {
  return user.role !== 'C';
}

const TIMELINE_INCLUDE = {
  orderBy: { date: 'desc' as const },
  include: { authorUser: { select: { fullName: true } } },
};

type PresentedTimelineEntry = Omit<
  IssueTimelineEntry,
  'meta' | 'refType' | 'refId'
> &
  Partial<Pick<IssueTimelineEntry, 'meta' | 'refType' | 'refId'>> & {
    author: string;
  };

/**
 * El frontend consume `author` como nombre para mostrar — se resuelve acá
 * en vez de que cada pantalla tenga que hacer su propio lookup. Sin usuario,
 * el nombre sale de QUIÉN actuó (Domora, el sistema, un tercero).
 *
 * El propietario ve la historia de su incidencia, no la maquinaria: no recibe
 * los eventos internos (tareas, esperas) ni el detalle técnico (`meta`) ni
 * las referencias a artefactos de gestión.
 */
function withAuthorName(
  entries: (IssueTimelineEntry & {
    authorUser: { fullName: string } | null;
  })[],
  user: AuthenticatedUser,
): PresentedTimelineEntry[] {
  const manager = user.role !== 'C';
  return entries
    .filter((e) => manager || !e.internal)
    .map((e) => {
      const { authorUser, meta, refType, refId, ...rest } = e;
      const author = authorUser?.fullName ?? actorLabel(e.actorKind);
      return manager
        ? { ...rest, meta, refType, refId, author }
        : { ...rest, author };
    });
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly workflow?: IssueWorkflowService,
    @Optional() private readonly situation?: IssueSituationService,
    /** Pertenencia a la comunidad del rol C (el JWT solo lleva fincas, y no se fía). Sin él, un propietario no ve nada: falla cerrado. */
    @Optional() private readonly propertyAccess?: PropertyAccessService,
  ) {}

  /** Rol de autoría en el timeline según el rol de plataforma del usuario. */
  private authorRoleFor(user: AuthenticatedUser): TimelineAuthorRole {
    return user.role === 'C' ? 'Propietario' : 'Administrador';
  }

  /**
   * Una incidencia es de la comunidad. La gestión (A y B) accede por finca. Un propietario o inquilino (rol C) solo si es miembro
   * ACTIVO de esa comunidad (comprobado en la base de datos, nunca por el JWT); si no lo es, recibe EXACTAMENTE lo mismo que si la
   * incidencia no existiera: un error distinto revelaría que existe.
   */
  async assertIssueAccess(issueId: string, user: AuthenticatedUser) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
    });
    if (!issue) {
      throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
    }
    if (user.role === 'C') {
      if (!(await this.isCommunityMember(issue.estateId, user)))
        throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
      return issue;
    }
    this.estateAccess.assertAccess(issue.estateId, user);
    return issue;
  }

  /** ¿Miembro activo de esa comunidad? Sin el servicio de acceso, nadie (falla cerrado). */
  private async isCommunityMember(
    estateId: string | null,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    return (
      !!this.propertyAccess &&
      (await this.propertyAccess.isActiveMember(estateId, user))
    );
  }

  /** ¿Es `userId` una de las personas que reportaron la incidencia? (el reportante NO es su dueño: solo habilita notas y fotos). */
  async isReporter(issueId: string, userId: string): Promise<boolean> {
    return (
      (await this.prisma.issueReport.count({
        where: { issueId, reporterUserId: userId },
      })) > 0
    );
  }

  /**
   * Las incidencias de una finca se acumulan indefinidamente (nunca se
   * archivan), y cada una arrastra sus fotos y su historial completo, así que
   * sin paginar el coste crecía con el histórico entero de la comunidad.
   * Paginar acota de paso lo anidado: menos filas padre, menos hijas.
   */
  async listByEstate(
    estateId: string,
    user: AuthenticatedUser,
    params: PageParams & {
      assetId?: string;
      /** Filtro de trabajo por situación (solo gestión): `ISSUE_SITUATION_FILTERS`. */
      situation?: IssueSituationFilter;
    } = {},
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const resolved = resolvePage(params);
    // El propietario no ve el inventario de la finca: ni la instalación vinculada
    // ni su id, y tampoco puede filtrar por instalación (sondear qué incidencias
    // pertenecen a cuál).
    if (params.assetId && !canSeeInventory(user)) {
      throw new BadRequestException(
        'Solo la gestión puede filtrar las incidencias por instalación.',
      );
    }
    // La situación es una proyección del workflow, solo visible para la gestión.
    if (params.situation && !canSeeInventory(user)) {
      throw new BadRequestException(
        'Solo la gestión puede filtrar las incidencias por situación.',
      );
    }
    // `situation`: se resuelve con la MISMA proyección que el detalle y el resumen y se pagina sobre el resultado.
    // Sin filtro, la consulta es exactamente la de siempre.
    let situationIds: string[] | undefined;
    if (params.situation) {
      if (!this.situation)
        throw new BadRequestException(
          'El filtro por situación no está disponible.',
        );
      situationIds = await this.situation.issueIdsInFilter(
        estateId,
        params.situation,
      );
    }
    // `assetId`: solo las incidencias de esa instalación (la finca ya acota, así que una instalación ajena no devuelve nada).
    // Rol C: solo si es miembro ACTIVO de la comunidad (el mismo criterio que `assertIssueAccess`); si no, no ve ninguna.
    const resident = user.role === 'C';
    if (resident && !(await this.isCommunityMember(estateId, user)))
      return toPage(0, resolved, []);
    const where: Prisma.IssueWhereInput = {
      deletedAt: null,
      ...issuesOfEstate(estateId),
      ...(params.assetId ? { assetId: params.assetId } : {}),
      ...(situationIds ? { id: { in: situationIds } } : {}),
    };

    const [total, issues] = await Promise.all([
      this.prisma.issue.count({ where }),
      this.prisma.issue.findMany({
        where,
        include: {
          photos: true,
          timeline: TIMELINE_INCLUDE,
          ...(canSeeInventory(user) ? { asset: ASSET_SELECT } : {}),
        },
        orderBy: { date: 'desc' },
        skip: resolved.skip,
        take: resolved.take,
      }),
    ]);

    const mine = resident
      ? await this.reportedIssueIds(
          issues.map((i) => i.id),
          user.id,
        )
      : new Set<string>();
    return toPage(
      total,
      resolved,
      issues.map((i) =>
        resident
          ? presentIssueForResident(i, user.id, mine.has(i.id))
          : hideAssetLink(
              { ...i, timeline: withAuthorName(i.timeline, user) },
              user,
            ),
      ),
    );
  }

  /** De esas incidencias, las que `userId` reportó. */
  private async reportedIssueIds(
    issueIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    if (issueIds.length === 0) return new Set();
    const reports = await this.prisma.issueReport.findMany({
      where: { issueId: { in: issueIds }, reporterUserId: userId },
      select: { issueId: true },
    });
    return new Set(reports.map((r) => r.issueId));
  }

  async findById(id: string, user: AuthenticatedUser) {
    await this.assertIssueAccess(id, user);
    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        photos: true,
        timeline: TIMELINE_INCLUDE,
        // La asignación de proveedores y los avisos enviados son de la gestión: el propietario no los recibe.
        // El propietario tampoco ve el inventario de la finca ni los avisos originales de otros.
        ...(canSeeInventory(user)
          ? {
              providerAssignments: { orderBy: { assignedAt: 'desc' as const } },
              notifications: { orderBy: { sentAt: 'desc' as const } },
              asset: ASSET_SELECT,
              reports: { orderBy: { receivedAt: 'asc' as const } },
            }
          : {}),
      },
    });
    if (!issue) return issue;
    // Para un vecino, la incidencia es una proyección de LISTA BLANCA (nunca el registro entero menos lo que sobra).
    if (user.role === 'C')
      return presentIssueForResident(
        issue,
        user.id,
        await this.isReporter(issue.id, user.id),
      );
    return hideAssetLink(
      { ...issue, timeline: withAuthorName(issue.timeline, user) },
      user,
    );
  }

  /**
   * Genera `ref` secuencial
   * `#INC-<año>-NNN`, estado inicial `Abierta`, y siembra el timeline con la
   * descripción como primera entrada. `source` no se confía del cliente —
   * se infiere del rol de plataforma (C reporta como propietario, A/B da de
   * alta en nombre de la comunidad).
   *
   * Una incidencia es SIEMPRE de la comunidad (no de una vivienda): la puede dar de alta la gestión (en nombre de la comunidad) o
   * cualquier miembro ACTIVO de ella (comprobado en la base de datos). Quien la reporta queda en `IssueReport`: es reportante, no dueño.
   */
  async create(estateId: string, dto: CreateIssueDto, user: AuthenticatedUser) {
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { id: true },
    });
    if (!estate) throw new NotFoundException('Finca no encontrada.');
    if (user.role === 'C') {
      if (!(await this.isCommunityMember(estateId, user)))
        throw new ForbiddenException(
          'Solo los miembros de la comunidad pueden reportar una incidencia en sus zonas comunes.',
        );
    } else {
      this.estateAccess.assertAccess(estateId, user);
    }
    return this.createIssue({ estateId }, dto, user);
  }

  /** Alta manual de una incidencia. */
  private async createIssue(
    target: { estateId: string },
    dto: CreateIssueDto,
    user: AuthenticatedUser,
  ) {
    if (dto.assetId) {
      // Vincular una instalación es cosa de la gestión: el propietario no ve el inventario.
      if (!canSeeInventory(user)) {
        throw new BadRequestException(
          'Solo la gestión puede vincular una instalación a la incidencia.',
        );
      }
      await this.assertAssetInEstate(dto.assetId, target.estateId);
    }
    // El canal, la referencia y quien avisa los indica la gestión; un propietario avisa siempre por el formulario.
    if (
      user.role === 'C' &&
      (dto.channel !== undefined ||
        dto.sourceRef !== undefined ||
        dto.reporterName !== undefined ||
        dto.reporterContact !== undefined ||
        dto.reporterUserId !== undefined ||
        dto.resolutionRoute !== undefined)
    ) {
      throw new ForbiddenException(
        'Solo la gestión puede indicar el canal del aviso.',
      );
    }

    // El reportante con cuenta tiene que ser miembro ACTIVO de esta comunidad (comprobado en la base de datos).
    if (dto.reporterUserId) {
      const member = await this.prisma.propertyMembership.findFirst({
        where: {
          userId: dto.reporterUserId,
          status: 'linked',
          revokedAt: null,
          property: { estateId: target.estateId, deletedAt: null },
        },
        select: { id: true },
      });
      if (!member)
        throw new BadRequestException(
          'La persona indicada no es miembro de esta comunidad.',
        );
    }

    const year = new Date().getFullYear();
    const reportId = randomUUID();
    const issue = await this.prisma
      .$transaction(async (tx) => {
        // Contador atómico por año: el UPSERT bloquea la fila hasta el commit, así que dos altas simultáneas reciben números
        // distintos y una referencia borrada no se reutiliza (no se cuenta con COUNT(*) + 1).
        const [{ last_value: number }] = await tx.$queryRaw<
          { last_value: number }[]
        >`INSERT INTO "issue_reference_counters" ("year", "last_value") VALUES (${year}, 1)
          ON CONFLICT ("year") DO UPDATE SET "last_value" = "issue_reference_counters"."last_value" + 1
          RETURNING "last_value"`;
        const ref = `#INC-${year}-${String(number).padStart(3, '0')}`;

        return tx.issue.create({
          data: {
            ref,
            estateId: target.estateId,
            assetId: dto.assetId ?? null,
            location: dto.location?.trim() || null,
            type: dto.type,
            title: dto.title,
            description: dto.description,
            priority: dto.priority,
            status: 'Abierta',
            source: user.role === 'C' ? 'Propietario' : 'Comunidad',
            date: new Date(),
            reports: {
              create: {
                id: reportId,
                channel: dto.channel ?? 'form',
                sourceRef: dto.sourceRef ?? null,
                content: dto.description,
                reporterUserId:
                  user.role === 'C' ? user.id : (dto.reporterUserId ?? null),
                reporterName: dto.reporterName ?? null,
                reporterContact: dto.reporterContact ?? null,
                receivedAt: new Date(),
                createdByKind: 'person',
                createdByUserId: user.id,
              },
            },
            timeline: {
              create: issueEventData({
                kind: 'report_received',
                actorKind: 'person',
                authorUserId: user.id,
                role: this.authorRoleFor(user),
                text: dto.description,
                refType: 'issue_report',
                refId: reportId,
              }),
            },
          },
          include: {
            photos: true,
            timeline: TIMELINE_INCLUDE,
            ...(canSeeInventory(user) ? { asset: ASSET_SELECT } : {}),
          },
        });
      })
      .catch((error: unknown) => {
        // (canal, referencia) es único: el mismo aviso no se registra dos veces.
        const e = error as { code?: string; meta?: unknown };
        if (
          e.code === 'P2002' &&
          JSON.stringify(e.meta ?? {}).includes('source_ref')
        ) {
          throw new ConflictException('Este aviso ya está registrado.');
        }
        throw error;
      });
    // La vía decidida al crear abre directamente el siguiente paso humano.
    if (dto.resolutionRoute && this.workflow) {
      const workflow = this.workflow;
      const route = dto.resolutionRoute;
      try {
        const decided = await this.prisma.$transaction((tx) =>
          workflow.decideRoute(tx, {
            issueId: issue.id,
            route,
            reason: dto.routeReason,
            actor: { kind: 'person', userId: user.id },
          }),
        );
        for (const task of decided.tasks) await workflow.notifyTaskOpened(task);
      } catch {
        new Logger(IssuesService.name).warn('ROUTE_AT_CREATE_FAILED');
      }
    }
    // El reportante vuelve a ver SU incidencia con la misma proyección que cualquier vecino.
    if (user.role === 'C') return presentIssueForResident(issue, user.id, true);
    return hideAssetLink(
      { ...issue, timeline: withAuthorName(issue.timeline, user) },
      user,
    );
  }

  /** Cambiar el estado es cosa del lado gestor, no de quien reporta */
  /**
   * Vincula la incidencia a una instalación de su finca, o la desvincula
   * (`assetId` null/ausente). Deja constancia en el historial.
   */
  async setAsset(id: string, dto: SetIssueAssetDto, user: AuthenticatedUser) {
    const issue = await this.assertIssueAccess(id, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestión puede vincular una instalación a una incidencia.',
      );
    }
    const assetId = dto.assetId ?? null;
    let text = 'Se ha quitado la instalación vinculada.';
    if (assetId) {
      const asset = await this.assertAssetInEstate(assetId, issue.estateId);
      text = `Instalación vinculada: ${asset.name}.`;
    }
    if (assetId === issue.assetId) return this.findById(id, user);
    await this.prisma.issue.update({
      where: { id: issue.id },
      data: {
        assetId,
        timeline: {
          create: issueEventData({
            kind: 'asset_linked',
            actorKind: 'person',
            authorUserId: user.id,
            text,
          }),
        },
      },
    });
    return this.findById(id, user);
  }

  /** La instalación tiene que ser de la misma finca que la incidencia. */
  private async assertAssetInEstate(assetId: string, estateId: string | null) {
    // Una propiedad privada (sin finca) no tiene instalaciones.
    if (!estateId)
      throw new BadRequestException(
        'La instalación indicada no pertenece a la finca de esta incidencia.',
      );
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, estateId },
      select: { id: true, name: true },
    });
    if (!asset)
      throw new BadRequestException(
        'La instalación indicada no pertenece a la finca de esta incidencia.',
      );
    return asset;
  }

  /**
   * Avisa del cambio de estado a quienes siguen la incidencia: los que la reportaron y los que marcaron «me afecta también».
   * A los reportantes no se les avisa de «Resuelta» por aquí: lo comunica el workflow (`informResolved`), con su plantilla y una
   * sola vez; aquí lo duplicaría. Tampoco de «Cerrada» si venía de un estado terminal (de «Resuelta» ya se les dijo). Un cierre
   * directo, sin pasar por «Resuelta», no lo comunica nadie más: ese aviso sí se les da aquí, una vez.
   */
  private async notifyStatusChange(
    issue: { id: string; title: string; status: string },
    previousStatus: IssueStatus,
  ): Promise<void> {
    const affected = await this.prisma.issueAffectedUser.findMany({
      where: { issueId: issue.id },
      select: { userId: true },
    });
    const reportersInformedElsewhere =
      issue.status === 'Resuelta' ||
      (issue.status === 'Cerrada' && isTerminalIssueStatus(previousStatus));
    const reporters = reportersInformedElsewhere
      ? []
      : await this.reporterUserIds(issue.id);
    const userIds = [
      ...new Set([...reporters, ...affected.map((a) => a.userId)]),
    ];
    if (userIds.length === 0) return;
    await this.notifications.notify({
      userIds,
      category: 'issue',
      title: `«${issue.title}»: ${ISSUE_STATUS_LABELS[issue.status] ?? issue.status}`,
      body: null,
      link: issuePortalLink(issue.id),
    });
  }

  /**
   * La gestión elimina una incidencia. Es un borrado lógico (`deletedAt`): desde ese momento ninguna lectura la ve (listados,
   * detalle, panel del propietario, informes), y se retira lo que seguía vivo por ella: sus tareas, sus esperas, sus visitas
   * planificadas. Las fotos y el historial no se tocan (quedan por si hay que recuperarla).
   */
  async deleteIssue(
    issueId: string,
    user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión elimina incidencias.');
    const issue = await this.assertIssueAccess(issueId, user);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Se serializa con todo lo que actúa sobre la incidencia (envíos, resoluciones, barrido): lo que llegue después la ve borrada.
      await tx.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${issue.id}::uuid FOR UPDATE`;
      const current = await tx.issue.findUniqueOrThrow({
        where: { id: issue.id },
      });
      if (current.deletedAt) return;
      await tx.issue.update({
        where: { id: issue.id },
        data: { deletedAt: now },
      });
      // Las tareas NO se borran: el historial de la incidencia las referencia (decisión, resultado, responsable, comentarios,
      // adjuntos). Se cierran y se archivan: salen de la agenda y de los barridos, y se conservan para la auditoría.
      const tasks = await tx.agendaTask.updateMany({
        where: { issueId: issue.id, archivedAt: null },
        data: { archivedAt: now },
      });
      const open = await tx.agendaTask.updateMany({
        where: { issueId: issue.id, status: { in: OPEN_STATUSES } },
        data: { status: 'CANCELADA', cancelledAt: now },
      });
      // Una decisión sin resolver queda como «cancelada por el borrado»; las ya resueltas conservan su resultado.
      await tx.agendaTask.updateMany({
        where: { issueId: issue.id, kind: { not: null }, outcome: null },
        data: { outcome: 'issue_deleted' },
      });
      const waits = await tx.issueWait.updateMany({
        where: { issueId: issue.id, endedAt: null },
        data: { endedAt: now, endReason: 'cancelled' },
      });
      const visits = await tx.supplierVisit.updateMany({
        where: { issueId: issue.id, status: 'planificada' },
        data: { status: 'cancelada', cancelledAt: now },
      });
      await tx.issueTimelineEntry.create({
        data: {
          issueId: issue.id,
          ...issueEventData({
            kind: 'issue_deleted',
            actorKind: 'person',
            authorUserId: user.id,
            role: this.authorRoleFor(user),
            date: now,
            text: 'La incidencia se eliminó. Sus tareas, esperas y visitas pendientes se cerraron; el historial se conserva.',
            meta: {
              tasksArchived: tasks.count,
              tasksCancelled: open.count,
              waitsEnded: waits.count,
              visitsCancelled: visits.count,
            },
          }),
        },
      });
    });
    return { deleted: true };
  }

  async updateStatus(
    id: string,
    dto: UpdateIssueStatusDto,
    user: AuthenticatedUser,
  ) {
    const issue = await this.assertIssueAccess(id, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede cambiar el estado de una incidencia.',
      );
    }
    const informs: RequesterInformResult[] = [];
    const updated = await this.prisma.$transaction((tx) =>
      this.applyStatusInTx(tx, issue, dto.status, user, informs, true),
    );
    // Ya confirmada la resolución: el aviso al solicitante (si lo hay) se entrega ahora y, pase lo que pase, no la deshace.
    for (const inform of informs) await this.workflow?.afterCommit(inform);
    if (issue.status !== updated.status)
      await this.notifyStatusChange(updated, issue.status);
    return { ...updated, timeline: withAuthorName(updated.timeline, user) };
  }

  /**
   * El cambio de estado, dentro de la transacción de quien llama (también lo usa «registrar interacción»,
   * que lo combina con otros efectos de forma atómica). Deja el evento y, si se resuelve o cierra, el workflow.
   * `informs` recoge el aviso de resolución al solicitante para que quien llama lo entregue tras confirmar.
   */
  async applyStatusInTx(
    tx: Prisma.TransactionClient,
    issue: { id: string; estateId: string | null },
    status: UpdateIssueStatusDto['status'] | 'Retirada',
    user: AuthenticatedUser,
    informs: RequesterInformResult[] = [],
    /** Cambio a mano (PATCH de estado, «resolver» de una interacción): pasa por la matriz de transiciones. */
    manual = false,
  ) {
    const statusLabel = ISSUE_STATUS_LABELS[status] ?? status;
    // Serialize changes so two simultaneous writers never record a stale fromStatus.
    await tx.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${issue.id}::uuid FOR UPDATE`;
    const current = await tx.issue.findUniqueOrThrow({
      where: { id: issue.id },
    });
    if (manual) assertManualTransition(current.status, status);
    // Cerrada = «sin gestión administrativa pendiente»: no con un siniestro vivo (Resuelta sí). Retirar tampoco: el siniestro es un
    // expediente con la aseguradora que no se abandona porque quien avisó retire la incidencia. Se mira con la incidencia
    // bloqueada, y quien abre o cambia un siniestro la bloquea antes: no hay hueco entre esta lectura y el commit.
    if (
      (status === 'Cerrada' || status === 'Retirada') &&
      current.status !== status
    ) {
      const openClaim = await tx.insuranceClaim.findFirst({
        where: {
          issueId: issue.id,
          status: NON_TERMINAL_CLAIM_STATUS_FILTER,
        },
        select: { id: true },
      });
      // Tampoco con la comunicación de «resuelta» por decidir: cerrar no puede ser la forma de que el solicitante no se entere.
      const pendingNotice =
        status === 'Cerrada' && this.workflow
          ? await this.workflow.hasPendingResolvedNotice(tx, issue.id)
          : false;
      // Una sola respuesta, determinista: el código es el primero de este orden y `blockers` los lista todos.
      const blockers = [
        ...(openClaim ? [ISSUE_HAS_OPEN_INSURANCE_CLAIM] : []),
        ...(pendingNotice ? [ISSUE_HAS_PENDING_REQUESTER_NOTICE] : []),
      ];
      if (blockers.length > 0)
        throw new ConflictException({
          code: blockers[0],
          blockers,
          message:
            blockers.length === 2
              ? 'Antes de cerrar la incidencia, revisa la comunicación pendiente al solicitante y la gestión del siniestro de seguro que sigue abierto.'
              : pendingNotice
                ? 'Antes de cerrar la incidencia, revisa la comunicación pendiente al solicitante: envíala o descártala desde Tareas.'
                : status === 'Retirada'
                  ? 'No se puede retirar la incidencia mientras tenga un siniestro de seguro abierto: contacta con la administración.'
                  : 'No se puede cerrar la incidencia mientras tenga un siniestro de seguro abierto. Déjala como Resuelta y ciérrala cuando termine la gestión con la aseguradora.',
        });
    }
    const changedAt = new Date();
    const result = await tx.issue.update({
      where: { id: issue.id },
      data:
        current.status === status
          ? {}
          : {
              status,
              ...issueStatusDates(current.status, status, changedAt),
              // Salir de «Pendiente de información» (a mano) deja de esperar la respuesta: no queda estado al que volver.
              ...(current.status === 'PendienteInformacion'
                ? { statusBeforeInfoRequest: null }
                : {}),
              timeline: {
                create: issueEventData({
                  kind: 'status_changed',
                  actorKind: 'person',
                  authorUserId: user.id,
                  role: this.authorRoleFor(user),
                  date: changedAt,
                  fromStatus: current.status,
                  toStatus: status,
                  text: `Estado actualizado a "${statusLabel}".`,
                }),
              },
            },
      include: { photos: true, timeline: TIMELINE_INCLUDE },
    });
    const workflow = this.workflow;
    if (current.status !== status && issue.estateId && workflow) {
      // Resuelta o cerrada: ya no se espera a nadie ni hace falta ninguna decisión pendiente. (Cerrar con la comunicación de
      // «resuelta» por decidir se rechaza arriba: la liquidación nunca llega a retirarla en silencio.)
      if (
        status === 'Resuelta' ||
        status === 'Cerrada' ||
        status === 'Retirada'
      )
        await workflow.settleIssueLifecycle(tx, issue.id, status);
      // Reabrir una resuelta: «tu incidencia figura como resuelta» ya no es cierto.
      else if (!ACTIVE_ISSUE_STATUSES.includes(current.status))
        await workflow.supersedeResolvedNotice(tx, issue.id);
      // El solicitante se entera de la resolución: solo en una transición REAL a Resuelta (aquí `current.status !== status`);
      // si ya se le dijo desde la última vez que se abrió (p. ej. Resuelta → Cerrada → Resuelta), `informResolved` no repite.
      if (status === 'Resuelta')
        informs.push(await workflow.informResolved(tx, issue.id));
    }
    return result;
  }

  /**
   * La gestión pide información a quien avisó: la incidencia queda en `PendienteInformacion` (un estado, no una espera) y
   * recuerda el estado en el que estaba (`statusBeforeInfoRequest`), que la respuesta de quien avisó restaura. Pedir otra vez
   * estando a la espera cambia el texto, no el estado al que se vuelve. Los destinatarios son TODOS los reportantes con cuenta.
   */
  async requestInfo(
    id: string,
    dto: RequestIssueInfoDto,
    user: AuthenticatedUser,
  ) {
    const issue = await this.assertIssueAccess(id, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede pedir información sobre una incidencia.',
      );
    }
    const closed = () =>
      new BadRequestException(
        'No se puede pedir información sobre una incidencia ya cerrada.',
      );
    if (isTerminalIssueStatus(issue.status)) throw closed();
    const recipients = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.issue.findUniqueOrThrow({ where: { id } });
      // Se vuelve a mirar bajo el bloqueo: un cierre concurrente gana.
      if (isTerminalIssueStatus(current.status)) throw closed();
      const waiting = current.status === 'PendienteInformacion';
      const userIds = await this.reporterUserIds(id, tx);
      const at = new Date();
      await tx.issue.update({
        where: { id },
        data: {
          status: 'PendienteInformacion',
          statusBeforeInfoRequest: waiting
            ? current.statusBeforeInfoRequest
            : current.status,
        },
      });
      if (!waiting)
        await tx.issueTimelineEntry.create({
          data: {
            issueId: id,
            ...issueEventData({
              kind: 'status_changed',
              actorKind: 'person',
              authorUserId: user.id,
              date: at,
              fromStatus: current.status,
              toStatus: 'PendienteInformacion',
              text: `Estado actualizado a "${ISSUE_STATUS_LABELS.PendienteInformacion}".`,
            }),
          },
        });
      await tx.issueTimelineEntry.create({
        data: {
          issueId: id,
          ...issueEventData({
            kind: 'info_requested',
            actorKind: 'person',
            authorUserId: user.id,
            // Un instante después: el historial ordena por fecha y la petición va tras el cambio de estado.
            date: new Date(at.getTime() + 1),
            text: dto.text,
            meta: { recipientUserIds: userIds },
          }),
        },
      });
      return userIds;
    });
    if (recipients.length > 0)
      await this.notifications.notify({
        userIds: recipients,
        category: 'issue',
        title: `La administración necesita información: ${issue.title}`,
        body: dto.text,
        link: issuePortalLink(id),
      });
    return this.findById(id, user);
  }

  /** Presupuesto: también del lado gestor (mismo criterio que el estado). */
  async updateBudget(
    id: string,
    dto: UpdateIssueBudgetDto,
    user: AuthenticatedUser,
  ) {
    const issue = await this.assertIssueAccess(id, user);
    if (user.role === 'C') {
      throw new ForbiddenException(
        'Solo la gestora puede gestionar el presupuesto de una incidencia.',
      );
    }
    const updated = await this.prisma.issue.update({
      where: { id: issue.id },
      data: {
        budgetAmount: dto.budgetAmount,
        budgetDescription: dto.budgetDescription,
        budgetApproved: dto.budgetApproved,
        timeline: dto.budgetAmount
          ? {
              create: issueEventData({
                kind: 'budget_updated',
                actorKind: 'person',
                authorUserId: user.id,
                text: `Presupuesto actualizado: ${dto.budgetAmount} €.`,
              }),
            }
          : undefined,
      },
      include: { photos: true, timeline: TIMELINE_INCLUDE },
    });
    return { ...updated, timeline: withAuthorName(updated.timeline, user) };
  }

  /** Comentario en el hilo — accesible a cualquier rol con acceso a la incidencia (gestora o propietario reportante). */
  async addTimelineEntry(
    id: string,
    dto: AddIssueTimelineEntryDto,
    user: AuthenticatedUser,
  ) {
    const issue = await this.assertIssueAccess(id, user);
    // Un vecino que no la reportó la ve pero no escribe en ella (todavía no hay comentarios de la comunidad).
    if (user.role === 'C' && !(await this.isReporter(issue.id, user.id)))
      throw new ForbiddenException(
        'Solo quien reportó esta incidencia puede añadir notas.',
      );
    const create = (db: Pick<Prisma.TransactionClient, 'issueTimelineEntry'>) =>
      db.issueTimelineEntry.create({
        data: {
          issueId: id,
          ...issueEventData({
            kind: 'note',
            actorKind: 'person',
            authorUserId: user.id,
            role: this.authorRoleFor(user),
            text: dto.text,
            // Solo la gestión escribe notas internas: quien avisa nunca las ve.
            internal: user.role !== 'C' && dto.internal === true,
          }),
        },
        include: { authorUser: { select: { fullName: true } } },
      });
    const workflow = this.workflow;
    // Lo que escribe quien reporta (rol C) es una novedad para la gestión: no puede quedarse solo en el historial. La nota y
    // su señal (una tarea, o un aviso si ya hay otra decisión abierta o la incidencia está terminada) van bajo el bloqueo de
    // la incidencia: una resolución concurrente gana o pierde entera, y dos notas a la vez no abren dos tareas.
    if (user.role !== 'C' || !workflow || !issue.estateId)
      return withAuthorName([await create(this.prisma)], user)[0];
    const { entry, outcome } = await this.prisma.$transaction(async (tx) => {
      await workflow.lockIssue(tx, id);
      const entry = await create(tx);
      return { entry, outcome: await workflow.requesterNoteReceived(tx, id) };
    });
    await workflow.notifyRequesterNote(outcome);
    return withAuthorName([entry], user)[0];
  }

  // ── Proveedor asignado (Apéndice G, gap #12) ──────────────────────────

  async currentProvider(issueId: string, user: AuthenticatedUser) {
    await this.assertIssueAccess(issueId, user);
    return this.prisma.issueProviderAssignment.findFirst({
      where: { issueId, unassignedAt: null },
    });
  }

  async listProviderHistory(issueId: string, user: AuthenticatedUser) {
    await this.assertIssueAccess(issueId, user);
    return this.prisma.issueProviderAssignment.findMany({
      where: { issueId },
      orderBy: { assignedAt: 'desc' },
    });
  }

  /**
   * «Editar proveedor» / asignar el proveedor de la incidencia. Pasa por la MISMA operación de dominio que el efecto
   * `assign_provider` de «registrar interacción» (`IssueWorkflowService.assignProvider`): bajo el bloqueo de la incidencia,
   * valida que el proveedor del directorio sea de ESTA comunidad, cierra la asignación vigente y crea la nueva (el snapshot
   * se congela aquí y no se recalcula desde `suppliers`), deja el evento, resuelve la tarea «Asignar proveedor» y deja el
   * siguiente paso al día. Es una decisión de asignación: no contacta, no espera, no envía ni decide la vía.
   */
  async assignProvider(
    issueId: string,
    dto: AssignIssueProviderDto,
    user: AuthenticatedUser,
  ) {
    const issue = await this.assertIssueAccess(issueId, user);
    const estateId = issue.estateId;
    const workflow = this.workflow;
    if (!estateId || !workflow)
      throw new BadRequestException('La incidencia no pertenece a una finca.');
    const name = dto.providerNameSnapshot?.trim();
    if (!dto.supplierId && !name)
      throw new BadRequestException(
        'Indica el proveedor: del directorio o por su nombre.',
      );
    const actor = { kind: 'person' as const, userId: user.id };

    return this.prisma.$transaction(async (tx) => {
      await workflow.lockIssue(tx, issue.id);
      const supplier = dto.supplierId
        ? await workflow.activeSupplier(tx, estateId, dto.supplierId)
        : null;
      const { assignmentId } = await workflow.assignProvider(tx, {
        issueId: issue.id,
        supplierId: supplier?.id,
        name: supplier?.name ?? (name as string),
        category: supplier?.category ?? (dto.categorySnapshot?.trim() || null),
        phone: dto.phoneSnapshot?.trim() || supplier?.phone || null,
        estimatedResolutionDate: dto.estimatedResolutionDate
          ? new Date(dto.estimatedResolutionDate)
          : null,
        actor,
      });
      await workflow.settleEntryReview(tx, issue.id, actor);
      return tx.issueProviderAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
      });
    });
  }

  // ── Notificaciones a vecinos (Apéndice G, gap #11) ────────────────────

  async listNotifications(issueId: string, user: AuthenticatedUser) {
    await this.assertIssueAccess(issueId, user);
    return this.prisma.issueNotification.findMany({
      where: { issueId },
      orderBy: { sentAt: 'desc' },
    });
  }

  /**
   * El histórico (`IssueNotification`) es lo que el frontend consume para
   * el contador y "último envío" del widget — se mantiene tal cual. Lo que
   * antes faltaba es el envío real: ahora también dispara un aviso de
   * verdad (bandeja + email, según preferencia) a los propietarios e
   * inquilinos de la vivienda afectada.
   */
  async sendNotification(
    issueId: string,
    dto: SendIssueNotificationDto,
    user: AuthenticatedUser,
  ) {
    const issue = await this.assertIssueAccess(issueId, user);
    const [created] = await Promise.all([
      this.prisma.issueNotification.create({
        data: {
          issueId,
          sentAt: new Date(),
          recipientsCount: dto.recipientsCount,
          channel: dto.channel,
          sentByUserId: user.id,
          subject: dto.subject ?? null,
          body: dto.body ?? null,
        },
      }),
      this.notifyResidents(issue, dto),
    ]);
    return created;
  }

  private async notifyResidents(
    issue: { id: string; title: string },
    dto: SendIssueNotificationDto,
  ): Promise<void> {
    // Se avisa a quienes la reportaron (el resto de la comunidad la ve en el portal, sin avisos automáticos).
    const residentIds = await this.reporterUserIds(issue.id);
    await this.notifications.notify({
      userIds: residentIds,
      category: 'issue',
      title:
        dto.subject?.trim() || `Actualización de la incidencia: ${issue.title}`,
      body: dto.body ?? null,
      link: issuePortalLink(issue.id),
    });
  }

  /** Quienes avisaron de la incidencia con cuenta de Domora (sin repetir). */
  private async reporterUserIds(
    issueId: string,
    db: Pick<Prisma.TransactionClient, 'issueReport'> = this.prisma,
  ): Promise<string[]> {
    const reports = await db.issueReport.findMany({
      where: { issueId, reporterUserId: { not: null } },
      select: { reporterUserId: true },
    });
    return [...new Set(reports.map((r) => r.reporterUserId as string))];
  }
}
