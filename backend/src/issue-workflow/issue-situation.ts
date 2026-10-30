import type {
  AgendaTaskPriority,
  AgendaTaskStatus,
  IssueStatus,
  WaitParty,
} from '../prisma/client';
import {
  OPEN_STATUSES,
  isTaskOperationallyActive,
  taskNeedsAttention,
} from '../agenda-tasks/agenda-task.constants';

/**
 * Situación operativa de una incidencia: una PROYECCIÓN, nunca un dato
 * guardado. Sale de quién tiene la pelota:
 *  - una persona con trabajo        → `AgendaTask` abierta (tarea de decisión);
 *  - un tercero (proveedor…)        → `IssueWait` abierta o `SupplierVisit` planificada.
 * El estado del expediente (`Issue.status`) es otra cosa: una incidencia
 * «En reparación» puede estar en cualquiera de estas situaciones.
 */
export const ISSUE_SITUATIONS = [
  'requires_attention',
  'waiting_third_party',
  'no_pending_action',
  'stalled',
  'completed',
] as const;
export type IssueSituation = (typeof ISSUE_SITUATIONS)[number];

export const SITUATION_LABELS: Record<IssueSituation, string> = {
  requires_attention: 'Requiere atención',
  waiting_third_party: 'Esperando tercero',
  // No significa resuelta: el expediente puede seguir abierto sin que nadie tenga nada que hacer.
  no_pending_action: 'Sin acción pendiente',
  // Abierta, sin nadie que tenga la pelota y pasado el margen de transición: hay que decidir el siguiente paso.
  stalled: 'Sin siguiente paso',
  completed: 'Completada',
};

/**
 * Agrupaciones de situaciones que usa la lista de Incidencias como filtros de trabajo. ES LA ÚNICA FUENTE DE VERDAD:
 * el filtro del listado (`GET /estates/:id/issues?situation=`) y los recuentos del resumen salen de aquí, y el
 * frontend solo pone nombre a cada grupo. `no_pending_action` (la transición tras el último evento) solo aparece sin
 * filtro.
 */
export const ISSUE_SITUATION_FILTERS = {
  attention: ['requires_attention', 'stalled'],
  waiting: ['waiting_third_party'],
  resolved: ['completed'],
} as const satisfies Record<string, readonly IssueSituation[]>;
export type IssueSituationFilter = keyof typeof ISSUE_SITUATION_FILTERS;
export const ISSUE_SITUATION_FILTER_KEYS = Object.keys(
  ISSUE_SITUATION_FILTERS,
) as IssueSituationFilter[];
/**
 * ¿Cae una incidencia (con esta situación y este estado) en un grupo de trabajo? Es la ÚNICA definición: el resumen, el listado
 * de la finca y el de Operaciones la usan. «Resueltas» no incluye las retiradas: son terminales (situación `completed`) pero
 * nadie las resolvió; siguen en «Todas» y se encuentran por estado.
 */
export const inSituationFilter = (
  key: IssueSituationFilter,
  situation: IssueSituation,
  status: IssueStatus,
): boolean =>
  (ISSUE_SITUATION_FILTERS[key] as readonly IssueSituation[]).includes(
    situation,
  ) && !(key === 'resolved' && status === 'Retirada');
export const isSituationFilter = (
  value: unknown,
): value is IssueSituationFilter =>
  typeof value === 'string' &&
  (ISSUE_SITUATION_FILTER_KEYS as string[]).includes(value);

/**
 * Tareas que cuentan como "necesita tu intervención". `EN_ESPERA` es una
 * persona que ya la miró y espera algo: no es una decisión pendiente, pero SIGUE SIENDO trabajo humano vivo
 * (`isTaskOperationallyActive`): la incidencia no está «sin siguiente paso» mientras alguien la tiene aparcada.
 */
export const ATTENTION_TASK_STATUSES: AgendaTaskStatus[] =
  OPEN_STATUSES.filter(taskNeedsAttention);

/**
 * Qué hay que hacer en una tarea de una incidencia. El título de la tarea es la propia incidencia («#INC-2026-001 · Fuga»),
 * así que lo que se muestra dentro de la incidencia («Siguiente paso», «Quién tiene la pelota») es la primera línea de la
 * descripción, que dice la acción («Aprobar el envío de la consulta a X»).
 */
export function taskActionLabel(task: { title: string; description?: string | null }): string {
  const first = task.description?.split('\n')[0]?.trim();
  return first ? first : task.title;
}

export interface FactTask {
  id: string;
  /** Qué hay que hacer (ver `taskActionLabel`), no el título de la tarea. */
  title: string;
  kind: string | null;
  priority: AgendaTaskPriority;
  status: AgendaTaskStatus;
  endAt: Date;
  createdAt: Date;
}
export interface FactWait {
  id: string;
  kind: string;
  party: WaitParty;
  partyLabel: string | null;
  startedAt: Date;
  dueAt: Date | null;
}
export interface FactVisit {
  id: string;
  scheduledAt: Date;
  supplierName: string | null;
}
export interface IssueFacts {
  issueId: string;
  status: IssueStatus;
  /** Tareas con `issueId` en cualquier estado abierto (`OPEN_STATUSES`); el filtro fino lo hace la proyección. */
  tasks: FactTask[];
  /** Esperas abiertas. */
  waits: FactWait[];
  /** Visitas planificadas. */
  visits: FactVisit[];
  /** Último evento del historial: de cuándo es la última vez que pasó algo. Sin él no se puede decir que está estancada. */
  lastActivityAt?: Date | null;
  /** Cuándo se pidió la información a quien avisó (último `info_requested`): solo se mira en `PendienteInformacion`. */
  infoRequestedAt?: Date | null;
}

/** Márgenes de la proyección (configurables en `IssueWorkflowConfig`). */
export interface SituationOptions {
  /** Tiempo sin ninguna actuación prevista tras el cual una incidencia abierta se considera estancada. */
  stalledGraceMs?: number;
  /** Cuánto después de la hora de una visita se espera ya su resultado (lo que dura la visita). */
  visitGraceMs?: number;
}
export const DEFAULT_STALLED_GRACE_MS = 4 * 60 * 60_000;
export const DEFAULT_VISIT_GRACE_MS = 2 * 60 * 60_000;

/**
 * Las visitas a las que aún se espera: la hora de una visita planificada, más el margen de lo que dura, no ha pasado. Una
 * visita VENCIDA sin resultado ya no tiene la pelota el tercero: la tiene la administración, que debe confirmar qué pasó
 * (el barrido abre esa tarea; esta función solo deja de contarla como espera).
 */
export function pendingVisits(
  facts: IssueFacts,
  now: Date,
  options: SituationOptions = {},
): FactVisit[] {
  const grace = options.visitGraceMs ?? DEFAULT_VISIT_GRACE_MS;
  return facts.visits.filter(
    (v) => v.scheduledAt.getTime() + grace > now.getTime(),
  );
}

export function attentionTasksOf(facts: IssueFacts): FactTask[] {
  return facts.tasks
    .filter((t) => taskNeedsAttention(t.status))
    .sort(compareTasks);
}

/** Las tareas vivas que no piden una decisión ahora: una persona las aparcó (`EN_ESPERA`) y siguen siendo suyas. */
export function parkedTasksOf(facts: IssueFacts): FactTask[] {
  return facts.tasks
    .filter(
      (t) =>
        isTaskOperationallyActive(t.status) && !taskNeedsAttention(t.status),
    )
    .sort(compareTasks);
}

const PRIORITY_RANK: Record<AgendaTaskPriority, number> = {
  URGENTE: 0,
  ALTA: 1,
  MEDIA: 2,
  BAJA: 3,
};

function compareTasks(a: FactTask, b: FactTask): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.endAt.getTime() - b.endAt.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/**
 * Resuelta, Cerrada y Retirada son estados terminales: el trabajo vivo lo retiró la liquidación (`settleIssueLifecycle`).
 * Terminal no es «resuelta»: una Retirada no se resolvió (ver `RESOLVED_ISSUE_STATUSES`).
 */
export const isTerminalIssueStatus = (status: IssueStatus): boolean =>
  status === 'Resuelta' || status === 'Cerrada' || status === 'Retirada';

/** La gestión pidió información a quien avisó y espera su respuesta: un estado, no una espera (`IssueWait`). */
export const isAwaitingRequesterInfo = (facts: IssueFacts): boolean =>
  facts.status === 'PendienteInformacion';

/**
 * Precedencia: terminada > persona > tercero > nada. Una incidencia
 * Resuelta o Cerrada es `completed` SIEMPRE: la proyección no esconde trabajo (la liquidación ya lo retiró de verdad).
 */
export function computeSituation(
  facts: IssueFacts,
  now: Date,
  options: SituationOptions = {},
): IssueSituation {
  if (isTerminalIssueStatus(facts.status)) return 'completed';
  if (attentionTasksOf(facts).length > 0) return 'requires_attention';
  if (
    facts.waits.length > 0 ||
    pendingVisits(facts, now, options).length > 0 ||
    isAwaitingRequesterInfo(facts)
  ) {
    return 'waiting_third_party';
  }
  // Una tarea aparcada (`EN_ESPERA`) sigue siendo el siguiente paso: alguien la tiene y espera algo, no está sin dueño.
  if (parkedTasksOf(facts).length > 0) return 'no_pending_action';
  // Abierta y sin nadie con la pelota. Un margen evita marcarla en mitad de una transición.
  const grace = options.stalledGraceMs ?? DEFAULT_STALLED_GRACE_MS;
  if (
    facts.lastActivityAt &&
    now.getTime() - facts.lastActivityAt.getTime() >= grace
  )
    return 'stalled';
  return 'no_pending_action';
}

// ── Quién tiene la pelota ───────────────────────────────────────────────

export const BALL_PARTIES = [
  'administration',
  'provider',
  'insurer',
  'owner',
  'other',
  'nobody',
] as const;
export type BallParty = (typeof BALL_PARTIES)[number];

export interface BallHolder {
  party: Exclude<BallParty, 'nobody'>;
  /** Nombre a mostrar (la tarea o el tercero). */
  label: string | null;
  /** De dónde sale: tarea, espera, visita o estado. */
  source: 'task' | 'wait' | 'visit' | 'status';
  since: string | null;
  dueAt: string | null;
  refId: string;
}

export interface BallInCourt {
  /** Quien la tiene «principalmente» (misma precedencia que la situación). */
  primary: BallParty;
  /** Todos los que la tienen ahora: puede haber varias esperas a la vez. */
  holders: BallHolder[];
}

/**
 * Quién tiene ahora la pelota: una PROYECCIÓN de las mismas fuentes que la situación (nunca una columna).
 * La administración la tiene si hay una tarea abierta; un tercero si se le espera.
 */
export function computeBallInCourt(
  facts: IssueFacts,
  now: Date,
  options: SituationOptions = {},
): BallInCourt {
  if (isTerminalIssueStatus(facts.status))
    return { primary: 'nobody', holders: [] };
  const holders: BallHolder[] = [];
  const tasks = attentionTasksOf(facts);
  if (tasks.length > 0) {
    const first = tasks[0];
    holders.push({
      party: 'administration',
      label: first.title,
      source: 'task',
      since: tasks
        .reduce((a, t) => (t.createdAt < a ? t.createdAt : a), first.createdAt)
        .toISOString(),
      dueAt: first.endAt.toISOString(),
      refId: first.id,
    });
  }
  for (const visit of [...pendingVisits(facts, now, options)].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
  ))
    holders.push({
      party: 'provider',
      label: visit.supplierName,
      source: 'visit',
      since: null,
      dueAt: visit.scheduledAt.toISOString(),
      refId: visit.id,
    });
  for (const wait of [...facts.waits].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  ))
    holders.push({
      party: wait.party,
      label: wait.partyLabel,
      source: 'wait',
      since: wait.startedAt.toISOString(),
      dueAt: wait.dueAt?.toISOString() ?? null,
      refId: wait.id,
    });
  // Se espera la respuesta de quien avisó: lo dice el estado de la incidencia, no una espera aparte.
  if (isAwaitingRequesterInfo(facts))
    holders.push({
      party: 'owner',
      label: 'Quien avisó',
      source: 'status',
      since: facts.infoRequestedAt?.toISOString() ?? null,
      dueAt: null,
      refId: facts.issueId,
    });
  // La tarea aparcada va la última: no pide nada ahora, así que solo tiene la pelota si nadie más la tiene.
  const parked = parkedTasksOf(facts)[0];
  if (parked)
    holders.push({
      party: 'administration',
      label: parked.title,
      source: 'task',
      since: parked.createdAt.toISOString(),
      dueAt: parked.endAt.toISOString(),
      refId: parked.id,
    });
  return { primary: holders[0]?.party ?? 'nobody', holders };
}

// ── Siguiente paso ──────────────────────────────────────────────────────

export interface NextStep {
  kind: 'human' | 'waiting' | 'visit' | 'none' | 'completed';
  /** Código estable para la UI; el texto puede cambiar, el código no. */
  code: string;
  headline: string;
  label: string;
  detail?: string;
  /** Plazo, vencimiento o fecha de la visita (ISO). */
  at?: string;
  since?: string;
  task?: AttentionTask;
}

export interface AttentionTask {
  id: string;
  title: string;
  kind: string | null;
  priority: AgendaTaskPriority;
  dueAt: string;
  overdue: boolean;
  /** Ruta del módulo Tareas con la tarea abierta. */
  route: string;
}

const day = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Madrid',
});
const dayTime = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Madrid',
});

export function toAttentionTask(task: FactTask, now: Date): AttentionTask {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    priority: task.priority,
    dueAt: task.endAt.toISOString(),
    overdue: task.endAt.getTime() < now.getTime(),
    route: `/b/tasks?task=${task.id}`,
  };
}

/**
 * Qué pasa ahora y qué viene, derivado de las mismas fuentes y con la misma
 * precedencia que la situación. Todo seguimiento pendiente se asigna a una
 * persona mediante una tarea.
 */
export function buildNextStep(
  facts: IssueFacts,
  now: Date,
  options: SituationOptions = {},
): NextStep {
  const situation = computeSituation(facts, now, options);

  if (situation === 'requires_attention') {
    const [top, ...rest] = attentionTasksOf(facts);
    const task = toAttentionTask(top, now);
    return {
      kind: 'human',
      code: 'human_task',
      headline: 'Necesita tu intervención',
      label: task.title,
      detail: rest.length > 0 ? `y ${rest.length} más` : undefined,
      at: task.dueAt,
      task,
    };
  }

  if (situation === 'waiting_third_party') {
    const visit = [...pendingVisits(facts, now, options)].sort(
      (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
    )[0];
    if (visit) {
      return {
        kind: 'visit',
        code: 'visit_planned',
        headline: 'Visita programada',
        label: `Visita de ${visit.supplierName ?? 'el proveedor'}: ${dayTime.format(visit.scheduledAt)}`,
        at: visit.scheduledAt.toISOString(),
      };
    }
    if (isAwaitingRequesterInfo(facts)) {
      return {
        kind: 'waiting',
        code: 'info_request',
        headline: 'Esperando a un tercero',
        label: 'Esperando la respuesta del solicitante',
        since: facts.infoRequestedAt?.toISOString(),
      };
    }
    const wait = [...facts.waits].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    )[0];
    const who = wait.partyLabel ?? 'un tercero';
    let detail: string | undefined;
    if (wait.dueAt) {
      const overdue = wait.dueAt.getTime() <= now.getTime();
      if (overdue) {
        detail = `El plazo venció el ${day.format(wait.dueAt)}.`;
      } else {
        detail = `Tendrás una tarea de seguimiento el ${day.format(wait.dueAt)} si no responde.`;
      }
    }
    return {
      kind: 'waiting',
      code: `wait:${wait.kind}`,
      headline: 'Esperando a un tercero',
      label: `Esperando respuesta de ${who} desde el ${day.format(wait.startedAt)}`,
      detail,
      at: wait.dueAt?.toISOString(),
      since: wait.startedAt.toISOString(),
    };
  }

  if (situation === 'completed') {
    return {
      kind: 'completed',
      code: 'completed',
      headline: 'Completada',
      label:
        facts.status === 'Cerrada'
          ? 'La incidencia está cerrada.'
          : facts.status === 'Retirada'
            ? 'La incidencia fue retirada por quien la reportó.'
            : 'La incidencia está resuelta.',
    };
  }

  if (situation === 'stalled') {
    return {
      kind: 'none',
      code: 'stalled',
      headline: 'Sin siguiente paso',
      label:
        'La incidencia sigue abierta y nadie tiene prevista ninguna actuación.',
    };
  }

  return {
    kind: 'none',
    code: 'none',
    headline: 'Sin acción pendiente',
    label: 'No hay nada pendiente por ahora.',
  };
}
