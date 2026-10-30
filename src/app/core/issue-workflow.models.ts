/**
 * Modelo del frontend para el workflow de Incidencias. Es un ESPEJO de lo que el backend ya proyecta
 * (`IssueSituationService`): la situación, el siguiente paso y quién tiene la pelota se calculan allí a partir de
 * tareas, esperas y visitas. Aquí solo se traducen a lenguaje de administrador: no se guarda ni se deduce
 * ningún estado propio.
 */

export const ISSUE_SITUATIONS = [
  'requires_attention',
  'waiting_third_party',
  'no_pending_action',
  'stalled',
  'completed',
] as const;
export type IssueSituationKey = (typeof ISSUE_SITUATIONS)[number];

export type BallParty =
  | 'administration'
  | 'provider'
  | 'insurer'
  | 'owner'
  | 'other'
  | 'nobody';

export interface BallHolder {
  party: Exclude<BallParty, 'nobody'>;
  label: string | null;
  source: 'task' | 'wait' | 'visit' | 'status';
  since: string | null;
  dueAt: string | null;
  refId: string;
}
export interface BallInCourt {
  primary: BallParty;
  holders: BallHolder[];
}

export interface AttentionTask {
  id: string;
  title: string;
  kind: string | null;
  priority: string;
  dueAt: string;
  overdue: boolean;
  /** Ruta del módulo Tareas con la tarea abierta (`/b/tasks?task=<id>`). */
  route: string;
}

export interface NextStep {
  kind: 'human' | 'waiting' | 'visit' | 'none' | 'completed';
  /** Código estable; el texto del backend puede cambiar. */
  code: string;
  headline: string;
  label: string;
  detail?: string;
  at?: string;
  since?: string;
  task?: AttentionTask;
}

export interface IssueSituationView {
  issueId: string;
  situation: IssueSituationKey;
  label: string;
  nextStep: NextStep;
  ballInCourt: BallInCourt;
  attention: { count: number; tasks: AttentionTask[] };
}

export interface IssueSituationSummary {
  total: number;
  activeTotal: number;
  counts: Record<IssueSituationKey, number>;
  /** Los mismos recuentos agrupados como filtros de trabajo: el agrupamiento lo hace el backend (única fuente de verdad). */
  filters: Record<Exclude<IssueListFilter, 'all'>, number>;
  requiresAttention: number;
}

// ── Textos de la interfaz ───────────────────────────────────────────────

export const SITUATION_LABEL: Record<IssueSituationKey, string> = {
  requires_attention: 'Requiere atención',
  waiting_third_party: 'Esperando tercero',
  stalled: 'Sin siguiente paso',
  completed: 'Resuelta',
  no_pending_action: 'Sin acción pendiente',
};

/** Color del indicador de cada situación (los temas ya existentes de las etiquetas de estado). */
export const SITUATION_THEME: Record<IssueSituationKey, string> = {
  requires_attention: 'red',
  stalled: 'orange',
  waiting_third_party: 'purple',
  completed: 'green',
  no_pending_action: 'gray',
};

export const BALL_LABEL: Record<BallParty, string> = {
  administration: 'Administración',
  provider: 'Proveedor',
  insurer: 'Seguro',
  owner: 'Propietario',
  other: 'Tercero',
  nobody: 'Sin siguiente responsable',
};

export const RESOLUTION_ROUTES = [
  'community_provider',
  'community_insurance',
  'owner_insurance',
  'direct_management',
] as const;
export type ResolutionRoute = (typeof RESOLUTION_ROUTES)[number];

export const ROUTE_LABEL: Record<ResolutionRoute, string> = {
  community_provider: 'Proveedor (sin seguro)',
  community_insurance: 'Seguro de la comunidad',
  owner_insurance: 'Seguro del propietario',
  direct_management: 'Administrador',
};
export const NO_ROUTE_LABEL = 'Por determinar';

export const isResolutionRoute = (value: unknown): value is ResolutionRoute =>
  typeof value === 'string' && (RESOLUTION_ROUTES as readonly string[]).includes(value);

export function routeLabel(route: string | null | undefined): string {
  return isResolutionRoute(route) ? ROUTE_LABEL[route] : NO_ROUTE_LABEL;
}

// ── Filtros orientados al trabajo ───────────────────────────────────────

export type IssueListFilter = 'all' | 'attention' | 'waiting' | 'resolved';

export const ISSUE_LIST_FILTERS: { key: IssueListFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'attention', label: 'Requieren atención' },
  { key: 'waiting', label: 'Esperando tercero' },
  { key: 'resolved', label: 'Resueltas' },
];

/**
 * Qué situaciones agrupa cada filtro lo decide el BACKEND (`ISSUE_SITUATION_FILTERS`): el listado se filtra con
 * `GET /estates/:id/issues?situation=<clave>` y los recuentos llegan agrupados en `summary.filters`. Aquí solo se les
 * pone nombre; no se repite el mapeo.
 */

// ── Siguiente paso en lenguaje de administrador ─────────────────────────

const weekdayDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
const weekdayDayTime = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Madrid',
});

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

export interface NextStepText {
  /** Qué está ocurriendo. */
  headline: string;
  /** Qué tiene que pasar después, en una frase. */
  text: string;
  /** Cuándo toca actuar, ya redactado («Próximo seguimiento: jueves, 24 oct»). */
  when: string | null;
}

/**
 * Traduce el siguiente paso del backend a las frases de la pantalla. Se decide por el código estable del paso, no por
 * su texto.
 */
export function describeNextStep(step: NextStep, situation: IssueSituationKey): NextStepText {
  const at = step.at ? new Date(step.at) : null;
  const validAt = at && Number.isFinite(at.getTime()) ? at : null;
  const [family] = step.code.split(':');

  if (family === 'human_task') {
    return {
      headline: 'Necesita tu intervención',
      text: step.label,
      when: validAt ? `Plazo: ${weekdayDay.format(validAt)}` : null,
    };
  }
  if (family === 'visit_planned') {
    return {
      headline: 'Visita programada',
      text: step.label,
      when: validAt ? weekdayDayTime.format(validAt) : null,
    };
  }
  if (family === 'wait') {
    const overdue = !!validAt && validAt.getTime() <= Date.now();
    return {
      headline: 'Esperando a un tercero',
      text: `${step.label.replace(/ desde el .*$/, '')}.`,
      when: validAt ? `${overdue ? 'Seguimiento vencido' : 'Próximo seguimiento'}: ${weekdayDay.format(validAt)}` : null,
    };
  }
  if (situation === 'stalled' || family === 'stalled') {
    return {
      headline: 'Sin siguiente paso',
      text: 'La incidencia sigue abierta y nadie tiene prevista ninguna actuación.',
      when: null,
    };
  }
  if (situation === 'completed' || family === 'completed') {
    return { headline: SITUATION_LABEL.completed, text: step.label, when: null };
  }
  return { headline: SITUATION_LABEL.no_pending_action, text: 'No hay nada pendiente por ahora.', when: null };
}

/** Quién tiene la pelota, ya redactado: «Proveedor · Ascensores Levante». */
export function holderText(holder: BallHolder): string {
  const who = BALL_LABEL[holder.party];
  return holder.label && holder.party !== 'administration' ? `${who} · ${holder.label}` : who;
}

/** Cuánto lleva abierta («hoy», «hace 3 días»). `date` es la fecha de alta (YYYY-MM-DD o ISO). */
export function ageLabel(date: string, now: Date = new Date()): string {
  const from = new Date(date);
  if (!Number.isFinite(from.getTime())) return '';
  const days = Math.floor((now.getTime() - from.getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  if (days < 60) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return `hace ${months} meses`;
}

export type JourneyStepStatus = 'completed' | 'current' | 'upcoming';
export type JourneySourceType = 'system' | 'task' | 'wait' | 'visit' | 'claim' | 'interaction' | 'timeline' | 'custom';
/** Lo que se puede hacer sobre un paso. Lista cerrada: es el cliente quien decide a dónde lleva cada una. */
export type JourneyActionType =
  | 'close_issue'
  | 'open_task'
  | 'manage_visit'
  | 'register_response'
  | 'manage_claim'
  | 'register_activity'
  | 'change_route'
  | 'resolve_issue';

/** Un paso del recorrido: algo que ocurrió, lo que toca ahora o el siguiente paso previsible. */
export interface IssueJourneyStep {
  /** Solo en los hitos propios de la gestión. */
  id: string | null;
  key: string;
  label: string;
  status: JourneyStepStatus;
  custom: boolean;
  milestone?: boolean;
  position?: number;
  linkedStatus?: string | null;
  completedAt?: string;
  scheduledAt?: string;
  startedAt?: string;
  dueAt?: string;
  overdue?: boolean;
  source?: { type: JourneySourceType; id?: string };
  action?: { type: JourneyActionType; entityId?: string };
  subtitle?: string;
  claim?: { id: string; insurerName: string; reference: string | null; status: string };
}

/** `needs_attention`: incidencia abierta sin tarea, espera ni visita. */
export interface IssueJourneyView {
  route: string | null;
  status: 'on_track' | 'needs_attention' | 'resolved';
  steps: IssueJourneyStep[];
}
