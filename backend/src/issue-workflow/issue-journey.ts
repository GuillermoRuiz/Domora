import type { AgendaTaskPriority, AgendaTaskStatus } from '../prisma/client';
import {
  isTaskOperationallyActive,
  taskNeedsAttention,
} from '../agenda-tasks/agenda-task.constants';
import { ROUTE_LABELS, type ResolutionRoute } from './resolution-routes';

/**
 * Recorrido («journey») de una incidencia: una PROYECCIÓN de lo que de verdad ha ocurrido (tareas, esperas, visitas, siniestros
 * y eventos del historial), de lo que toca hacer ahora y, como mucho, del siguiente paso previsible. No guarda ni decide nada:
 * la fuente de verdad son las entidades reales. Lo único que persiste (`IssueJourneyMilestone`) son los hitos propios de la
 * gestión y los ajustes de nombre u ocultación de un hito del sistema.
 */

export const JOURNEY_STEP_STATUSES = [
  'completed',
  'current',
  'upcoming',
] as const;
export type JourneyStepStatus = (typeof JOURNEY_STEP_STATUSES)[number];

export const JOURNEY_SOURCE_TYPES = [
  'system',
  'task',
  'wait',
  'visit',
  'claim',
  'interaction',
  'timeline',
  'custom',
] as const;
export type JourneySourceType = (typeof JOURNEY_SOURCE_TYPES)[number];

/** Lo que el frontend puede ofrecer sobre un paso. Lista cerrada: la navegación la decide el cliente, no se guarda ninguna URL. */
export const JOURNEY_ACTION_TYPES = [
  'open_task',
  'manage_visit',
  'register_response',
  'manage_claim',
  'register_activity',
  'change_route',
  'resolve_issue',
] as const;
export type JourneyActionType = (typeof JOURNEY_ACTION_TYPES)[number];

/** `needs_attention`: abierta y sin tarea, espera, visita ni trabajo de Domora; hay que definir el siguiente paso. */
export type JourneyStatus = 'on_track' | 'needs_attention' | 'resolved';

export interface JourneyStep {
  /** Id del hito propio (solo si `custom`); permite renombrarlo, completarlo o borrarlo. */
  id: string | null;
  /** Estable mientras exista el hecho que lo origina; es la referencia de renombrar u ocultar un hito del sistema. */
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
  /** Con fecha de seguimiento o de plazo ya pasada. */
  overdue?: boolean;
  source?: { type: JourneySourceType; id?: string };
  action?: { type: JourneyActionType; entityId?: string };
  subtitle?: string;
  /** Siniestro vivo que está detrás del paso actual (para «Gestionar siniestro»). */
  claim?: {
    id: string;
    insurerName: string;
    reference: string | null;
    status: string;
  };
}

export interface JourneyView {
  route: ResolutionRoute | null;
  status: JourneyStatus;
  steps: JourneyStep[];
}

export interface JourneyTaskFact {
  id: string;
  kind: string | null;
  /** `payload.reason` de una `review_issue`. */
  reason: string | null;
  /** Qué hay que hacer (primera línea de la descripción, o el título). */
  label: string;
  status: AgendaTaskStatus;
  priority: AgendaTaskPriority;
  assigneeName: string | null;
  dueAt: Date;
  createdAt: Date;
  completedAt: Date | null;
}
export interface JourneyWaitFact {
  id: string;
  kind: string;
  party: 'provider' | 'insurer' | 'owner' | 'other';
  partyLabel: string | null;
  startedAt: Date;
  dueAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  claimId: string | null;
}
export interface JourneyVisitFact {
  id: string;
  scheduledAt: Date;
  completedAt: Date | null;
  /** `planificada` | `realizada` | `cancelada`. */
  status: string;
  purpose: string;
  visitor: string;
}
export interface JourneyClaimFact {
  id: string;
  insurerName: string;
  reference: string | null;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
}
export interface JourneyEventFact {
  id: string;
  kind: string;
  date: Date;
  refId: string | null;
  meta: Record<string, unknown> | null;
  fromStatus?: string | null;
  toStatus?: string | null;
}

export interface JourneyFacts {
  now: Date;
  route: ResolutionRoute | null;
  issueStatus: string;
  createdAt: Date;
  /** Resuelta o cerrada con éxito. */
  resolvedAt: Date | null;
  /** Resuelta, Cerrada o Retirada: no queda «dónde está ahora». */
  terminal: boolean;
  awaitingRequesterInfo: boolean;
  tasks: JourneyTaskFact[];
  waits: JourneyWaitFact[];
  visits: JourneyVisitFact[];
  claims: JourneyClaimFact[];
  events: JourneyEventFact[];
}

export interface JourneyOverride {
  id: string;
  templateKey: string | null;
  label: string | null;
  position: number;
  hidden: boolean;
  doneAt: Date | null;
  linkedStatus?: string | null;
}

const VISIT_GRACE_MS = 2 * 60 * 60_000;
const short = (id: string) => id.slice(0, 8);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

/** «de Mapfre» / «del proveedor»: el nombre que se dio o, si no, el de la parte. */
const PARTY_OF = {
  provider: 'del proveedor',
  insurer: 'de la aseguradora',
  owner: 'del propietario',
  other: 'de un tercero',
} as const;
const partyOf = (w: {
  party: keyof typeof PARTY_OF;
  partyLabel: string | null;
}) => (w.partyLabel ? `de ${w.partyLabel}` : PARTY_OF[w.party]);

/** Lo que se dice de una tarea ya hecha, por su motivo; si no se conoce, lo que había que hacer. */
const DONE_TASK_LABEL: Record<string, string> = {
  open_insurance_claim: 'Seguro de la comunidad contactado',
  ask_owner_file_claim: 'Propietario avisado para tramitar el siniestro',
  contact_provider: 'Proveedor contactado',
};

const CHANNEL_LABEL: Record<string, string> = {
  phone: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  in_person: 'Reunión',
  other: 'Contacto',
};

const CLAIM_STATUS_STEP: Record<string, string> = {
  under_assessment: 'Siniestro en peritación',
  accepted: 'Seguro confirma cobertura',
  rejected: 'Seguro rechaza cobertura',
  withdrawn: 'Siniestro desistido',
  closed: 'Siniestro cerrado',
};

const PRIORITY_RANK: Record<AgendaTaskPriority, number> = {
  URGENTE: 0,
  ALTA: 1,
  MEDIA: 2,
  BAJA: 3,
};

const byUrgency = (a: JourneyTaskFact, b: JourneyTaskFact) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  a.dueAt.getTime() - b.dueAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime();

const isExpertVisit = (v: JourneyVisitFact) => /perit/i.test(v.purpose);

/** Etiqueta de una visita según la vía: con seguro, la primera es del perito y la siguiente del proveedor que repara. */
function visitLabel(
  f: JourneyFacts,
  v: JourneyVisitFact,
  verb: 'done' | 'next',
): string {
  const insurance =
    f.route === 'community_insurance' || f.route === 'owner_insurance';
  const live = f.visits.filter((x) => x.status !== 'cancelada');
  const expert = live.find(isExpertVisit) ?? (insurance ? live[0] : undefined);
  const kind = insurance
    ? v === expert
      ? 'del perito'
      : 'del proveedor'
    : null;
  const who = kind ?? `de ${v.visitor}`;
  return verb === 'done' ? `Visita ${who} realizada` : `Visita ${who}`;
}

function completedSteps(
  f: JourneyFacts,
): (JourneyStep & { at: Date; order: number })[] {
  const out: (JourneyStep & { at: Date; order: number })[] = [];
  const push = (
    order: number,
    at: Date,
    step: Omit<JourneyStep, 'id' | 'custom' | 'status' | 'completedAt'>,
  ) =>
    out.push({
      ...step,
      id: null,
      custom: false,
      status: 'completed',
      completedAt: at.toISOString(),
      at,
      order,
    });

  push(0, f.createdAt, {
    key: 'created',
    label: 'Incidencia creada',
    milestone: true,
    position: -1_000_000,
    source: { type: 'system' },
  });

  for (const e of f.events) {
    if (e.kind === 'route_decided') {
      const from = e.meta?.from as ResolutionRoute | null | undefined;
      const to = e.meta?.to as ResolutionRoute | null | undefined;
      // La primera decisión no es un cambio: ya lo cuentan los pasos de la vía. Solo se cuenta pasar de una vía a otra.
      if (from && to !== from)
        push(1, e.date, {
          key: `route:${short(e.id)}`,
          label: to
            ? `Vía cambiada: ${ROUTE_LABELS[from]} → ${ROUTE_LABELS[to]}`
            : `Vía retirada: ${ROUTE_LABELS[from]}`,
          source: { type: 'timeline', id: e.id },
        });
    } else if (e.kind === 'communication') {
      const channel = CHANNEL_LABEL[String(e.meta?.channel)] ?? 'Contacto';
      const who = (e.meta?.partyLabel as string | null) || null;
      push(1, e.date, {
        key: `event:${short(e.id)}`,
        label: who ? `${channel} con ${who}` : channel,
        source: { type: 'interaction', id: e.id },
      });
    } else if (e.kind === 'claim_updated') {
      const to = e.meta?.to as string | undefined;
      const label = to ? CLAIM_STATUS_STEP[to] : undefined;
      if (label && e.refId)
        push(1, e.date, {
          key: `claim_${to}:${short(e.refId)}`,
          label,
          source: { type: 'claim', id: e.refId },
        });
    }
  }

  for (const c of f.claims) {
    push(1, c.openedAt, {
      key: `claim:${short(c.id)}`,
      label: c.reference
        ? `Siniestro ${c.reference} abierto`
        : `Siniestro abierto con ${c.insurerName}`,
      source: { type: 'claim', id: c.id },
    });
    // Un siniestro con estado avanzado y sin evento de ese cambio (datos antiguos): se cuenta el hecho, con la fecha que hay.
    const hasEvent = f.events.some(
      (e) =>
        e.kind === 'claim_updated' &&
        e.refId === c.id &&
        e.meta?.to === c.status,
    );
    const label = CLAIM_STATUS_STEP[c.status];
    if (label && !hasEvent)
      push(1, c.closedAt ?? c.openedAt, {
        key: `claim_${c.status}:${short(c.id)}`,
        label,
        source: { type: 'claim', id: c.id },
      });
  }

  for (const t of f.tasks) {
    if (t.status !== 'COMPLETADA' || !t.completedAt) continue;
    push(1, t.completedAt, {
      key:
        t.reason === 'open_insurance_claim'
          ? 'community_insurance:contact'
          : `task:${short(t.id)}`,
      label:
        t.reason === 'open_insurance_claim'
          ? 'Contactar con el seguro de la comunidad'
          : (t.reason && DONE_TASK_LABEL[t.reason]) || `Hecho: ${t.label}`,
      ...(t.reason === 'open_insurance_claim' ? { milestone: true } : {}),
      ...(t.reason === 'open_insurance_claim' ? { position: 0 } : {}),
      source: { type: 'task', id: t.id },
    });
  }

  for (const w of f.waits) {
    if (!w.endedAt) continue;
    if (w.endReason === 'fulfilled')
      push(1, w.endedAt, {
        key: `wait:${short(w.id)}`,
        label: `Respuesta ${partyOf(w)}`,
        source: { type: 'wait', id: w.id },
      });
    else if (w.endReason === 'cancelled')
      push(1, w.endedAt, {
        key: `wait:${short(w.id)}`,
        label: `Espera ${partyOf(w)} cerrada`,
        source: { type: 'wait', id: w.id },
      });
  }

  for (const v of f.visits) {
    if (v.status !== 'realizada') continue;
    push(1, v.completedAt ?? v.scheduledAt, {
      key: `visit:${short(v.id)}`,
      label: visitLabel(f, v, 'done'),
      source: { type: 'visit', id: v.id },
    });
  }

  if (f.resolvedAt)
    push(2, f.resolvedAt, {
      key: 'resolved',
      label:
        f.route === 'community_insurance'
          ? 'Incidencia cerrada'
          : 'Incidencia resuelta',
      ...(f.route === 'community_insurance' ? { milestone: true } : {}),
      ...(f.route === 'community_insurance' ? { position: 1_000_000 } : {}),
      source: { type: 'system' },
    });
  return out;
}

interface Now {
  step: JourneyStep;
  /** Qué viene probablemente después. */
  hint: string | null;
}

/** Lo que toca ahora: la misma precedencia que la situación (persona > tercero > nada), pero dicha con el objeto real. */
function currentStep(f: JourneyFacts): Now | null {
  const liveClaim = f.claims.find(
    (c) => c.status !== 'withdrawn' && c.status !== 'closed',
  );
  const claim = liveClaim
    ? {
        id: liveClaim.id,
        insurerName: liveClaim.insurerName,
        reference: liveClaim.reference,
        status: liveClaim.status,
      }
    : undefined;
  const overdue = (d: Date | null) => !!d && d.getTime() < f.now.getTime();

  const attention = f.tasks
    .filter((t) => taskNeedsAttention(t.status))
    .sort(byUrgency);
  if (attention[0]) {
    const t = attention[0];
    const more = attention.length - 1;
    const parts = [
      t.assigneeName ? `Responsable: ${t.assigneeName}` : null,
      more > 0 ? `${more} tarea${more > 1 ? 's' : ''} más` : null,
    ].filter(Boolean);
    return {
      step: {
        id: null,
        key: `task:${short(t.id)}`,
        label: t.label,
        status: 'current',
        custom: false,
        dueAt: t.dueAt.toISOString(),
        overdue: overdue(t.dueAt),
        source: { type: 'task', id: t.id },
        action: { type: 'open_task', entityId: t.id },
        ...(parts.length ? { subtitle: parts.join(' · ') } : {}),
        ...(claim ? { claim } : {}),
      },
      hint: hintAfterTask(t),
    };
  }

  const waits = f.waits
    .filter((w) => !w.endedAt)
    .sort(
      (a, b) =>
        (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
        a.startedAt.getTime() - b.startedAt.getTime(),
    );
  if (waits[0]) {
    const w = waits[0];
    const waitClaim = f.claims.find((c) => c.id === w.claimId);
    const late = overdue(w.dueAt);
    return {
      step: {
        id: null,
        key: `wait:${short(w.id)}`,
        label: `Esperando respuesta ${partyOf(w)}`,
        status: 'current',
        custom: false,
        startedAt: w.startedAt.toISOString(),
        ...(w.dueAt ? { dueAt: w.dueAt.toISOString() } : {}),
        overdue: late,
        source: { type: 'wait', id: w.id },
        action: { type: 'register_response', entityId: w.id },
        ...(waitClaim?.reference
          ? { subtitle: `Siniestro ${waitClaim.reference}` }
          : {}),
        ...(claim ? { claim } : {}),
      },
      hint: 'Después: revisar la respuesta',
    };
  }

  const planned = f.visits
    .filter((v) => v.status === 'planificada')
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  if (planned[0]) {
    const v = planned[0];
    const resultDue =
      v.scheduledAt.getTime() + VISIT_GRACE_MS < f.now.getTime();
    return {
      step: {
        id: null,
        key: `visit:${short(v.id)}`,
        label: resultDue
          ? `Confirmar el resultado de la ${visitLabel(f, v, 'next').toLowerCase()}`
          : visitLabel(f, v, 'next'),
        status: 'current',
        custom: false,
        scheduledAt: v.scheduledAt.toISOString(),
        overdue: resultDue,
        source: { type: 'visit', id: v.id },
        action: { type: 'manage_visit', entityId: v.id },
        subtitle: `Profesional: ${v.visitor}`,
      },
      hint: 'Después: revisar el resultado',
    };
  }

  if (f.awaitingRequesterInfo)
    return {
      step: {
        id: null,
        key: 'requester_info',
        label: 'Esperando información de quien avisó',
        status: 'current',
        custom: false,
        source: { type: 'system' },
        action: { type: 'register_activity' },
      },
      hint: null,
    };

  const parked = f.tasks
    .filter(
      (t) =>
        isTaskOperationallyActive(t.status) && !taskNeedsAttention(t.status),
    )
    .sort(byUrgency);
  if (parked[0]) {
    const t = parked[0];
    return {
      step: {
        id: null,
        key: `task:${short(t.id)}`,
        label: t.label,
        status: 'current',
        custom: false,
        dueAt: t.dueAt.toISOString(),
        overdue: overdue(t.dueAt),
        subtitle: 'Aparcada por una persona',
        source: { type: 'task', id: t.id },
        action: { type: 'open_task', entityId: t.id },
      },
      hint: null,
    };
  }
  return null;
}

/** El siguiente paso previsible tras una tarea, sin pintar toda la rama como confirmada. */
function hintAfterTask(t: JourneyTaskFact): string | null {
  switch (t.reason) {
    case 'open_insurance_claim':
      return 'Después: esperar la respuesta del seguro';
    case 'ask_owner_file_claim':
      return 'Después: esperar al propietario';
    case 'contact_provider':
      return 'Después: esperar la respuesta del proveedor';
    default:
      return null;
  }
}

/** Proyección completa: pasado real, una sola situación presente y, como mucho, un paso previsible. */
export function projectJourney(
  facts: JourneyFacts,
  overrides: readonly JourneyOverride[],
): JourneyView {
  const byKey = new Map(
    overrides
      .filter((o) => o.templateKey)
      .map((o) => [o.templateKey as string, o]),
  );
  const custom = overrides.filter((o) => !o.templateKey && !o.hidden);

  const completed: (JourneyStep & { at: Date; order: number })[] = [];
  for (const s of completedSteps(facts)) {
    const o = byKey.get(s.key);
    // Un hito del sistema solo admite ocultarse o cambiar de nombre: nunca darse por hecho ni por no hecho a mano.
    if (o?.hidden && s.key !== 'created' && s.key !== 'resolved') continue;
    completed.push({
      ...s,
      label: o?.label?.trim() || s.label,
      // «Incidencia cerrada» siempre va con el estado Cerrada.
      linkedStatus:
        s.key === 'resolved' && s.milestone ? 'Cerrada' : o?.linkedStatus,
    });
  }
  for (const o of custom) {
    const statusEvent = o.linkedStatus
      ? facts.events.find(
          (event) =>
            event.kind === 'status_changed' &&
            event.toStatus === o.linkedStatus,
        )
      : null;
    const doneAt =
      o.doneAt ??
      statusEvent?.date ??
      (o.linkedStatus === facts.issueStatus
        ? o.linkedStatus === 'Abierta'
          ? facts.createdAt
          : facts.now
        : null);
    if (!doneAt) continue;
    completed.push({
      id: o.id,
      key: `custom:${short(o.id)}`,
      label: o.label?.trim() || 'Hito',
      status: 'completed',
      custom: true,
      completedAt: doneAt.toISOString(),
      source: { type: 'custom', id: o.id },
      milestone: true,
      position: o.position,
      linkedStatus: o.linkedStatus,
      at: doneAt,
      order: 1,
    });
  }
  // «Contactar con el seguro» no deja huella en Domora: la gestión lo da por hecho a mano.
  const contactDone = byKey.get('community_insurance:contact');
  if (
    contactDone?.doneAt &&
    facts.route === 'community_insurance' &&
    !completed.some((s) => s.key === 'community_insurance:contact')
  )
    completed.push({
      id: null,
      key: 'community_insurance:contact',
      label:
        contactDone.label?.trim() || 'Contactar con el seguro de la comunidad',
      status: 'completed',
      custom: false,
      completedAt: contactDone.doneAt.toISOString(),
      milestone: true,
      position: 0,
      linkedStatus: contactDone.linkedStatus,
      source: { type: 'system' },
      at: contactDone.doneAt,
      order: 1,
    });
  // «Creada» siempre abre y «resuelta» siempre cierra; entre medias, por fecha.
  completed.sort((a, b) =>
    a.order === 1 && b.order === 1
      ? a.at.getTime() - b.at.getTime()
      : a.order - b.order,
  );

  const steps: JourneyStep[] = completed.map(
    ({ at: _at, order: _order, ...s }) => s,
  );
  if (facts.terminal) return { route: facts.route, status: 'resolved', steps };

  const now = currentStep(facts);
  let status: JourneyStatus = 'on_track';
  if (now) {
    steps.push(now.step);
    if (now.hint)
      steps.push({
        id: null,
        key: 'next',
        label: now.hint,
        status: 'upcoming',
        custom: false,
        source: { type: 'system' },
      });
  } else {
    status = 'needs_attention';
    steps.push({
      id: null,
      key: 'define_next_step',
      label: 'Definir siguiente paso',
      status: 'current',
      custom: false,
      subtitle: facts.route
        ? 'Nadie tiene ahora nada que hacer, esperar ni visitar.'
        : 'Falta decidir cómo se gestiona y qué se hace ahora.',
      source: { type: 'system' },
      action: { type: facts.route ? 'register_activity' : 'change_route' },
    });
  }
  // Lo que la gestión se ha apuntado y aún no hizo: es suyo, se muestra tal cual como pendiente.
  if (
    facts.route === 'community_insurance' &&
    !steps.some((step) => step.key === 'community_insurance:contact')
  ) {
    const override = byKey.get('community_insurance:contact');
    steps.push({
      id: null,
      key: 'community_insurance:contact',
      label:
        override?.label?.trim() || 'Contactar con el seguro de la comunidad',
      status: 'upcoming',
      custom: false,
      milestone: true,
      position: 0,
      linkedStatus: override?.linkedStatus,
      source: { type: 'system' },
    });
  }
  for (const o of custom
    .filter(
      (x) =>
        !x.doneAt &&
        x.linkedStatus !== facts.issueStatus &&
        !facts.events.some(
          (event) =>
            event.kind === 'status_changed' &&
            event.toStatus === x.linkedStatus,
        ),
    )
    .sort((a, b) => a.position - b.position))
    steps.push({
      id: o.id,
      key: `custom:${short(o.id)}`,
      label: o.label?.trim() || 'Hito',
      status: 'upcoming',
      custom: true,
      milestone: true,
      position: o.position,
      linkedStatus: o.linkedStatus,
      source: { type: 'custom', id: o.id },
    });
  if (facts.route === 'community_insurance') {
    const override = byKey.get('resolved');
    steps.push({
      id: null,
      key: 'resolved',
      label: override?.label?.trim() || 'Incidencia cerrada',
      status: 'upcoming',
      custom: false,
      milestone: true,
      position: 1_000_000,
      linkedStatus: 'Cerrada',
      source: { type: 'system' },
    });
  }
  return { route: facts.route, status, steps };
}
