import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActorKind,
  AgendaTask,
  AgendaTaskPriority,
  IssueStatus,
  Prisma,
  WaitEndReason,
  WaitParty,
} from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationsService,
  type NotifyInput,
} from '../notifications/notifications.service';
import { AgendaTaskKindRegistry } from '../agenda-tasks/agenda-task-kind-registry.service';
import { AgendaTaskSystemService } from '../agenda-tasks/agenda-task-system.service';
import {
  OPEN_STATUSES,
  taskNeedsAttention,
} from '../agenda-tasks/agenda-task.constants';
import type { TaskOutcome } from '../agenda-tasks/agenda-task-kind.types';
import { issuePortalLink } from '../issues/issue-estate';
import {
  ACTIVE_ISSUE_STATUSES,
  allowsPostResolutionWork,
} from '../issues/issue-status.constants';
import { IssueEventsService } from './issue-events.service';
import { DEFAULT_VISIT_GRACE_MS } from './issue-situation';
import { type IssueWaitKind } from './issue-wait-kinds';
import {
  renderRequesterMessage,
  type RenderedRequesterMessage,
  type RequesterTemplate,
  type RequesterTemplateParams,
} from './requester-messages';
import { ACTIVE_CLAIM_STATUSES, CLAIM_WAIT_REF_TYPE } from './insurance-claims';
import {
  ROUTE_LABELS,
  isResolutionRoute,
  type ResolutionRoute,
} from './resolution-routes';
import type { IssueTaskKind } from './task-kinds/issue-task-definitions';
import {
  BRANCH_REVIEW_REASONS,
  ENTRY_REVIEW_REASONS,
  PERSON_SETTLED_ROUTE_REASONS,
  ROUTE_OWNED_REVIEW_REASONS,
  REQUESTER_UPDATE_REASON,
  RESOLVED_NOTICE_TEMPLATE,
  branchesOfRoute,
  DIRECT_MANAGEMENT_REASON,
  isInformationalTask,
  isRequesterUpdateTask,
  normalizeName,
  taskCompatibleWithRoute,
  waitObsoleteOnChange,
  type ClaimProfessionals,
} from './route-compatibility';

type Db = Prisma.TransactionClient;

/** Quién provoca el cambio: queda en el evento del historial. */
export interface WorkflowActor {
  kind: ActorKind;
  userId?: string | null;
}
const SYSTEM: WorkflowActor = { kind: 'system' };

export { DIRECT_MANAGEMENT_REASON };

/** Código estable (409): resolver una decisión dejaría la incidencia abierta sin ningún siguiente paso. */
export const ISSUE_NO_NEXT_STEP = 'ISSUE_NO_NEXT_STEP';

export interface IssueScope {
  id: string;
  ref: string;
  title: string;
  /** Tipo de la incidencia que introdujo una persona (dato determinista). */
  type: string;
  priority: 'Normal' | 'Urgente';
  status: IssueStatus;
  /** Vía de gestión decidida por una persona (`null` = sin decidir). Es AUTORITATIVA: gobierna qué rama puede actuar. */
  resolutionRoute: ResolutionRoute | null;
  estateId: string;
  administratorId: string;
}

/** Aviso al solicitante ya registrado en el historial y pendiente de entregar (tras confirmar la transacción). */
export interface RequesterNotice {
  issueId: string;
  userIds: string[];
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
}

export type RequesterInformResult =
  | { status: 'sent'; notice: RequesterNotice }
  | { status: 'proposed'; task: OpenedTask }
  | { status: 'manual' }
  | { status: 'no_recipient' }
  | { status: 'inactive' }
  /** Solo el aviso de resolución: ya se le dijo que estaba resuelta desde la última vez que se (re)abrió. */
  | { status: 'already_informed' };

/** Qué señal operativa dejó una nota del solicitante (ver `requesterNoteReceived`). */
export type RequesterNoteOutcome = {
  issueId: string;
  estateId: string;
  ref: string;
  title: string;
  issueStatus: IssueStatus;
} & (
  | { status: 'task'; task: OpenedTask }
  | { status: 'covered' }
  | { status: 'inactive' }
);

export interface OpenedTask {
  taskId: string;
  title: string;
  created: boolean;
  issueId: string;
  estateId: string;
  kind: IssueTaskKind;
}

export interface OpenTaskInput {
  issueId: string;
  kind: IssueTaskKind;
  payload: unknown;
  /** Distingue dos tareas legítimas del mismo tipo (p. ej. el mensaje al que se refieren). */
  discriminator?: string;
  /** Las tareas automáticas del workflow siempre las abre el sistema. */
  createdBy?: 'system';
  /**
   * Solo para la propuesta del aviso de resolución (`informResolved`): esa tarea es POSTERIOR a resolver, así que se abre sobre
   * una incidencia ya `Resuelta`, que por lo demás no admite trabajo humano nuevo.
   */
  afterSettlement?: boolean;
  /** Cuándo toca: la tarea aparece en Tareas en ese momento (un seguimiento que una persona fijó). Sin él, el plazo por prioridad. */
  dueAt?: Date;
  /** Prioridad fijada por la persona; sin ella, la del tipo de tarea o de la incidencia. */
  priority?: AgendaTaskPriority;
  /** Responsable de su equipo (se valida con la regla de las tareas manuales). */
  assigneeUserId?: string;
  /** Nombre del hito del recorrido al que pertenece la tarea; se anota en el historial. */
  milestoneLabel?: string;
}

export interface StartWaitInput {
  issueId: string;
  party: WaitParty;
  supplierId?: string | null;
  partyLabel?: string | null;
  kind: IssueWaitKind;
  refType?: string;
  refId?: string;
  /** Cuándo mirar de nuevo si lo esperado no ha llegado; sin plazo, no hay temporizador. */
  dueAt?: Date | null;
  actor?: WorkflowActor;
  now?: Date;
}

export interface RegisterVisitInput {
  issueId: string;
  /** Proveedor del directorio. Sin él, la visita es de un profesional externo y se apoya en su asignación. */
  supplierId?: string;
  /** Asignación vigente de un profesional que no es proveedor de la comunidad (nombre y teléfono salen de su snapshot). */
  assignmentId?: string;
  /** Quien hace la visita si no es ninguno de los dos (el propietario, un tercero…): solo su nombre. */
  visitorLabel?: string;
  scheduledAt: Date;
  purpose: string;
  /** Mensaje del que sale la cita (si viene de un correo); una cita registrada a mano no tiene. */
  messageId?: string;
  actor: WorkflowActor;
  /** `false` si quien registra la visita ya avisa al solicitante por su cuenta (no se duplica el aviso). Por defecto, sí. */
  informRequester?: boolean;
}

/** A qué espera se refiere una tarea de reclamar. */
const waitIdOf = (task: { payload?: unknown }): string | undefined =>
  (task.payload as { waitId?: string } | null)?.waitId;

const WAIT_DUE_TOLERANCE_MS = 60_000;

/**
 * Orquesta lo que rodea al expediente de una incidencia sin ser ni tarea ni
 * trabajo de Domora:
 *  - abre y cierra las TAREAS HUMANAS (decisiones) en la agenda;
 *  - abre, cierra y re-arma las ESPERAS a terceros (`IssueWait`);
 *  - programa las visitas confirmadas (`SupplierVisit`);
 *  - atiende el vencimiento de una espera.
 * Todos los métodos de escritura aceptan la transacción del llamador, de modo
 * que el estado y su rastro en el historial nunca quedan a medias.
 */
@Injectable()
export class IssueWorkflowService {
  private readonly logger = new Logger(IssueWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AgendaTaskKindRegistry,
    private readonly tasks: AgendaTaskSystemService,
    private readonly events: IssueEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Ámbito ──────────────────────────────────────────────────────────────

  async scope(db: Db, issueId: string): Promise<IssueScope> {
    // La finca es `Issue.estateId`: la incidencia es de la comunidad, no de una vivienda.
    const issue = await db.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      select: {
        id: true,
        ref: true,
        title: true,
        type: true,
        priority: true,
        status: true,
        resolutionRoute: true,
        estateId: true,
        estate: { select: { administratorId: true } },
      },
    });
    if (!issue || !issue.estate) {
      throw new Error('ISSUE_WORKFLOW_SCOPE');
    }
    return {
      id: issue.id,
      ref: issue.ref,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      resolutionRoute: isResolutionRoute(issue.resolutionRoute)
        ? issue.resolutionRoute
        : null,
      estateId: issue.estateId,
      administratorId: issue.estate.administratorId,
    };
  }

  /**
   * Serializa los cambios de una incidencia (cambio de vía, vencimientos, envíos, interacciones): quien llega después
   * lee el estado ya decidido. Es el mismo bloqueo que usan «registrar interacción» y el cambio de estado.
   */
  async lockIssue(db: Db, issueId: string): Promise<void> {
    await db.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${issueId}::uuid FOR UPDATE`;
  }

  /**
   * La tarea humana de un job que falló del todo. Un fallo genérico es «falló un proceso automático»; pero si el job
   * interpretaba la respuesta de un proveedor sabemos QUÉ ocurrió: el proveedor respondió y no se pudo leer. Entonces la tarea
   * es «Revisar la respuesta del proveedor» (la misma que se abre sin IA; el mensaje original está en el historial y en la
   * propia tarea). La usan el worker al agotar los reintentos y el barrido que repara datos antiguos: nunca salen dos.
   */
  // ── Política de seguimiento ─────────────────────────────────────────────

  /** Contexto de política de una incidencia: el dato determinista y lo que dedujo el modelo (que solo restringe). */
  /**
   * Cuándo volver a mirar una espera: PARÁMETROS de la política de seguimiento (`firstChaseAfterHours` para
   * la primera vez, `intervalHours` para las siguientes), no constantes del workflow.
   */
  async followUpDueAt(
    db: Db,
    input: {
      issueId: string;
      from?: Date;
      party?: WaitParty;
      phase?: 'first' | 'interval';
    },
  ): Promise<Date> {
    const issue = await this.scope(db, input.issueId);
    const hours = issue.priority === 'Urgente' ? 24 : 48;
    return new Date((input.from ?? new Date()).getTime() + hours * 3_600_000);
  }

  // ── Informar al solicitante ─────────────────────────────────────────────

  /**
   * Quienes pueden recibir avisos de la incidencia: TODOS los que la reportaron con cuenta (también los que avisaron en un duplicado
   * fusionado con ella), sin repetir y por orden de aviso; el resto de la comunidad la ve en el portal, sin avisos automáticos.
   */
  private async requestersOf(db: Db, issue: { id: string }): Promise<string[]> {
    const reports = await db.issueReport.findMany({
      where: { issueId: issue.id, reporterUserId: { not: null } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      select: { reporterUserId: true },
    });
    return [
      ...new Set(
        reports.map((r) => r.reporterUserId).filter((u): u is string => !!u),
      ),
    ];
  }

  /**
   * Registra EXACTAMENTE lo que se le comunica (el texto queda en un evento visible para él) y devuelve el
   * aviso pendiente de entregar. `null` si no hay a quién avisar.
   */
  private async recordRequesterUpdate(
    db: Db,
    issue: IssueScope,
    template: RequesterTemplate,
    params: RequesterTemplateParams,
    actor: WorkflowActor,
    extra: Record<string, unknown> = {},
    /** Clave estable de la decisión que lo envía: la misma clave no registra (ni envía) dos veces el mismo aviso. */
    idempotencyKey?: string,
  ): Promise<RequesterNotice | null> {
    const recipients = await this.requestersOf(db, issue);
    if (recipients.length === 0) return null;
    const message = renderRequesterMessage(template, params);
    const previous = idempotencyKey
      ? await db.issueTimelineEntry.findFirst({
          where: {
            issueId: issue.id,
            kind: 'requester_informed',
            meta: { path: ['idempotencyKey'], equals: idempotencyKey },
          },
          select: { id: true },
        })
      : null;
    const event =
      previous ??
      (await this.events.record(db, {
        issueId: issue.id,
        kind: 'requester_informed',
        actorKind: actor.kind,
        authorUserId: actor.userId,
        text: message.body,
        meta: {
          template,
          params: { ...params },
          recipientUserId: recipients[0],
          recipientUserIds: recipients,
          channel: 'in_app',
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...extra,
        },
      }));
    return {
      issueId: issue.id,
      userIds: recipients,
      title: message.title,
      body: message.body,
      link: issuePortalLink(issue.id),
      dedupeKey: `requester:${issue.id}:${event.id}`,
    };
  }

  /**
   * DOMORA informa al solicitante por su cuenta: lo gobierna `decide('notify_requester')`. Automático (autonomía
   * ≥ 2) solo con mensajes de hechos con plantilla; en autonomía 1 se propone con una tarea; en 0 no se hace.
   */
  async informRequester(
    db: Db,
    input: {
      issueId: string;
      template: RequesterTemplate;
      params?: RequesterTemplateParams;
    },
  ): Promise<RequesterInformResult> {
    const issue = await this.scope(db, input.issueId);
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status))
      return { status: 'inactive' };
    const params = input.params ?? {};
    if ((await this.requestersOf(db, issue)).length === 0)
      return { status: 'no_recipient' };
    renderRequesterMessage(input.template, params);
    const task = await this.openTask(db, {
      issueId: issue.id,
      kind: 'inform_requester',
      payload: { template: input.template, ...params },
      discriminator: `${input.template}:${params.when ?? params.label ?? ''}`,
      createdBy: 'system',
    });
    return { status: 'proposed', task };
  }

  /** Una PERSONA decide informar al solicitante (directamente o aprobando la propuesta): no pasa por la política. */
  async sendRequesterUpdate(
    db: Db,
    input: {
      issueId: string;
      template: RequesterTemplate;
      params?: RequesterTemplateParams;
      actor: WorkflowActor;
      idempotencyKey?: string;
    },
  ): Promise<RequesterNotice> {
    const issue = await this.scope(db, input.issueId);
    const notice = await this.recordRequesterUpdate(
      db,
      issue,
      input.template,
      input.params ?? {},
      input.actor,
      {},
      input.idempotencyKey,
    );
    if (!notice) throw new Error('REQUESTER_NOT_REACHABLE');
    return notice;
  }

  /**
   * El texto EXACTO que recibiría quien reportó la incidencia. Usa el mismo renderizado y las mismas comprobaciones que el
   * envío real (`recordRequesterUpdate`), pero no envía nada ni crea ningún evento: es lo que la persona confirma antes de
   * enviar.
   */
  async previewRequesterUpdate(
    db: Db,
    input: {
      issueId: string;
      template: RequesterTemplate;
      params?: RequesterTemplateParams;
    },
  ): Promise<RenderedRequesterMessage> {
    const issue = await this.scope(db, input.issueId);
    if ((await this.requestersOf(db, issue)).length === 0)
      throw new Error('REQUESTER_NOT_REACHABLE');
    return renderRequesterMessage(input.template, input.params ?? {});
  }

  /**
   * Entrega el aviso (bandeja y correo según preferencia) DESPUÉS de confirmar la transacción. Nunca lanza: lo que se le dijo
   * ya consta en su historial (es lo que lee en la app) y lo que lo originó (resolver la incidencia, programar una visita) ya
   * está confirmado; que la notificación no salga no lo deshace. Si falla, la gestión lo ve en el historial interno.
   */
  async deliverRequesterNotice(notice: RequesterNotice): Promise<void> {
    try {
      await this.notifications.notify({
        userIds: notice.userIds,
        category: 'issue',
        title: notice.title,
        body: notice.body,
        link: notice.link,
        dedupeKey: notice.dedupeKey,
        // Un aviso por evento del expediente: un reintento tras una caída no lo repite.
        once: true,
      });
    } catch (error) {
      this.logger.warn(
        `Aviso al solicitante (${notice.issueId}): ${error instanceof Error ? error.message : 'error'}`,
      );
      await this.events
        .record(this.prisma, {
          issueId: notice.issueId,
          kind: 'requester_notice_failed',
          actorKind: 'system',
          text: `No se pudo entregar la notificación al solicitante («${notice.title}»). El mensaje consta en su historial de la incidencia.`,
          meta: { dedupeKey: notice.dedupeKey },
        })
        .catch(() => undefined);
    }
  }

  /** Lo que queda por hacer tras confirmar: entregar el aviso enviado o avisar de la tarea propuesta. */
  async afterCommit(result: RequesterInformResult | undefined): Promise<void> {
    if (!result) return;
    if (result.status === 'sent')
      await this.deliverRequesterNotice(result.notice);
    else if (result.status === 'proposed')
      await this.notifyTaskOpened(result.task).catch((error: unknown) =>
        this.logger.warn(
          `Aviso de la tarea propuesta: ${error instanceof Error ? error.message : 'error'}`,
        ),
      );
  }

  // ── Aviso de resolución ─────────────────────────────────────────────────

  /**
   * El solicitante tiene que enterarse de que su incidencia se ha resuelto, sin que la gestión tenga que acordarse. Se llama
   * en una transición REAL a Resuelta (bajo el bloqueo de la incidencia, ya cambiado el estado y liquidada): ni editar una
   * Resuelta, ni Resuelta → Cerrada, ni Cerrada → Cerrada la provocan, y si ya se le dijo no se repite. Siempre el MISMO texto de hechos, la
   * plantilla `issue_resolved`: nunca un texto del modelo. Lo gobierna `decide('notify_requester')`:
   *  - `auto` (autonomía ≥ 2, con IA contratada): se registra y se entrega solo;
   *  - `propose` y `manual` (también sin IA: Start): una tarea «Informar al solicitante» con la plantilla, que una persona envía
   *    o descarta. `manual` significa «Domora no envía; lo hace una persona», no «no se hace nada». Mientras siga abierta no se
   *    puede cerrar la incidencia (`hasPendingResolvedNotice`); enviarla o descartarla desbloquea.
   * Sin solicitante con cuenta no se crea nada. Si ya se le dijo que estaba resuelta desde la última vez que se abrió (a mano,
   * antes de resolver), tampoco. El resultado se entrega tras confirmar (`afterCommit`).
   */
  async informResolved(
    db: Db,
    issueId: string,
  ): Promise<RequesterInformResult> {
    const issue = await this.scope(db, issueId);
    if (issue.status !== 'Resuelta') return { status: 'inactive' };
    if ((await this.requestersOf(db, issue)).length === 0)
      return { status: 'no_recipient' };
    if (await this.resolutionAlreadyInformed(db, issue.id))
      return { status: 'already_informed' };
    const task = await this.openTask(db, {
      issueId: issue.id,
      kind: 'inform_requester',
      payload: { template: RESOLVED_NOTICE_TEMPLATE },
      discriminator: `${RESOLVED_NOTICE_TEMPLATE}:`,
      createdBy: 'system',
      afterSettlement: true,
    });
    return { status: 'proposed', task };
  }

  /**
   * ¿Ya se le comunicó la resolución desde la última vez que se (re)abrió la incidencia? Una resolución tras REABRIR es otra
   * resolución y se vuelve a avisar; una comunicación manual previa a resolver (o en la misma gestión) cuenta.
   */
  private async resolutionAlreadyInformed(
    db: Db,
    issueId: string,
  ): Promise<boolean> {
    const reopened = await db.issueTimelineEntry.findFirst({
      where: {
        issueId,
        kind: 'status_changed',
        toStatus: { in: ACTIVE_ISSUE_STATUSES },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      select: { date: true },
    });
    const informed = await db.issueTimelineEntry.findMany({
      where: {
        issueId,
        kind: 'requester_informed',
        ...(reopened ? { date: { gt: reopened.date } } : {}),
      },
      select: { meta: true },
      take: 100,
    });
    return informed.some(
      (e) =>
        (e.meta as { template?: string } | null)?.template ===
        RESOLVED_NOTICE_TEMPLATE,
    );
  }

  /**
   * ¿Queda por decidir la comunicación de «resuelta» (la tarea «Informar al solicitante» sigue abierta, también aparcada)?
   * Mientras sea así no se puede cerrar la incidencia: cerrar no puede ser la forma de que el solicitante no se entere. Enviarla
   * o descartarla (una decisión consciente de la gestión) la cierra y desbloquea.
   */
  async hasPendingResolvedNotice(db: Db, issueId: string): Promise<boolean> {
    const open = await this.findOpenTasks(db, issueId, {
      kinds: ['inform_requester'],
      discriminator: RESOLVED_NOTICE_TEMPLATE,
    });
    return open.length > 0;
  }

  /**
   * Reabrir una incidencia resuelta: el aviso «tu incidencia figura como resuelta» que aún esperaba a una persona ya no es
   * verdad. Se retira (si el problema se vuelve a resolver, se propondrá otro).
   */
  supersedeResolvedNotice(db: Db, issueId: string): Promise<number> {
    return this.supersedeTasks(db, issueId, {
      kinds: ['inform_requester'],
      discriminator: RESOLVED_NOTICE_TEMPLATE,
    });
  }

  // ── Vía de gestión ──────────────────────────────────────────────────────

  /**
   * Una PERSONA decide por qué vía se gestiona la incidencia (`null` = volver a «sin decidir»). Es el único sitio que
   * escribe `Issue.resolutionRoute`, y la vía es AUTORITATIVA: cada cambio deja un `route_decided`, invalida el trabajo
   * pendiente de la rama anterior (`reconcileRouteChange`) y activa la de la nueva.
   */
  async decideRoute(
    db: Db,
    input: {
      issueId: string;
      route: ResolutionRoute | null;
      reason?: string;
      actor: WorkflowActor;
    },
  ): Promise<{
    changed: boolean;
    from: ResolutionRoute | null;
    /** Tarea humana abierta por la nueva vía (avisar con `notifyTaskOpened` tras confirmar la transacción). */
    tasks: OpenedTask[];
  }> {
    if (input.route !== null && !isResolutionRoute(input.route))
      throw new Error('RESOLUTION_ROUTE_INVALID');
    // Se serializa con todo lo que actúa sobre la incidencia (envíos, vencimientos…): lo que llegue después ve la vía nueva.
    await this.lockIssue(db, input.issueId);
    const issue = await this.scope(db, input.issueId);
    const from = issue.resolutionRoute;
    if (from === input.route) return { changed: false, from, tasks: [] };
    await db.issue.update({
      where: { id: issue.id },
      data: { resolutionRoute: input.route },
    });
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'route_decided',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text: input.route
        ? `Vía de gestión: ${ROUTE_LABELS[input.route]}.`
        : 'Vía de gestión sin decidir.',
      meta: {
        from,
        to: input.route,
        ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
      },
    });
    await this.reconcileRouteChange(db, issue, from, input.route, input.actor);
    const tasks = await this.syncRouteTasks(db, issue, input.route);
    if (input.route === 'community_provider')
      await this.ensureProviderNextStep(db, issue);
    await this.replaceEntryReview(db, issue.id, input.actor);
    // El paso que la propia vía acaba de abrir no se da por atendido en la misma operación.
    await this.settleEntryReview(db, issue.id, input.actor, false);
    return { changed: true, from, tasks };
  }

  /**
   * Qué trabajo queda INVALIDADO al pasar de `from` a `to` (la tabla está en `route-compatibility`): lo que pertenece a
   * una rama que la vía nueva no activa se sustituye (nada se borra: el historial queda, y lo ya enviado también).
   *  - esperas: las de la rama anterior (y toda espera automática del proveedor) se cierran como `superseded`, con sus
   *    tareas de reclamar;
   *  - rama del proveedor (si `to` no es `community_provider`): tareas de aprobar/revisar/confirmar, mensajes sin enviar
   *    (`draft`, `ready`, `failed` → `discarded`) y sus jobs de envío o de contacto aún pendientes;
   *  - tareas de las otras ramas (abrir el siniestro, pedir al propietario, siniestro rechazado…).
   * Un profesional que envió la aseguradora por un siniestro no se toca si la vía nueva es la del seguro.
   */
  async reconcileRouteChange(
    db: Db,
    issue: IssueScope,
    from: ResolutionRoute | null,
    to: ResolutionRoute | null,
    actor: WorkflowActor,
  ): Promise<{ waits: number; tasks: number; messages: number; jobs: number }> {
    const done = { waits: 0, tasks: 0, messages: 0, jobs: 0 };
    const allowed = branchesOfRoute(to);

    const waits = await db.issueWait.findMany({
      where: { issueId: issue.id, endedAt: null },
    });
    const professionals = await this.claimProfessionals(db, issue.id);
    const obsolete = waits.filter((w) =>
      waitObsoleteOnChange(w, { from, to }, professionals),
    );
    for (const wait of obsolete)
      done.waits += await this.endWaits(
        db,
        { issueId: issue.id, waitId: wait.id },
        'superseded',
        actor,
      );
    if (obsolete.length > 0) {
      const ids = new Set(obsolete.map((w) => w.id));
      done.tasks += await this.supersedeTasks(db, issue.id, {
        kinds: ['chase_provider'],
        only: (task) => ids.has(waitIdOf(task) ?? ''),
      });
    }

    if (to !== 'direct_management')
      done.tasks += await this.supersedeTasks(db, issue.id, {
        kinds: ['review_issue'],
        discriminator: DIRECT_MANAGEMENT_REASON,
      });
    for (const branch of ['provider', 'insurer', 'owner'] as const) {
      if (allowed.includes(branch)) continue;
      for (const reason of BRANCH_REVIEW_REASONS[branch])
        done.tasks += await this.supersedeTasks(db, issue.id, {
          kinds: ['review_issue'],
          discriminator: reason,
        });
    }
    return done;
  }

  /** Los profesionales que envió la aseguradora por un siniestro vivo: pertenecen a la rama del seguro. */
  private async claimProfessionals(
    db: Db,
    issueId: string,
  ): Promise<ClaimProfessionals> {
    const rows = await db.issueProviderAssignment.findMany({
      where: { issueId, unassignedAt: null, claimId: { not: null } },
      select: { supplierId: true, providerNameSnapshot: true },
    });
    return {
      supplierIds: new Set(
        rows.map((r) => r.supplierId).filter((id): id is string => !!id),
      ),
      names: new Set(rows.map((r) => normalizeName(r.providerNameSnapshot))),
    };
  }

  /**
   * La vía de seguro o del propietario abre el siguiente paso de su rama: quien tiene la pelota se fija en cuanto se
   * decide (seguro de la comunidad → la administración abre el siniestro; seguro del propietario → le pide que lo
   * tramite). Si ya hay un siniestro vivo no hace falta pedirlo. Lo que dejó la vía anterior ya lo retiró
   * `reconcileRouteChange`.
   */
  private async syncRouteTasks(
    db: Db,
    issue: IssueScope,
    route: ResolutionRoute | null,
  ): Promise<OpenedTask[]> {
    const reason =
      route === 'community_insurance'
        ? 'open_insurance_claim'
        : route === 'owner_insurance'
          ? 'ask_owner_file_claim'
          : route === 'direct_management'
            ? DIRECT_MANAGEMENT_REASON
            : null;
    if (!reason || !ACTIVE_ISSUE_STATUSES.includes(issue.status)) return [];
    // «Administrador» no activa ninguna rama automática: sin una tarea propia, nadie tendría la pelota.
    const alive =
      reason === DIRECT_MANAGEMENT_REASON
        ? 0
        : await db.insuranceClaim.count({
            where: { issueId: issue.id, status: { in: ACTIVE_CLAIM_STATUSES } },
          });
    if (alive > 0) return [];
    const task = await this.openTask(db, {
      issueId: issue.id,
      kind: 'review_issue',
      payload: { reason },
      discriminator: reason,
      createdBy: 'system',
    });
    return task.created ? [task] : [];
  }

  /**
   * Elegir al proveedor de la comunidad activa su rama. Con IA, y si el análisis ya está hecho, se encola el contacto
   * (reutiliza la clasificación guardada: no se vuelve a analizar). Si el análisis aún no terminó, lo recogerá el propio
   * análisis al ver la vía. Sin IA (Start) no se encola nada: la persona sigue a mano.
   */
  /**
   * Una incidencia ACTIVA no puede quedarse sin siguiente paso por una operación nuestra: lo comprueba, con la incidencia
   * bloqueada, quien cierra una decisión que podía dejarla así (`review_issue`). `excludeTaskId` es la tarea que se está
   * resolviendo (aún abierta). Lanza 409 `ISSUE_NO_NEXT_STEP`; la transacción de quien llama se deshace entera.
   */
  async assertNextStep(
    db: Db,
    issueId: string,
    excludeTaskId: string,
  ): Promise<void> {
    const issue = await this.scope(db, issueId);
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status)) return;
    const others = await db.agendaTask.findMany({
      where: {
        issueId,
        status: { in: OPEN_STATUSES },
        kind: { not: null },
        id: { not: excludeTaskId },
        archivedAt: null,
      },
      select: { kind: true, payload: true },
    });
    if (await this.hasNextStep(db, issueId, others)) return;
    throw new ConflictException({
      code: ISSUE_NO_NEXT_STEP,
      message:
        'La incidencia seguiría abierta sin ningún siguiente paso. Elige la vía de gestión, deja una próxima actuación con fecha o resuélvela.',
    });
  }

  /**
   * ¿Tiene la incidencia un siguiente paso OPERATIVO real, además de `others` (las demás tareas VIVAS, `OPEN_STATUSES`:
   * `EN_ESPERA` incluida, ver `isTaskOperationallyActive`)? Solo cuenta lo que está activo Y es de la vía vigente:
   *  - una espera abierta (`endedAt` nulo: las cumplidas, canceladas, vencidas o `superseded` no cuentan) salvo la automática del
   *    proveedor con otra vía;
   *  - una tarea concreta de la vía (no avisar al solicitante ni leer su novedad, no las de una rama que la vía no activa ni
   *    el reclamo de una espera que ya no cuenta);
   *  - una visita `planificada` (ni `realizada` ni `cancelada`);
   *  - trabajo de Domora aún por hacer (`incident`, `send`, `reply` pendientes o en curso; un envío solo si su mensaje sigue
   *    `ready`/`sending`, y el contacto con el proveedor solo con su vía). Un job terminal (`done`, `failed`, `cancelled`) no cuenta.
   */
  async hasNextStep(
    db: Db,
    issueId: string,
    others: { kind: string | null; payload?: unknown }[],
  ): Promise<boolean> {
    const issue = await db.issue.findUnique({
      where: { id: issueId },
      select: { resolutionRoute: true },
    });
    const route = isResolutionRoute(issue?.resolutionRoute)
      ? issue.resolutionRoute
      : null;
    const [waits, visits] = await Promise.all([
      db.issueWait.findMany({
        where: { issueId, endedAt: null },
        select: { party: true, refType: true },
      }),
      db.supplierVisit.count({ where: { issueId, status: 'planificada' } }),
    ]);
    if (waits.length > 0) return true;
    // El reclamo de una espera depende de ella: si la espera ya no cuenta (cerrada o de otra vía), tampoco su tarea.
    if (
      others.some(
        (t) =>
          !isInformationalTask(t) &&
          !(t.kind === 'chase_provider' && waitIdOf(t)) &&
          taskCompatibleWithRoute(t, route),
      )
    )
      return true;
    return visits > 0;
  }

  /**
   * Con la vía del proveedor y nadie que lo contacte (Domora sin IA o sin poder hacerlo), una persona tiene que hacerlo: se abre
   * `contact_provider`. Si ya hay un siguiente paso (el contacto de Domora en cola, una espera, una visita, otra tarea), no hace falta.
   */
  private async ensureProviderNextStep(
    db: Db,
    issue: IssueScope,
  ): Promise<void> {
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status)) return;
    const open = await db.agendaTask.findMany({
      where: {
        issueId: issue.id,
        status: { in: OPEN_STATUSES },
        kind: { not: null },
        archivedAt: null,
      },
      select: { kind: true, payload: true },
    });
    const entry = (t: { kind: string | null; payload: unknown }) =>
      t.kind === 'review_issue' &&
      (ENTRY_REVIEW_REASONS as readonly string[]).includes(
        (t.payload as { reason?: string } | null)?.reason ?? '',
      );
    if (
      await this.hasNextStep(
        db,
        issue.id,
        open.filter((t) => !entry(t)),
      )
    )
      return;
    await this.openTask(db, {
      issueId: issue.id,
      kind: 'review_issue',
      payload: { reason: 'contact_provider' },
      discriminator: 'contact_provider',
      createdBy: 'system',
    });
  }

  /**
   * La vía ya está decidida (al crear la incidencia o después): si ella misma ha abierto su paso humano, «Revisar incidencia
   * nueva» sobra y se sustituye. Nunca se pregunta dos veces lo mismo.
   */
  private async replaceEntryReview(
    db: Db,
    issueId: string,
    actor: WorkflowActor,
  ): Promise<void> {
    if (actor.kind !== 'person' || !actor.userId) return;
    const open = await db.agendaTask.findMany({
      where: {
        issueId,
        status: { in: OPEN_STATUSES },
        kind: 'review_issue',
        archivedAt: null,
      },
      select: { payload: true },
    });
    const owned = open.some((t) =>
      (ROUTE_OWNED_REVIEW_REASONS as readonly string[]).includes(
        (t.payload as { reason?: string } | null)?.reason ?? '',
      ),
    );
    if (!owned) return;
    for (const discriminator of ENTRY_REVIEW_REASONS)
      await this.resolveTasks(db, issueId, 'review_issue', {
        outcome: 'done',
        resultRef: { decision: 'done' },
        userId: actor.userId,
        discriminator,
      });
  }

  /**
   * «Revisar incidencia nueva» pide UNA decisión: cómo gestionar la incidencia. Se sustituye cuando una persona ha
   * actuado (decidió la vía, registró una gestión…) Y la incidencia queda con un siguiente paso real (una espera, una
   * visita, trabajo de Domora u otra tarea concreta). Si cerrarla la dejara sin nada pendiente, se mantiene: así nunca
   * hay dos tareas por la misma decisión ni una incidencia sin pelota.
   */
  async settleEntryReview(
    db: Db,
    issueId: string,
    actor: WorkflowActor,
    includeRouteTasks = true,
  ): Promise<number> {
    if (actor.kind !== 'person' || !actor.userId) return 0;
    const issue = await this.scope(db, issueId);
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status)) return 0;
    const open = await db.agendaTask.findMany({
      where: {
        issueId,
        status: { in: OPEN_STATUSES },
        kind: { not: null },
        archivedAt: null,
      },
      select: { kind: true, payload: true },
    });
    const settleable: readonly string[] = [
      ...ENTRY_REVIEW_REASONS,
      ...(includeRouteTasks ? PERSON_SETTLED_ROUTE_REASONS : []),
    ];
    const isEntry = (t: { kind: string | null; payload: unknown }) =>
      t.kind === 'review_issue' &&
      settleable.includes(
        (t.payload as { reason?: string } | null)?.reason ?? '',
      );
    if (!open.some(isEntry)) return 0;
    if (
      !(await this.hasNextStep(
        db,
        issueId,
        open.filter((t) => !isEntry(t)),
      ))
    )
      return 0;
    let closed = 0;
    for (const discriminator of settleable)
      closed += await this.resolveTasks(db, issueId, 'review_issue', {
        outcome: 'done',
        resultRef: { decision: 'done' },
        userId: actor.userId,
        discriminator,
      });
    return closed;
  }

  /**
   * Un proveedor del directorio de ESTA comunidad y en alta. Es la regla de pertenencia de todo lo que se hace con un proveedor
   * (asignarlo, esperarlo, programar su visita): uno de otra finca, de baja o inexistente se rechaza (400).
   */
  async activeSupplier(db: Db, estateId: string, supplierId: string) {
    const supplier = await db.supplier.findFirst({
      where: { id: supplierId, estateId, status: 'Activo' },
      select: { id: true, name: true, category: true, phone: true },
    });
    if (!supplier)
      throw new BadRequestException(
        'El proveedor no existe, está de baja o no es de esta comunidad.',
      );
    return supplier;
  }

  /**
   * A quién se espera cuando se elige una entidad real: solo un proveedor o una aseguradora del directorio de ESTA comunidad
   * (`activeSupplier`). Regla única de «Registrar actividad» y de la revisión.
   */
  async waitSupplier(
    db: Db,
    estateId: string,
    party: WaitParty,
    supplierId: string,
  ) {
    if (!['provider', 'insurer'].includes(party))
      throw new BadRequestException(
        'Solo se espera a un proveedor o aseguradora del directorio por su identificador.',
      );
    return this.activeSupplier(db, estateId, supplierId);
  }

  /**
   * Quién hace una visita, con la regla única de «Registrar actividad» y de la revisión: un proveedor del directorio
   * (`supplierId`), el profesional asignado a la incidencia (`useAssigned`; puede no ser proveedor de la comunidad, entonces es
   * su asignación) o, si no, solo el nombre de quien visita (`visitorLabel`, el fallback). Devuelve exactamente uno.
   */
  async visitTarget(
    db: Db,
    input: {
      issueId: string;
      estateId: string;
      supplierId?: string;
      useAssigned?: boolean;
      visitorLabel?: string;
    },
  ): Promise<{
    supplierId?: string;
    assignmentId?: string;
    visitorLabel?: string;
  }> {
    if (input.supplierId)
      return {
        supplierId: (
          await this.activeSupplier(db, input.estateId, input.supplierId)
        ).id,
      };
    if (input.useAssigned) {
      const assigned = await db.issueProviderAssignment.findFirst({
        where: { issueId: input.issueId, unassignedAt: null },
      });
      if (!assigned)
        throw new BadRequestException(
          'No hay un profesional asignado: asígnalo o indica el proveedor de la visita.',
        );
      return assigned.supplierId
        ? {
            supplierId: (
              await this.activeSupplier(db, input.estateId, assigned.supplierId)
            ).id,
          }
        : { assignmentId: assigned.id };
    }
    const visitorLabel = input.visitorLabel?.trim();
    if (!visitorLabel) throw new BadRequestException('Indica quién visita.');
    return { visitorLabel };
  }

  /**
   * Asigna un profesional a la incidencia: cierra la asignación vigente y crea la nueva. Es la ÚNICA operación de asignación:
   * la usan el endpoint `POST /issues/:id/provider` («Editar proveedor») y el efecto `assign_provider` de «registrar
   * interacción». Con `claimId`, lo envía una aseguradora por ese siniestro. Sin proveedor del directorio queda solo el
   * snapshot (nombre y teléfono): no se da de alta ningún `Supplier`. Deja el evento `provider_assigned` (de quién a quién, si
   * cambia) y, cuando una persona asigna al proveedor de la comunidad (no uno de la aseguradora), la tarea «Asignar proveedor»
   * queda resuelta. Asignar es CONTEXTO: no contacta, no espera, no envía y no decide la vía. Quien llama bloquea la incidencia.
   */
  async assignProvider(
    db: Db,
    input: {
      issueId: string;
      supplierId?: string | null;
      name: string;
      category?: string | null;
      phone?: string | null;
      estimatedResolutionDate?: Date | null;
      claimId?: string | null;
      insurerName?: string | null;
      actor: WorkflowActor;
    },
  ): Promise<{ assignmentId: string }> {
    const issue = await this.scope(db, input.issueId);
    const assignedAt = new Date();
    const previous = await db.issueProviderAssignment.findFirst({
      where: { issueId: issue.id, unassignedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    await db.issueProviderAssignment.updateMany({
      where: { issueId: issue.id, unassignedAt: null },
      data: { unassignedAt: assignedAt },
    });
    const assignment = await db.issueProviderAssignment.create({
      data: {
        issueId: issue.id,
        supplierId: input.supplierId ?? null,
        providerNameSnapshot: input.name.slice(0, 200),
        categorySnapshot: input.category ?? null,
        phoneSnapshot: input.phone ?? null,
        estimatedResolutionDate: input.estimatedResolutionDate ?? null,
        assignedAt,
        assignedByUserId:
          input.actor.kind === 'person' ? (input.actor.userId ?? null) : null,
        assignedByKind: input.actor.kind,
        claimId: input.claimId ?? null,
      },
    });
    const changed =
      !!previous &&
      !(previous.supplierId && input.supplierId
        ? previous.supplierId === input.supplierId
        : normalizeName(previous.providerNameSnapshot) ===
          normalizeName(input.name));
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'provider_assigned',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text: input.claimId
        ? `Profesional asignado: ${input.name}, enviado por ${input.insurerName ?? 'la aseguradora'}.`
        : changed
          ? `Proveedor cambiado: de ${previous.providerNameSnapshot} a ${input.name}.`
          : `Profesional asignado: ${input.name}.`,
      refType: 'issue_provider',
      refId: assignment.id,
      meta: {
        assignmentId: assignment.id,
        supplierId: input.supplierId ?? null,
        claimId: input.claimId ?? null,
        ...(previous
          ? {
              previous: {
                assignmentId: previous.id,
                supplierId: previous.supplierId,
                name: previous.providerNameSnapshot,
              },
            }
          : {}),
      },
    });
    // Cambió el profesional: lo que Domora tenía pendiente PARA EL ANTERIOR ya no procede (nada se envía ni se abre al nuevo).
    // (El profesional que envía una aseguradora es de la rama del seguro, no «el proveedor» de la comunidad: ni lo sustituye ni
    // se sustituye por él a efectos de esta reconciliación.)
    if (!input.claimId && !previous?.claimId)
      await this.reconcileProviderChange(
        db,
        issue,
        changed && previous ? previous : null,
        input,
      );
    // «Asignar proveedor» pedía exactamente esto: la decisión está tomada. (El profesional que envía la aseguradora es de otra
    // rama —el siniestro— y no responde a esa tarea.)
    if (!input.claimId && input.actor.kind === 'person' && input.actor.userId)
      await this.resolveTasks(db, issue.id, 'review_issue', {
        outcome: 'done',
        resultRef: { decision: 'done' },
        userId: input.actor.userId,
        discriminator: 'missing_provider',
      });
    return { assignmentId: assignment.id };
  }

  /**
   * UNA SOLA RECONCILIACIÓN de «cambié de proveedor» (bajo el bloqueo de la incidencia, dentro de `assignProvider`). Lo que Domora
   * tenía preparado o esperando PARA EL PROFESIONAL ANTERIOR deja de proceder (`previous` es `null` si no había uno vigente o es el
   * mismo: entonces solo se retiran los mensajes sin enviar a OTRO proveedor, que de todos modos no podrían salir):
   *  - sus mensajes sin enviar (`draft`, `ready`, `failed`) → `discarded`, con su envío pendiente y la tarea de aprobarlos o revisarlos
   *    (la misma retirada que el cambio de vía y el contacto manual); es también lo que haría `send()` si los dejáramos (la asignación
   *    vigente ya no es de ese proveedor);
   *  - el contacto que la rama del proveedor aún no había hecho (su job pendiente);
   *  - sus esperas abiertas → `superseded`, con su tarea de reclamar y sus recordatorios sin enviar (`retireWaitFollowUp`).
   * NO se toca lo ya ocurrido (mensajes enviados, respuestas, visitas) y NO se hace nada hacia el nuevo: ni se le escribe, ni se abre
   * una espera, ni se decide la vía; eso es el flujo normal. Las esperas que no se pueden atribuir al anterior (solo nombre distinto)
   * se dejan: las decide una persona.
   */
  async reconcileProviderChange(
    db: Db,
    issue: IssueScope,
    previous: {
      supplierId: string | null;
      providerNameSnapshot: string;
    } | null,
    next: { supplierId?: string | null; name: string; actor: WorkflowActor },
  ): Promise<{ messages: number; tasks: number; waits: number; jobs: number }> {
    const done = { messages: 0, tasks: 0, waits: 0, jobs: 0 };
    if (!previous) return done;
    const waits = await db.issueWait.findMany({
      where: { issueId: issue.id, endedAt: null, party: 'provider' },
    });
    const wasPrevious = (w: {
      supplierId: string | null;
      partyLabel: string | null;
    }) =>
      previous.supplierId
        ? w.supplierId === previous.supplierId
        : !w.supplierId &&
          normalizeName(w.partyLabel) ===
            normalizeName(previous.providerNameSnapshot);
    for (const wait of waits.filter(wasPrevious)) {
      done.waits += await this.endWaits(
        db,
        { issueId: issue.id, waitId: wait.id },
        'superseded',
        next.actor,
      );
      const retired = await this.retireWaitFollowUp(db, issue.id, wait.id);
      done.tasks += retired.tasks;
      done.messages += retired.messages;
      done.jobs += retired.jobs;
    }
    return done;
  }

  /**
   * El modelo SUGIERE una vía: queda registrado (`route_suggested`), pero nunca modifica `Issue.resolutionRoute`. La
   * decisión es siempre de una persona (`decideRoute`). La política (`determine_resolution_route`, techo `propose`) dice si
   * Domora la sugiere (`manual`: no); una vía ya decidida no se sugiere. Devuelve si dejó una sugerencia nueva.
   */
  // ── Tareas humanas ──────────────────────────────────────────────────────

  /**
   * Abre una tarea de decisión para una persona. Idempotente: si ya hay una
   * abierta igual, la devuelve sin crear otra. Quien la llame debe avisar
   * (`notifyTaskOpened`) DESPUÉS de confirmar la transacción.
   */
  async openTask(db: Db, input: OpenTaskInput): Promise<OpenedTask> {
    const issue = await this.scope(db, input.issueId);
    // Una incidencia resuelta o cerrada no tiene trabajo humano pendiente: lo que llegue tarde (un fallo, una respuesta) queda
    // en el historial, pero no abre decisiones incompatibles con una incidencia terminada.
    // Excepción explícita: solo una incidencia Resuelta admite el trabajo posterior a resolver (avisar al solicitante). Cerrada y
    // Retirada no generan trabajo, lo pida quien lo pida.
    if (
      !ACTIVE_ISSUE_STATUSES.includes(issue.status) &&
      !(input.afterSettlement && allowsPostResolutionWork(issue.status))
    )
      return {
        taskId: '',
        title: '',
        created: false,
        issueId: issue.id,
        estateId: issue.estateId,
        kind: input.kind,
      };
    const definition = this.registry.get(input.kind);
    const payload = this.registry.validatePayload(input.kind, input.payload);
    const build = await definition.build({
      db,
      payload,
      issue: {
        id: issue.id,
        ref: issue.ref,
        title: issue.title,
        priority: issue.priority,
        estateId: issue.estateId,
      },
    });
    const createdBy = input.createdBy ?? 'system';
    const { task, created } = await this.tasks.open(db, {
      administratorId: issue.administratorId,
      estateId: issue.estateId,
      issueId: issue.id,
      kind: input.kind,
      payload,
      title: build.title,
      description: build.description,
      priority:
        input.priority ??
        build.priority ??
        (issue.priority === 'Urgente' ? 'URGENTE' : 'MEDIA'),
      assignedToUserId: input.assigneeUserId,
      createdByKind: createdBy,
      discriminator: input.discriminator,
      dueAt: input.dueAt,
    });
    if (created) {
      await this.events.record(db, {
        issueId: issue.id,
        kind: 'task_opened',
        actorKind: 'system',
        text: `Se abrió una tarea para el administrador: ${task.title}${input.milestoneLabel ? ` (hito: ${input.milestoneLabel})` : ''}`,
        refType: 'agenda_task',
        refId: task.id,
        meta: {
          taskKind: input.kind,
          ...(input.milestoneLabel ? { milestone: input.milestoneLabel } : {}),
        },
      });
    }
    return {
      taskId: task.id,
      title: task.title,
      created,
      issueId: issue.id,
      estateId: issue.estateId,
      kind: input.kind,
    };
  }

  /**
   * Cierra tareas que YA NO HACEN FALTA (la incidencia se resolvió, la
   * condición desapareció). No son decisiones tomadas: quedan canceladas con
   * `outcome = superseded`.
   */
  async supersedeTasks(
    db: Db,
    issueId: string,
    options: {
      kinds?: IssueTaskKind[];
      discriminator?: string;
      /** Solo las tareas abiertas que cumplan esto (p. ej. las de las esperas de una parte concreta). */
      only?: (task: AgendaTask) => boolean;
    } = {},
  ): Promise<number> {
    const found = await this.findOpenTasks(db, issueId, options);
    const open = options.only ? found.filter(options.only) : found;
    const closed = await this.tasks.close(db, open, {
      status: 'CANCELADA',
      outcome: 'superseded',
    });
    for (const task of open.filter((t) => closed.includes(t.id))) {
      await this.events.record(db, {
        issueId,
        kind: 'task_cancelled',
        actorKind: 'system',
        text: `Tarea cancelada, ya no hacía falta: ${task.title}`,
        refType: 'agenda_task',
        refId: task.id,
      });
    }
    return closed.length;
  }

  /**
   * Cierra los «reclamar a quien no responde» (`chase_provider`, nombre heredado del tipo de tarea) de UNAS esperas:
   * las de una parte (`party`), las de un siniestro (`claimId`) o UNA sola (`waitId`). Cada tarea apunta a SU espera
   * (`payload.waitId`), así que lo que llega de un proveedor no cancela el seguimiento de una aseguradora ni al revés.
   */
  async supersedeChaseTasks(
    db: Db,
    issueId: string,
    scope: { party?: WaitParty; claimId?: string; waitId?: string },
  ): Promise<number> {
    const tasks = await this.findOpenTasks(db, issueId, {
      kinds: ['chase_provider'],
    });
    const waitOf = waitIdOf;
    const ids = tasks.map(waitOf).filter((id): id is string => !!id);
    const waits = new Map(
      (
        await db.issueWait.findMany({
          where: { id: { in: ids } },
          select: { id: true, party: true, refType: true, refId: true },
        })
      ).map((w) => [w.id, w]),
    );
    return this.supersedeTasks(db, issueId, {
      kinds: ['chase_provider'],
      only: (task) => {
        if (scope.waitId) return waitOf(task) === scope.waitId;
        const wait = waits.get(waitOf(task) ?? '');
        // Una tarea sin su espera (dato antiguo) era de un proveedor.
        if (!wait) return scope.party === 'provider';
        if (scope.party && wait.party !== scope.party) return false;
        if (scope.claimId)
          return (
            wait.refType === CLAIM_WAIT_REF_TYPE && wait.refId === scope.claimId
          );
        return true;
      },
    });
  }

  /**
   * Una persona dio por terminada UNA espera (`end_wait`): su seguimiento ya no tiene objeto. Se retira la tarea de reclamarla y
   * los recordatorios de ESA espera que aún no salieron (con sus jobs de envío); nada se borra y las demás esperas no se tocan.
   * Es la misma retirada que hace la respuesta del proveedor o el cierre de un siniestro, acotada a una espera. Quien llama
   * bloquea la incidencia.
   */
  async retireWaitFollowUp(
    db: Db,
    issueId: string,
    waitId: string,
  ): Promise<{ tasks: number; messages: number; jobs: number }> {
    const tasks = await this.supersedeChaseTasks(db, issueId, { waitId });
    return { tasks, messages: 0, jobs: 0 };
  }

  /**
   * Cierra una tarea porque una persona ya tomó la decisión por otra vía
   * (p. ej. aprobó el borrador desde su pantalla, no desde la tarea).
   */
  async resolveTasks(
    db: Db,
    issueId: string,
    kind: IssueTaskKind,
    resolution: {
      outcome: Exclude<TaskOutcome, 'superseded'>;
      resultRef: unknown;
      userId: string;
      discriminator?: string;
    },
  ): Promise<number> {
    const open = await this.findOpenTasks(db, issueId, {
      kinds: [kind],
      discriminator: resolution.discriminator,
    });
    const closed = await this.tasks.close(db, open, {
      status: 'COMPLETADA',
      outcome: resolution.outcome,
      resultRef: resolution.resultRef,
    });
    for (const task of open.filter((t) => closed.includes(t.id))) {
      await this.recordTaskResolved(db, {
        issueId,
        taskId: task.id,
        title: task.title,
        outcome: resolution.outcome,
        userId: resolution.userId,
      });
    }
    return closed.length;
  }

  /** Rastro de una decisión humana: la persona queda como autora del evento. */
  async recordTaskResolved(
    db: Db,
    input: {
      issueId: string;
      taskId: string;
      title: string;
      outcome: string;
      userId: string;
    },
  ) {
    // Una decisión se resuelve UNA vez: si un reintento tras una caída llega aquí otra vez, el rastro ya está.
    const already = await db.issueTimelineEntry.findFirst({
      where: {
        issueId: input.issueId,
        kind: 'task_resolved',
        refType: 'agenda_task',
        refId: input.taskId,
      },
    });
    if (already) return already;
    return this.events.record(db, {
      issueId: input.issueId,
      kind: 'task_resolved',
      actorKind: 'person',
      authorUserId: input.userId,
      text: `Tarea resuelta: ${input.title} (${input.outcome})`,
      refType: 'agenda_task',
      refId: input.taskId,
      meta: { outcome: input.outcome },
    });
  }

  private findOpenTasks(
    db: Db,
    issueId: string,
    options: { kinds?: IssueTaskKind[]; discriminator?: string },
  ) {
    return db.agendaTask.findMany({
      where: {
        issueId,
        status: { in: OPEN_STATUSES },
        kind: options.kinds ? { in: options.kinds } : { not: null },
        ...(options.discriminator && options.kinds?.length === 1
          ? {
              sourceRef: {
                startsWith: `${issueId}:${options.kinds[0]}:${options.discriminator}`,
              },
            }
          : {}),
      },
    });
  }

  /** Avisa a los gestores de la comunidad de que hay una decisión esperándoles. */
  async notifyTaskOpened(opened: OpenedTask): Promise<void> {
    if (!opened.created) return;
    await this.notifyManagers(opened.estateId, {
      category: 'task',
      title: opened.title,
      link: { B: `/b/tasks?task=${opened.taskId}` },
      dedupeKey: `task:${opened.taskId}`,
    });
  }

  /** El equipo de gestión (rol B) de la gestora que administra la comunidad. */
  private async notifyManagers(
    estateId: string,
    notice: Omit<NotifyInput, 'userIds' | 'estateId'>,
  ): Promise<void> {
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { administratorId: true },
    });
    if (!estate) return;
    const managers = await this.prisma.user.findMany({
      where: {
        role: 'B',
        administratorId: estate.administratorId,
        deletedAt: null,
      },
      select: { id: true },
    });
    await this.notifications.notify({
      ...notice,
      userIds: managers.map((m) => m.id),
      estateId,
    });
  }

  // ── Novedades del solicitante ───────────────────────────────────────────

  /**
   * Una nota NUEVA del solicitante tiene que llegar a la gestión sin crear trabajo duplicado. La nota ya es historial
   * (cualquier rol la comenta); aquí se decide qué señal operativa deja, con la incidencia bloqueada por quien llama:
   *  - incidencia activa SIN otra decisión pidiendo atención ahora → UNA tarea «Revisar actualización del solicitante»
   *    (`review_issue` / `requester_update`). Si ya hay una abierta, es esa misma (no una por nota); si se resolvió, la
   *    siguiente nota abre otra (misma regla que cualquier tarea de decisión);
   *  - otra decisión humana ya pide atención → NO se abre una segunda tarea («una decisión pendiente = una tarea»): la nota es
   *    contexto de esa decisión y queda en el historial con un aviso informativo. Las tareas aparcadas (`EN_ESPERA`) o solo de
   *    avisar al solicitante no cuentan: no piden una decisión ahora;
   *  - incidencia resuelta o cerrada → NO se reabre ni se crea trabajo: la nota queda en el historial y la gestión recibe un
   *    aviso informativo.
   * Nunca toca esperas, visitas, jobs ni mensajes: una nota no es la respuesta de un tercero.
   */
  async requesterNoteReceived(
    db: Db,
    issueId: string,
  ): Promise<RequesterNoteOutcome> {
    const issue = await this.scope(db, issueId);
    const base = {
      issueId: issue.id,
      estateId: issue.estateId,
      ref: issue.ref,
      title: issue.title,
      issueStatus: issue.status,
    };
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status))
      return { ...base, status: 'inactive' };
    const open = await db.agendaTask.findMany({
      where: { issueId, status: { in: OPEN_STATUSES }, kind: { not: null } },
      select: { kind: true, payload: true, status: true },
    });
    const decisionPending = open.some(
      (t) => taskNeedsAttention(t.status) && !isInformationalTask(t),
    );
    if (decisionPending && !open.some(isRequesterUpdateTask))
      return { ...base, status: 'covered' };
    const task = await this.openTask(db, {
      issueId,
      kind: 'review_issue',
      payload: { reason: REQUESTER_UPDATE_REASON },
      discriminator: REQUESTER_UPDATE_REASON,
      createdBy: 'system',
    });
    return { ...base, status: 'task', task };
  }

  /**
   * Avisa a la gestión de la nota del solicitante, ya confirmada la transacción (nunca lanza: la nota ya consta). Con tarea,
   * es el aviso de la propia tarea (la misma clave: mientras no se lea no se duplica); sin ella, un aviso informativo que
   * enlaza a la incidencia y se colapsa mientras no se lea.
   */
  async notifyRequesterNote(outcome: RequesterNoteOutcome): Promise<void> {
    try {
      if (outcome.status === 'task')
        return await this.notifyTaskOpened({ ...outcome.task, created: true });
      await this.notifyManagers(outcome.estateId, {
        category: 'issue',
        title:
          outcome.status === 'covered'
            ? `El solicitante ha añadido una nota — ${outcome.ref}`
            : `El solicitante ha escrito en una incidencia ya ${outcome.issueStatus === 'Cerrada' ? 'cerrada' : 'resuelta'} — ${outcome.ref}`,
        body: outcome.title,
        link: `/b/incidencias/${outcome.issueId}`,
        dedupeKey: `requester-note:${outcome.issueId}`,
      });
    } catch (error) {
      this.logger.warn(
        `Aviso de la nota del solicitante (${outcome.issueId}): ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  // ── Esperas a terceros ──────────────────────────────────────────────────

  /**
   * El expediente queda esperando a un tercero. Idempotente por
   * (incidencia, tipo, referencia). Con `dueAt`, el barrido de incidencias
   * (`processDueWaits`) vuelve a mirarla cuando venza: el reloj es del workflow,
   * no un job de IA.
   */
  async startWait(
    db: Db,
    input: StartWaitInput,
  ): Promise<{ waitId: string; created: boolean }> {
    const issue = await this.scope(db, input.issueId);
    // Nadie «espera» nada en una incidencia terminada.
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status))
      return { waitId: '', created: false };
    const existing = await db.issueWait.findFirst({
      where: {
        issueId: issue.id,
        kind: input.kind,
        refId: input.refId ?? null,
        endedAt: null,
      },
    });
    if (existing) return { waitId: existing.id, created: false };

    const now = input.now ?? new Date();
    const actor = input.actor ?? SYSTEM;
    const wait = await db.issueWait.create({
      data: {
        issueId: issue.id,
        party: input.party,
        supplierId: input.supplierId ?? null,
        partyLabel: input.partyLabel ?? null,
        kind: input.kind,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        startedAt: now,
        dueAt: input.dueAt ?? null,
      },
    });
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'wait_started',
      actorKind: actor.kind,
      authorUserId: actor.userId,
      text: input.partyLabel
        ? `Esperando respuesta de ${input.partyLabel}.`
        : 'Esperando respuesta de un tercero.',
      refType: 'issue_wait',
      refId: wait.id,
      meta: { waitKind: input.kind, dueAt: wait.dueAt?.toISOString() ?? null },
    });
    return { waitId: wait.id, created: true };
  }

  /** Cambia el plazo de una espera abierta: el barrido volverá a mirarla cuando venza el nuevo. */
  async rearmWait(db: Db, waitId: string, dueAt: Date): Promise<boolean> {
    const wait = await db.issueWait.findUnique({ where: { id: waitId } });
    if (!wait || wait.endedAt) return false;
    await db.issueWait.update({
      where: { id: waitId },
      data: { dueAt, dueHandledAt: null },
    });
    return true;
  }

  /** Cierra las esperas abiertas que cumplan el filtro. Devuelve cuántas cerró. */
  async endWaits(
    db: Db,
    where: {
      issueId: string;
      kind?: IssueWaitKind;
      refId?: string;
      waitId?: string;
    },
    reason: WaitEndReason,
    actor: WorkflowActor = SYSTEM,
    now: Date = new Date(),
  ): Promise<number> {
    const open = await db.issueWait.findMany({
      where: {
        issueId: where.issueId,
        endedAt: null,
        ...(where.waitId ? { id: where.waitId } : {}),
        ...(where.kind ? { kind: where.kind } : {}),
        ...(where.refId ? { refId: where.refId } : {}),
      },
    });
    let ended = 0;
    for (const wait of open) {
      const changed = await db.issueWait.updateMany({
        where: { id: wait.id, endedAt: null },
        data: { endedAt: now, endReason: reason },
      });
      if (changed.count !== 1) continue;
      ended += 1;
      await this.events.record(db, {
        issueId: wait.issueId,
        kind: 'wait_ended',
        actorKind: actor.kind,
        authorUserId: actor.userId,
        text:
          reason === 'fulfilled'
            ? `Llegó lo esperado${wait.partyLabel ? ` de ${wait.partyLabel}` : ''}.`
            : reason === 'cancelled'
              ? 'Ya no se espera respuesta.'
              : 'Espera cerrada: ya no era necesaria.',
        refType: 'issue_wait',
        refId: wait.id,
        meta: { reason },
      });
    }
    return ended;
  }

  /**
   * LIQUIDACIÓN: qué significa operativamente que una incidencia está Resuelta o Cerrada. Es el ÚNICO sitio que lo hace (lo
   * llaman el cambio de estado y el efecto «resolver» de registrar una gestión, ambos bajo el bloqueo de la incidencia) y
   * deja la incidencia SIN trabajo vivo; nada se borra, todo queda con su estado y su rastro:
   *  - esperas abiertas → `superseded`; tareas de decisión abiertas → canceladas (`superseded`), con sus seguimientos;
   *  - mensajes que no han salido (`draft`, `ready`, `failed`) → `discarded`; lo ya enviado es historial;
   *  - jobs pendientes que producirían una acción (análisis, contacto, envío, interpretación) → `cancelled`;
   *  - visitas aún `planificada` → `cancelada` («la incidencia se resolvió/cerró»); una realizada o cancelada no cambia;
   *  - las asignaciones de profesional quedan como contexto; el siniestro de seguro NO se toca (es un expediente
   *    administrativo con la aseguradora, que no se cierra solo porque el problema en la comunidad esté resuelto).
   * Los jobs que ya están en curso y los envíos ya reclamados no se pueden retirar: sus propias puertas (estado de la
   * incidencia al reclamar/guardar) los dejan inocuos. Reabrir la incidencia NO revive nada de esto.
   * `keepTask`: tareas que NO se retiran porque la propia operación que liquida las está resolviendo (p. ej. la decisión de
   * fusionar un duplicado, que la cierra su resolución como decisión tomada, no como obsoleta).
   */
  async settleIssueLifecycle(
    db: Db,
    issueId: string,
    to: 'Resuelta' | 'Cerrada' | 'Retirada' = 'Resuelta',
    options: { keepTask?: (task: AgendaTask) => boolean } = {},
  ): Promise<{
    waits: number;
    tasks: number;
    messages: number;
    jobs: number;
    visits: number;
  }> {
    const done = { waits: 0, tasks: 0, messages: 0, jobs: 0, visits: 0 };
    const word =
      to === 'Cerrada' ? 'cerró' : to === 'Retirada' ? 'retiró' : 'resolvió';
    done.waits += await this.endWaits(db, { issueId }, 'superseded');
    const { keepTask } = options;
    done.tasks += await this.supersedeTasks(
      db,
      issueId,
      keepTask ? { only: (task) => !keepTask(task) } : {},
    );
    const visits = await db.supplierVisit.findMany({
      where: { issueId, status: 'planificada' },
      select: { id: true },
    });
    if (visits.length > 0) {
      const now = new Date();
      for (const visit of visits) {
        const changed = await db.supplierVisit.updateMany({
          where: { id: visit.id, status: 'planificada' },
          data: { status: 'cancelada', cancelledAt: now },
        });
        if (changed.count !== 1) continue;
        done.visits += 1;
        await this.events.record(db, {
          issueId,
          kind: 'visit_cancelled',
          actorKind: 'system',
          text: `Visita cancelada porque la incidencia se ${word}.`,
          refType: 'supplier_visit',
          refId: visit.id,
          meta: { reason: 'issue_settled', to },
        });
      }
    }
    return done;
  }

  /**
   * Procesa los vencimientos de las esperas (lo llama el barrido de incidencias) y abre una tarea de seguimiento.
   */
  async processDueWaits(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.issueWait.findMany({
      where: {
        endedAt: null,
        dueHandledAt: null,
        dueAt: { lte: now },
        issue: { deletedAt: null },
      },
      select: { id: true },
      orderBy: { dueAt: 'asc' },
      take: 200,
    });
    let handled = 0;
    for (const { id } of due) {
      try {
        if (await this.processWaitDue(id, now)) handled += 1;
      } catch (error) {
        this.logger.warn(
          `Vencimiento de la espera ${id}: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }
    return handled;
  }

  /** El vencimiento de UNA espera. Idempotente: si ya se procesó, se cerró o se re-armó, no hace nada. */
  async processWaitDue(
    waitId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    let handled = false;
    const opened = await this.prisma.$transaction(async (tx) => {
      const found = await tx.issueWait.findUnique({ where: { id: waitId } });
      if (!found) return null;
      // Se serializa por incidencia (como «registrar interacción») y se vuelve a leer: nada sobre un estado viejo.
      await tx.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${found.issueId}::uuid FOR UPDATE`;
      const wait = await tx.issueWait.findUnique({ where: { id: waitId } });
      if (
        !wait ||
        wait.endedAt ||
        wait.dueHandledAt ||
        !wait.dueAt ||
        wait.dueAt.getTime() > now.getTime() + WAIT_DUE_TOLERANCE_MS
      )
        return null;
      handled = true;
      // Este vencimiento ya está atendido; si se re-arma más abajo, `rearmWait` lo vuelve a dejar pendiente.
      await tx.issueWait.update({
        where: { id: wait.id },
        data: { dueHandledAt: now },
      });
      const issue = await this.scope(tx, wait.issueId);
      if (!ACTIVE_ISSUE_STATUSES.includes(issue.status)) {
        await this.endWaits(
          tx,
          { waitId: wait.id, issueId: wait.issueId },
          'superseded',
        );
        return null;
      }
      const chase = await this.openTask(tx, {
        issueId: issue.id,
        kind: 'chase_provider',
        payload: {
          waitId: wait.id,
          supplierId: wait.supplierId ?? undefined,
        },
        discriminator: `${wait.id}:${wait.dueAt?.getTime() ?? 0}`,
        createdBy: 'system',
      });
      if (chase.created) {
        await this.events.record(tx, {
          issueId: issue.id,
          kind: 'wait_overdue',
          actorKind: 'system',
          text: `Sin respuesta en el plazo previsto${wait.partyLabel ? ` de ${wait.partyLabel}` : ''}.`,
          refType: 'issue_wait',
          refId: wait.id,
          meta: { mode: 'manual' },
        });
      }
      return chase;
    });
    if (opened) await this.notifyTaskOpened(opened);
    return handled;
  }

  /**
   * Recordatorio automático al proveedor que no responde: es un mensaje más,
   * que sale por el mismo `send` (y por su misma puerta de política). Devuelve
   * `false` si no procede (ya se enviaron los permitidos o no hay mensaje al
   * que dar seguimiento): entonces decide una persona.
   */
  // ── Visitas ─────────────────────────────────────────────────────────────

  /**
   * Una incidencia Resuelta o Cerrada no admite visitas nuevas. La comprobación va BAJO el bloqueo de la incidencia (el mismo que usa
   * cerrarla): quien llega después lee el estado ya decidido, así que no hay hueco entre «comprobar que sigue activa» y crear la visita.
   * La usa todo camino que crea o vincula una visita a una incidencia, venga de donde venga.
   */
  async assertAcceptsNewVisit(db: Db, issueId: string): Promise<IssueScope> {
    await this.lockIssue(db, issueId);
    const issue = await this.scope(db, issueId);
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status))
      throw new ConflictException(
        'La incidencia ya está resuelta o cerrada: no admite nuevas visitas.',
      );
    return issue;
  }

  /**
   * Una visita confirmada es una `SupplierVisit` planificada: sigue siendo su
   * propia fuente de verdad (no genera espera). Idempotente por
   * (incidencia, proveedor, instante).
   */
  async registerVisit(
    db: Db,
    input: RegisterVisitInput,
  ): Promise<{
    visitId: string;
    created: boolean;
    /** Si se informó (o se propuso informar) al solicitante: entregar con `afterCommit` tras confirmar. */
    requester?: RequesterInformResult;
  }> {
    const issue = await this.assertAcceptsNewVisit(db, input.issueId);
    // Exactamente uno: el proveedor del directorio, la asignación del profesional externo o, si no, el nombre de quien visita.
    const visitorLabel = input.visitorLabel?.trim() || undefined;
    if (
      [input.supplierId, input.assignmentId, visitorLabel].filter(Boolean)
        .length !== 1
    )
      throw new Error('VISIT_PARTY_REQUIRED');
    const party = input.supplierId
      ? { supplierId: input.supplierId }
      : input.assignmentId
        ? { assignmentId: input.assignmentId }
        : { visitorLabel: visitorLabel as string };
    const existing = await db.supplierVisit.findFirst({
      where: {
        issueId: issue.id,
        ...party,
        scheduledAt: input.scheduledAt,
        status: 'planificada',
      },
    });
    if (existing) return { visitId: existing.id, created: false };
    // Una cita que ya pasó no es una visita planificada: nada que esperar (lo propone a mano una persona o lo interpreta el modelo).
    if (input.scheduledAt.getTime() <= Date.now())
      throw new BadRequestException(
        'La visita tiene que ser futura: la fecha propuesta ya ha pasado.',
      );
    const visit = await db.supplierVisit.create({
      data: {
        ...party,
        estateId: issue.estateId,
        scheduledAt: input.scheduledAt,
        purpose: input.purpose.slice(0, 200),
        status: 'planificada',
        issueId: issue.id,
      },
    });
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'visit_scheduled',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text: input.supplierId
        ? 'Visita del proveedor programada.'
        : visitorLabel
          ? `Visita de ${visitorLabel} programada.`
          : 'Visita del profesional programada.',
      refType: 'supplier_visit',
      refId: visit.id,
      meta: input.messageId ? { messageId: input.messageId } : undefined,
    });
    // Informar al solicitante es una decisión de política (nunca crea una tarea solo para avisar si Domora puede hacerlo).
    const requester =
      input.informRequester === false
        ? undefined
        : await this.informRequester(db, {
            issueId: issue.id,
            template: 'visit_scheduled',
            params: { when: input.scheduledAt.toISOString() },
          });
    return { visitId: visit.id, created: true, requester };
  }

  /**
   * El resultado de una visita planificada: se realizó o no llegó a hacerse (cancelada). Es la ÚNICA operación que cierra una
   * visita de una incidencia, la use quien la use (la tarea «confirmar el resultado», la pantalla de la incidencia, el
   * panel del proveedor). Va por la visita y la incidencia, nunca por `supplierId`: sirve igual para un proveedor del
   * directorio, un profesional asignado, uno enviado por la aseguradora o uno solo con nombre.
   *
   * Una visita realizada NO resuelve la incidencia. Si tras registrarla no queda ningún siguiente paso, se abre UNA tarea
   * para que una persona decida cómo sigue (solucionada, otra actuación, esperar a alguien); nada se resuelve solo.
   */
  async recordVisitOutcome(
    db: Db,
    input: {
      issueId: string;
      visitId: string;
      outcome: 'completed' | 'cancelled';
      notes?: string;
      actor: WorkflowActor;
      /** `true` si quien llama ya cierra la tarea de confirmar el resultado (la propia resolución de esa tarea). */
      skipTaskSync?: boolean;
    },
  ): Promise<{
    visitId: string;
    status: 'realizada' | 'cancelada';
    /** Decisión humana abierta tras la visita (avisar con `notifyTaskOpened` tras confirmar). */
    followUp: OpenedTask | null;
  }> {
    // Se serializa con el cierre de la incidencia, los envíos y el resto de lo que actúa sobre ella.
    await this.lockIssue(db, input.issueId);
    const visit = await db.supplierVisit.findFirst({
      where: { id: input.visitId, issueId: input.issueId },
      include: {
        supplier: { select: { name: true } },
        assignment: { select: { providerNameSnapshot: true } },
      },
    });
    if (!visit)
      throw new NotFoundException('Visita no encontrada en esta incidencia.');
    if (visit.status !== 'planificada')
      throw new ConflictException(
        'La visita ya no está planificada: su resultado ya consta.',
      );
    const status = input.outcome === 'completed' ? 'realizada' : 'cancelada';
    const now = new Date();
    const notes = [visit.notes, input.notes]
      .filter((n): n is string => !!n?.trim())
      .join('\n');
    const changed = await db.supplierVisit.updateMany({
      where: { id: visit.id, status: 'planificada' },
      data: {
        status,
        notes: notes || null,
        ...(status === 'realizada'
          ? { completedAt: now }
          : { cancelledAt: now }),
      },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        'La visita ya no está planificada: su resultado ya consta.',
      );
    const who =
      visit.supplier?.name ??
      visit.assignment?.providerNameSnapshot ??
      visit.visitorLabel ??
      'el profesional';
    await this.events.record(db, {
      issueId: input.issueId,
      kind: status === 'realizada' ? 'visit_completed' : 'visit_cancelled',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text:
        status === 'realizada'
          ? `La visita de ${who} se realizó.`
          : `La visita de ${who} no se realizó o se canceló.`,
      refType: 'supplier_visit',
      refId: visit.id,
      meta: input.notes ? { notes: input.notes.slice(0, 500) } : undefined,
    });
    // «Tu visita es el martes» ya no es verdad (se hizo o se canceló): el aviso que esperaba a una persona se retira.
    await this.retireVisitNotice(db, input.issueId, visit.scheduledAt);
    // La tarea de confirmar el resultado ya no hace falta (la ha resuelto esta decisión).
    if (!input.skipTaskSync) {
      if (input.actor.kind === 'person' && input.actor.userId)
        await this.resolveTasks(db, input.issueId, 'confirm_visit_outcome', {
          outcome: 'done',
          resultRef: { decision: input.outcome, visitId: visit.id },
          userId: input.actor.userId,
          discriminator: visit.id,
        });
      else
        await this.supersedeTasks(db, input.issueId, {
          kinds: ['confirm_visit_outcome'],
          discriminator: visit.id,
        });
    }
    // Recalcular el siguiente paso: si no queda ninguno, una persona decide cómo sigue (no se resuelve nada solo).
    let followUp: OpenedTask | null = null;
    const issue = await this.scope(db, input.issueId);
    if (ACTIVE_ISSUE_STATUSES.includes(issue.status)) {
      const open = (
        await db.agendaTask.findMany({
          where: {
            issueId: input.issueId,
            status: { in: OPEN_STATUSES },
            kind: { not: null },
          },
          select: { kind: true, sourceRef: true, payload: true },
        })
      ).filter(
        // La tarea de confirmar ESTA visita (si la resuelve quien nos llama, sigue abierta aquí) no es un siguiente paso.
        (t) =>
          !(
            t.kind === 'confirm_visit_outcome' &&
            t.sourceRef?.startsWith(
              `${input.issueId}:confirm_visit_outcome:${visit.id}`,
            )
          ),
      );
      if (!(await this.hasNextStep(db, input.issueId, open))) {
        const task = await this.openTask(db, {
          issueId: input.issueId,
          kind: 'review_issue',
          payload: { reason: 'after_visit' },
          discriminator: `after_visit:${visit.id}`,
          createdBy: 'system',
        });
        if (task.created) followUp = task;
      }
    }
    return { visitId: visit.id, status, followUp };
  }

  /** El aviso «Hay una visita programada» de UNA visita se identifica por su fecha: así la tarea que lo propone se encuentra y se retira. */
  private visitNoticeDiscriminator(when: Date): string {
    return `visit_scheduled:${when.toISOString()}`;
  }

  /** Retira el aviso al solicitante (tarea) que esperaba a una persona y hablaba de esta visita en esta hora. */
  private retireVisitNotice(
    db: Db,
    issueId: string,
    when: Date,
  ): Promise<number> {
    return this.supersedeTasks(db, issueId, {
      kinds: ['inform_requester'],
      discriminator: this.visitNoticeDiscriminator(when),
    });
  }

  /** ¿Se le dijo ya al solicitante que la visita era a esa hora? (un aviso con plantilla que consta en su historial). */
  private async requesterToldVisitAt(
    db: Db,
    issueId: string,
    when: Date,
  ): Promise<boolean> {
    const informed = await db.issueTimelineEntry.findMany({
      where: { issueId, kind: 'requester_informed' },
      select: { meta: true },
      take: 200,
    });
    return informed.some((e) => {
      const meta = e.meta as {
        template?: string;
        params?: { when?: string };
      } | null;
      return (
        meta?.template === 'visit_scheduled' &&
        meta.params?.when === when.toISOString()
      );
    });
  }

  /**
   * Cambia la hora de una visita PLANIFICADA (profesional del directorio, asignado, enviado por la aseguradora o solo con nombre:
   * va por la visita y la incidencia, nunca por `supplierId`). Bajo el bloqueo de la incidencia, como cerrar o registrar su
   * resultado. Deja el evento `visit_rescheduled` y reconcilia el aviso al solicitante SIN mensajes libres:
   *  - el aviso pendiente de la hora anterior (la tarea) se retira;
   *  - si ya se le había dicho la hora anterior (o había un aviso pendiente), se le da la nueva con la plantilla `visit_scheduled`:
   *    sola si la política lo permite (autonomía ≥ 2) y, si no, como UNA tarea con el texto a la vista. Nunca dos avisos de la misma hora.
   * Una visita que nadie había comunicado no inventa un aviso.
   */
  async rescheduleVisit(
    db: Db,
    input: {
      issueId: string;
      visitId: string;
      scheduledAt: Date;
      actor: WorkflowActor;
    },
  ): Promise<{
    visitId: string;
    scheduledAt: Date;
    changed: boolean;
    /** Si se informó (o se propuso informar) al solicitante: entregar con `afterCommit` tras confirmar. */
    requester?: RequesterInformResult;
  }> {
    await this.lockIssue(db, input.issueId);
    const issue = await this.scope(db, input.issueId);
    if (!ACTIVE_ISSUE_STATUSES.includes(issue.status))
      throw new ConflictException(
        'La incidencia ya está resuelta o cerrada: no admite cambios en sus visitas.',
      );
    const visit = await db.supplierVisit.findFirst({
      where: { id: input.visitId, issueId: input.issueId },
      include: {
        supplier: { select: { name: true } },
        assignment: { select: { providerNameSnapshot: true } },
      },
    });
    if (!visit)
      throw new NotFoundException('Visita no encontrada en esta incidencia.');
    if (visit.status !== 'planificada')
      throw new ConflictException(
        'La visita ya no está planificada: su resultado ya consta.',
      );
    if (input.scheduledAt.getTime() <= Date.now())
      throw new BadRequestException(
        'La visita tiene que ser futura: la fecha propuesta ya ha pasado.',
      );
    if (input.scheduledAt.getTime() === visit.scheduledAt.getTime())
      return {
        visitId: visit.id,
        scheduledAt: visit.scheduledAt,
        changed: false,
      };
    const clash = await db.supplierVisit.findFirst({
      where: {
        issueId: issue.id,
        id: { not: visit.id },
        status: 'planificada',
        scheduledAt: input.scheduledAt,
        supplierId: visit.supplierId,
        assignmentId: visit.assignmentId,
        visitorLabel: visit.visitorLabel,
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(
        'Ya hay otra visita de ese profesional a esa hora.',
      );
    const from = visit.scheduledAt;
    const moved = await db.supplierVisit.updateMany({
      where: { id: visit.id, status: 'planificada' },
      data: { scheduledAt: input.scheduledAt },
    });
    if (moved.count !== 1)
      throw new ConflictException(
        'La visita ya no está planificada: su resultado ya consta.',
      );
    const who =
      visit.supplier?.name ??
      visit.assignment?.providerNameSnapshot ??
      visit.visitorLabel ??
      'el profesional';
    const when = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Europe/Madrid',
    });
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'visit_rescheduled',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text: `La visita de ${who} se reprogramó: ${when.format(input.scheduledAt)}.`,
      refType: 'supplier_visit',
      refId: visit.id,
      meta: {
        from: from.toISOString(),
        to: input.scheduledAt.toISOString(),
      },
    });
    // La tarea del aviso de la hora de antes (aún por decidir) ya no es verdad y, si ya se le dijo la de antes, hay que corregirlo.
    const retired = await this.retireVisitNotice(db, issue.id, from);
    let requester: RequesterInformResult | undefined;
    if (retired > 0 || (await this.requesterToldVisitAt(db, issue.id, from)))
      requester = await this.informVisitChange(db, issue, input.scheduledAt);
    return {
      visitId: visit.id,
      scheduledAt: input.scheduledAt,
      changed: true,
      requester,
    };
  }

  /** El aviso de la visita con su NUEVA hora: automático solo si la política lo permite; si no, una tarea con el texto a la vista. */
  private async informVisitChange(
    db: Db,
    issue: IssueScope,
    when: Date,
  ): Promise<RequesterInformResult> {
    if ((await this.requestersOf(db, issue)).length === 0)
      return { status: 'no_recipient' };
    const params = { when: when.toISOString() };
    // `propose` y `manual`: Domora no envía; lo hace una persona (el aviso anterior quedó desfasado y alguien tiene que corregirlo).
    const task = await this.openTask(db, {
      issueId: issue.id,
      kind: 'inform_requester',
      payload: { template: 'visit_scheduled', ...params },
      discriminator: this.visitNoticeDiscriminator(when),
      createdBy: 'system',
    });
    return { status: 'proposed', task };
  }

  /**
   * Visitas planificadas cuya hora (más el margen de lo que dura) ya pasó sin que conste su resultado: una persona tiene que
   * confirmar qué ocurrió. Abre UNA tarea por visita (idempotente: el barrido no la repite) y, mientras exista, la pelota la
   * tiene la administración. Devuelve cuántas tareas nuevas abrió.
   */
  async processOverdueVisits(
    now: Date = new Date(),
    graceMs: number = DEFAULT_VISIT_GRACE_MS,
  ): Promise<number> {
    const overdue = await this.prisma.supplierVisit.findMany({
      where: {
        status: 'planificada',
        issueId: { not: null },
        scheduledAt: { lte: new Date(now.getTime() - graceMs) },
        issue: { deletedAt: null, status: { in: ACTIVE_ISSUE_STATUSES } },
      },
      select: { id: true, issueId: true },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    });
    const opened: OpenedTask[] = [];
    for (const { id, issueId } of overdue) {
      if (!issueId) continue;
      try {
        const task = await this.prisma.$transaction(async (tx) => {
          await this.lockIssue(tx, issueId);
          // Con la incidencia bloqueada se vuelve a mirar: puede haberse registrado el resultado o cerrado la incidencia.
          const visit = await tx.supplierVisit.findFirst({
            where: { id, issueId, status: 'planificada' },
            select: { id: true },
          });
          const issue = await this.scope(tx, issueId);
          if (!visit || !ACTIVE_ISSUE_STATUSES.includes(issue.status))
            return null;
          return this.openTask(tx, {
            issueId,
            kind: 'confirm_visit_outcome',
            payload: { visitId: id },
            discriminator: id,
            createdBy: 'system',
          });
        });
        if (task?.created) opened.push(task);
      } catch (error) {
        this.logger.warn(
          `Visita vencida ${id}: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }
    for (const task of opened) await this.notifyTaskOpened(task);
    return opened.length;
  }

  // ── Conciliación ────────────────────────────────────────────────────────

  /**
   * Repara incoherencias de datos anteriores al workflow: incidencias que
   * esperan a una persona (borrador por aprobar, sin proveedor, envío dudoso,
   * proceso fallido) y no tienen su tarea. Solo DETECTA y abre lo que falta:
   * no inventa trabajo. Se ejecuta desde el barrido periódico del worker.
   */
  async reconcile(_now: Date = new Date()): Promise<number> {
    return 0;
  }
}
