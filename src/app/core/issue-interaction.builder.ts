import { ClaimStatus } from './insurance-claims.models';

/**
 * «Registrar gestión»: la persona cuenta qué ha pasado fuera de Domora y marca, con frases de administrador, qué
 * consecuencias tiene. Este módulo traduce esas elecciones a los DTO tipados de `POST /issues/:id/interactions`
 * (`RegisterInteractionDto` y sus efectos). La interfaz nunca muestra la lista de efectos; las validaciones de
 * dominio (la espera existe, el proveedor es de la comunidad, la incidencia sigue abierta…) siguen siendo del servidor.
 * Aquí solo se evita enviar lo que es imposible de construir (sin resumen, sin fecha…).
 */

export const INTERACTION_MEDIA = [
  { key: 'phone', label: 'Llamada' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'in_person', label: 'Conversación o reunión' },
  { key: 'other', label: 'Otro' },
] as const;
export type InteractionMedium = (typeof INTERACTION_MEDIA)[number]['key'];

export const INTERACTION_PARTIES = [
  { key: 'provider', label: 'Proveedor' },
  { key: 'insurer', label: 'Seguro' },
  { key: 'owner', label: 'Propietario' },
  { key: 'other', label: 'Otro' },
] as const;
export type InteractionParty = (typeof INTERACTION_PARTIES)[number]['key'];

export type InteractionDirection = 'outbound' | 'inbound';

/** «¿Qué pasa ahora?»: cómo sigue la incidencia tras esta gestión. Lo respalda el servidor (`nextStep` de la interacción). */
export const NEXT_STEPS = [
  { key: 'task', label: 'Tengo que hacer algo' },
  { key: 'wait', label: 'Estoy esperando una respuesta' },
  { key: 'visit', label: 'Hay una visita o actuación programada' },
  { key: 'route', label: 'Hay que cambiar la vía de gestión' },
  { key: 'resolved', label: 'La incidencia está solucionada' },
  { key: 'none', label: 'No requiere acción inmediata' },
] as const;
export type NextStepChoice = (typeof NEXT_STEPS)[number]['key'];

/** Plantillas del aviso al solicitante (`REQUESTER_TEMPLATES` del backend). */
export const REQUESTER_TEMPLATES = [
  { key: 'third_party_contacted', label: 'Hemos contactado con el tercero' },
  { key: 'waiting_third_party', label: 'Seguimos esperando su respuesta' },
  { key: 'visit_scheduled', label: 'Hay una visita programada' },
  { key: 'issue_resolved', label: 'La incidencia está resuelta' },
] as const;
/** Mensaje escrito por la gestión: solo se ofrece en «Informar al solicitante» (Domora no lo usa nunca). */
export const CUSTOM_NOTICE = { key: 'custom', label: 'Escribir un mensaje' } as const;
export const CUSTOM_NOTICE_MAX = 500;
export type RequesterTemplate = (typeof REQUESTER_TEMPLATES)[number]['key'] | typeof CUSTOM_NOTICE.key;

const WAIT_KIND_BY_PARTY: Record<InteractionParty, string> = {
  provider: 'provider_reply',
  insurer: 'insurer_reply',
  owner: 'owner_reply',
  other: 'other_reply',
};

const DEFAULT_PARTY_NAME: Record<InteractionParty, string> = {
  provider: 'el proveedor',
  insurer: 'el seguro',
  owner: 'el propietario',
  other: 'el tercero',
};

export const MAX_INTERACTION_EFFECTS = 5;

export interface InteractionForm {
  medium: InteractionMedium;
  party: InteractionParty;
  direction: InteractionDirection;
  /** Nombre libre de la contraparte («Mapfre», «la propietaria del 3ºB»). */
  partyLabel: string;
  /** Proveedor o aseguradora del directorio de la comunidad. */
  supplierId: string | null;
  /** Nombre del proveedor elegido (para redactar el aviso al solicitante). */
  supplierName: string | null;
  summary: string;
  /** Referencia que dio el tercero (nº de siniestro…). */
  claimRef: string;
  // — ¿Qué pasa ahora? —
  /** «Esperamos su respuesta». */
  waitForReply: boolean;
  /** Avisarme dentro de N días (vacío = el plazo habitual). */
  waitDays: number | null;
  /** «Ha respondido»: cierra esta espera abierta. */
  closeWaitId: string | null;
  /** «Hay visita programada»: fecha y hora (valor de `datetime-local`). */
  visitAt: string | null;
  /** «Crear un seguimiento»: qué recordar. */
  followUpNote: string;
  /** Hito del recorrido al que pertenece la tarea (obligatorio): id de un hito propio o clave de uno del sistema. */
  followUpMilestone: string;
  /** «Crear un seguimiento»: cuándo recordarlo (valor de `datetime-local`); es la fecha de la tarea. */
  followUpAt: string | null;
  /** «Tengo que hacer algo»: responsable (de su equipo) y prioridad; vacíos = sin asignar y la prioridad habitual. */
  followUpAssigneeId: string;
  followUpPriority: '' | 'URGENTE' | 'ALTA' | 'MEDIA' | 'BAJA';
  /** Cómo sigue la incidencia; obligatorio para registrar (lo exige el diálogo). */
  nextStep: NextStepChoice | null;
  /** Con «cambiar la vía»: la nueva vía y, si se quiere, por qué. */
  newRoute: string | null;
  routeReason: string;
  /** «Informar a quien lo reportó». */
  informTemplate: RequesterTemplate | null;
  /** Texto del aviso cuando la plantilla es «Escribir un mensaje» (`custom`). */
  informText: string;
  // — Siniestro de seguro (solo con «Seguro» o «Propietario») —
  /** «Se ha abierto un siniestro». */
  openClaim: boolean;
  /** Aseguradora del propietario (no está en el directorio). Con «Seguro» sale de la aseguradora elegida o del nombre. */
  claimInsurerName: string;
  claimPolicy: string;
  /** Siniestro del que se habla cuando hay varios abiertos (con uno solo no hace falta). */
  claimId: string | null;
  /** Nuevo estado del siniestro («Sin cambios» = null). */
  claimStatus: ClaimStatus | null;
  /** «Han asignado a un profesional»: del directorio o por su nombre; nunca se da de alta como proveedor. */
  assignPro: boolean;
  assignProSupplierId: string | null;
  assignProName: string;
  assignProPhone: string;
}

/** Lo que el formulario necesita saber del expediente para construir las consecuencias. */
export interface InteractionContext {
  /** Siniestros abiertos (no cerrados ni desistidos). */
  liveClaims: number;
  /** Ya hay un profesional asignado a la incidencia (la visita se programa para él). */
  hasAssignedProfessional: boolean;
}
const NO_CONTEXT: InteractionContext = { liveClaims: 0, hasAssignedProfessional: false };

export function emptyInteractionForm(party: InteractionParty = 'provider'): InteractionForm {
  return {
    medium: 'phone',
    party,
    direction: 'outbound',
    partyLabel: '',
    supplierId: null,
    supplierName: null,
    summary: '',
    claimRef: '',
    waitForReply: false,
    waitDays: null,
    closeWaitId: null,
    visitAt: null,
    followUpNote: '',
    followUpMilestone: '',
    followUpAt: null,
    followUpAssigneeId: '',
    followUpPriority: '',
    nextStep: null,
    newRoute: null,
    routeReason: '',
    informTemplate: null,
    informText: '',
    openClaim: false,
    claimInsurerName: '',
    claimPolicy: '',
    claimId: null,
    claimStatus: null,
    assignPro: false,
    assignProSupplierId: null,
    assignProName: '',
    assignProPhone: '',
  };
}

/** Hitos del recorrido entre los que se puede elegir al crear una tarea. */
export interface MilestoneChoice {
  ref: string;
  label: string;
}

export function milestoneChoices(steps: readonly { id: string | null; key: string; label: string; milestone?: boolean }[]): MilestoneChoice[] {
  const seen = new Set<string>();
  return steps
    .filter((s) => s.milestone || s.key === 'created')
    .map((s) => ({ ref: s.id ?? s.key, label: s.label }))
    .filter((c) => !seen.has(c.ref) && !!seen.add(c.ref));
}

export type InteractionEffectBody =
  | { type: 'start_wait'; kind: string; supplierId?: string; partyLabel?: string; dueInHours?: number; claimId?: string }
  | { type: 'end_wait'; waitId: string; reason: 'fulfilled' }
  | { type: 'schedule_visit'; supplierId?: string; visitorLabel?: string; scheduledAt: string }
  | { type: 'open_claim'; insurerName?: string; policyNumber?: string }
  | { type: 'update_claim'; claimId?: string; status?: ClaimStatus; reference?: string }
  | { type: 'assign_provider'; supplierId?: string; name?: string; phone?: string; byInsurer: true; claimId?: string }
  | { type: 'open_follow_up'; note: string; milestone: string; dueAt: string; assigneeUserId?: string; priority?: string }
  | { type: 'set_resolution_route'; route: string; reason?: string }
  | { type: 'resolve_issue' }
  | { type: 'inform_requester'; template: RequesterTemplate; when?: string; label?: string; text?: string };

export interface RegisterInteractionBody {
  channel: InteractionMedium;
  direction: InteractionDirection;
  party: InteractionParty | 'requester';
  partyLabel?: string;
  supplierId?: string;
  summary: string;
  claimRef?: string;
  effects?: InteractionEffectBody[];
  nextStep?: NextStepChoice;
}

export interface BuiltInteraction {
  ok: boolean;
  /** Mensajes para la persona, uno por problema. */
  errors: string[];
  body: RegisterInteractionBody | null;
}

const clean = (text: string): string => text.trim();

/** Nombre con el que se presenta al tercero al solicitante. */
export function displayPartyName(form: Pick<InteractionForm, 'party' | 'partyLabel' | 'supplierName'>): string {
  return clean(form.partyLabel) || clean(form.supplierName ?? '') || DEFAULT_PARTY_NAME[form.party];
}

export function buildInteraction(form: InteractionForm, now: Date = new Date(), context: InteractionContext = NO_CONTEXT): BuiltInteraction {
  const errors: string[] = [];
  const summary = clean(form.summary);
  if (!summary) errors.push('Cuenta brevemente qué ha pasado.');

  const usesDirectory = form.party === 'provider' || form.party === 'insurer';
  const supplierId = usesDirectory ? form.supplierId : null;
  const label = clean(form.partyLabel);
  if (!supplierId && !label) errors.push('Indica con quién has hablado.');

  const effects: InteractionEffectBody[] = [];

  if (form.closeWaitId) effects.push({ type: 'end_wait', waitId: form.closeWaitId, reason: 'fulfilled' });

  // — Siniestro de seguro: solo con el seguro o con el propietario —
  const claimParty = form.party === 'insurer' || form.party === 'owner';
  const claimRef = clean(form.claimRef);
  const claimId = form.claimId ?? undefined;
  // Con varios siniestros abiertos hay que decir de cuál se habla: nunca se adivina.
  const ambiguous = !form.openClaim && context.liveClaims > 1 && !claimId;
  // Un siniestro nuevo no tiene aún identificador: si ya hay otros abiertos, su espera o su profesional serían ambiguos.
  const newClaimBesideOthers = claimParty && form.openClaim && context.liveClaims > 0 && form.party === 'insurer' && (form.waitForReply || form.assignPro);
  if (newClaimBesideOthers)
    errors.push('Ya hay un siniestro abierto: registra el nuevo en una gestión aparte para indicar su espera o su profesional.');
  if (claimParty && form.openClaim) {
    const insurerName = clean(form.claimInsurerName);
    if (form.party === 'owner' && !insurerName) errors.push('Indica la aseguradora del propietario.');
    else if (form.party === 'insurer' && !supplierId && !label) errors.push('Indica la aseguradora.');
    else
      effects.push({
        type: 'open_claim',
        ...(form.party === 'owner' ? { insurerName } : {}),
        ...(clean(form.claimPolicy) ? { policyNumber: clean(form.claimPolicy) } : {}),
      });
  } else if (claimParty && context.liveClaims > 0 && (form.claimStatus || claimRef)) {
    if (ambiguous) errors.push('Indica de qué siniestro hablas.');
    else
      effects.push({
        type: 'update_claim',
        ...(claimId ? { claimId } : {}),
        ...(form.claimStatus ? { status: form.claimStatus } : {}),
        ...(claimRef ? { reference: claimRef } : {}),
      });
  }

  if (form.waitForReply) {
    effects.push({
      type: 'start_wait',
      kind: WAIT_KIND_BY_PARTY[form.party],
      ...(supplierId ? { supplierId } : {}),
      ...(!supplierId && label ? { partyLabel: label } : {}),
      ...(form.waitDays && form.waitDays > 0 ? { dueInHours: Math.min(Math.round(form.waitDays * 24), 720) } : {}),
      ...(form.party === 'insurer' && claimId && !form.openClaim ? { claimId } : {}),
    });
    if (form.party === 'insurer' && !form.openClaim && ambiguous && !errors.includes('Indica de qué siniestro hablas.'))
      errors.push('Indica de qué siniestro hablas.');
  }

  // Profesional que envía la aseguradora: queda atado al siniestro. Del directorio o solo por su nombre.
  let assigning = false;
  if (form.party === 'insurer' && form.assignPro) {
    const name = clean(form.assignProName);
    if (!form.assignProSupplierId && !name) errors.push('Indica el profesional que envía el seguro.');
    else if (!form.openClaim && context.liveClaims === 0) errors.push('Para indicar el profesional que envía el seguro, abre antes el siniestro.');
    else if (ambiguous) {
      if (!errors.includes('Indica de qué siniestro hablas.')) errors.push('Indica de qué siniestro hablas.');
    } else {
      assigning = true;
      effects.push({
        type: 'assign_provider',
        byInsurer: true,
        ...(form.assignProSupplierId ? { supplierId: form.assignProSupplierId } : { name }),
        ...(clean(form.assignProPhone) && !form.assignProSupplierId ? { phone: clean(form.assignProPhone) } : {}),
        ...(claimId && !form.openClaim ? { claimId } : {}),
      });
    }
  }

  // La visita es del proveedor del directorio con el que se habla o, si no, del profesional asignado a la incidencia. Con
  // cualquier otra contraparte (el propietario, un tercero, una aseguradora sin profesional asignado) es de quien se nombra.
  let visitIso: string | undefined;
  if (form.visitAt) {
    const at = new Date(form.visitAt);
    const providerVisit = form.party === 'provider' && !!supplierId;
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) errors.push('La visita tiene que ser en una fecha futura.');
    else {
      visitIso = at.toISOString();
      const named = !providerVisit && !assigning && !context.hasAssignedProfessional;
      effects.push({
        type: 'schedule_visit',
        ...(providerVisit && supplierId ? { supplierId } : {}),
        ...(named ? { visitorLabel: displayPartyName(form) } : {}),
        scheduledAt: visitIso,
      });
    }
  }

  const note = clean(form.followUpNote);
  if (form.nextStep === 'task' && !note) errors.push('Escribe qué hay que hacer.');
  if (note && !form.followUpMilestone) errors.push('Elige a qué hito del recorrido pertenece la tarea.');
  if (form.nextStep === 'wait' && !form.waitForReply) errors.push('Indica a quién se espera.');
  if (form.nextStep === 'visit' && !form.visitAt) errors.push('Indica la fecha de la visita o actuación.');
  if (form.nextStep === 'route' && !form.newRoute) errors.push('Elige la nueva vía de gestión.');
  if (note) {
    const dueAt = form.followUpAt ? new Date(form.followUpAt) : null;
    if (!dueAt || !Number.isFinite(dueAt.getTime())) errors.push('Indica cuándo quieres que te lo recordemos.');
    else if (dueAt.getTime() <= now.getTime()) errors.push('El recordatorio tiene que ser en una fecha futura.');
    else
      effects.push({
        type: 'open_follow_up',
        note,
        milestone: form.followUpMilestone,
        dueAt: dueAt.toISOString(),
        ...(form.followUpAssigneeId ? { assigneeUserId: form.followUpAssigneeId } : {}),
        ...(form.followUpPriority ? { priority: form.followUpPriority } : {}),
      });
  }

  if (form.informTemplate) {
    const customText = form.informText.trim();
    if (form.informTemplate === 'visit_scheduled' && !visitIso)
      errors.push('Para avisar de la visita, programa antes la visita.');
    else if (form.informTemplate === 'custom' && !customText) errors.push('Escribe el mensaje para quien reportó la incidencia.');
    else if (form.informTemplate === 'custom' && customText.length > CUSTOM_NOTICE_MAX)
      errors.push(`El mensaje no puede pasar de ${CUSTOM_NOTICE_MAX} caracteres.`);
    else
      effects.push({
        type: 'inform_requester',
        template: form.informTemplate,
        ...(form.informTemplate === 'visit_scheduled' ? { when: visitIso } : {}),
        ...(form.informTemplate === 'custom' ? { text: customText } : {}),
        ...(form.informTemplate === 'third_party_contacted' || form.informTemplate === 'waiting_third_party'
          ? { label: displayPartyName(form) }
          : {}),
      });
  }

  // Cambiar la vía y resolver son lo último que ocurre: el servidor exige que resolver sea el último efecto.
  if (form.nextStep === 'route' && form.newRoute)
    effects.push({ type: 'set_resolution_route', route: form.newRoute, ...(clean(form.routeReason) ? { reason: clean(form.routeReason) } : {}) });
  if (form.nextStep === 'resolved') effects.push({ type: 'resolve_issue' });

  if (effects.length > MAX_INTERACTION_EFFECTS)
    errors.push('Son demasiadas cosas a la vez: registra una parte ahora y el resto en otra gestión.');

  if (errors.length) return { ok: false, errors, body: null };
  return {
    ok: true,
    errors: [],
    body: {
      channel: form.medium,
      direction: form.direction,
      party: form.party,
      ...(label ? { partyLabel: label } : {}),
      ...(supplierId ? { supplierId } : {}),
      summary,
      ...(claimRef ? { claimRef } : {}),
      ...(effects.length ? { effects } : {}),
      ...(form.nextStep ? { nextStep: form.nextStep } : {}),
    },
  };
}

/** Aviso suelto al solicitante («Informar al solicitante»): una gestión sin contraparte externa. */
export function buildRequesterNotice(
  template: RequesterTemplate,
  params: { when?: string | null; label?: string | null; text?: string | null },
  now: Date = new Date(),
): BuiltInteraction {
  const errors: string[] = [];
  const when = params.when ? new Date(params.when) : null;
  if (template === 'visit_scheduled' && (!when || !Number.isFinite(when.getTime()) || when.getTime() <= now.getTime()))
    errors.push('No hay una visita futura de la que avisar.');
  const label = clean(params.label ?? '');
  if ((template === 'third_party_contacted' || template === 'waiting_third_party') && !label)
    errors.push('Indica a quién se ha contactado o se espera.');
  const text = (params.text ?? '').trim();
  if (template === 'custom' && !text) errors.push('Escribe el mensaje que se enviará.');
  if (template === 'custom' && text.length > CUSTOM_NOTICE_MAX) errors.push(`El mensaje no puede pasar de ${CUSTOM_NOTICE_MAX} caracteres.`);
  if (errors.length) return { ok: false, errors, body: null };
  const description = template === 'custom' ? 'mensaje escrito' : (REQUESTER_TEMPLATES.find((t) => t.key === template)?.label ?? 'Aviso');
  return {
    ok: true,
    errors: [],
    body: {
      channel: 'other',
      direction: 'outbound',
      party: 'requester',
      summary: `Aviso al solicitante: ${description.toLowerCase()}.`,
      effects: [
        {
          type: 'inform_requester',
          template,
          ...(template === 'visit_scheduled' && when ? { when: when.toISOString() } : {}),
          ...(label && template !== 'custom' ? { label } : {}),
          ...(template === 'custom' ? { text } : {}),
        },
      ],
    },
  };
}
