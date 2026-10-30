import { IssueTimelineEntry } from '../../core/models';

/**
 * Cronología única de un expediente. Todo lo que ocurre (personas, Domora, terceros, cambios de estado,
 * comunicaciones) llega ya como una sola lista de eventos del backend; aquí solo se decide cómo se pinta. No es un log
 * técnico: no se muestran ids, políticas, prompts, autonomía ni datos del worker, y los eventos que son pura
 * maquinaria del workflow (tareas internas, envío en curso) se omiten porque su resultado ya aparece en otros eventos.
 */

export type TimelineTone = 'person' | 'domora' | 'third' | 'status' | 'communication';

export interface TimelineItem {
  key: string;
  tone: TimelineTone;
  icon: string;
  /** Quién: nombre de la persona, «Domora», «Sistema» o «Tercero». */
  author: string;
  /** Cuándo, ya redactado («23 oct, 10:15»). */
  date: string;
  /** El mismo instante en ISO, para el atributo `datetime`. */
  iso: string;
  /** Frase corta que sitúa el evento («Aviso al solicitante»); opcional. */
  lead: string | null;
  /** Lo ocurrido, tal como lo redactó el backend (para un aviso al solicitante, el texto exacto enviado). */
  text: string;
  /** Línea secundaria legible: canal y contraparte de una gestión («Llamada · Mapfre · Ref. 123»). */
  detail: string | null;
}

/** Eventos que solo son maquinaria. Las tareas y los hitos SÍ se muestran: el historial lo cuenta todo. */
const HIDDEN_KINDS: ReadonlySet<string> = new Set(['email_sending']);

const COMMUNICATION_KINDS: ReadonlySet<string> = new Set([
  'communication',
  'email_sent',
  'notification_sent',
  'requester_informed',
  'provider_contacted',
  'report_received',
  'info_requested',
  'info_provided',
]);

export const CHANNEL_LABEL: Record<string, string> = {
  phone: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  in_person: 'Conversación',
  other: 'Otro medio',
  in_app: 'Aviso en la app',
};

const ICON: Record<TimelineTone, string> = {
  person: 'user',
  domora: 'settings',
  third: 'building',
  status: 'refresh',
  communication: 'mail',
};

const LEAD: Record<string, string> = {
  requester_informed: 'Aviso al solicitante',
  info_requested: 'Información pedida al solicitante',
  info_provided: 'Respuesta del solicitante',
  route_suggested: 'Sugerencia',
  route_decided: 'Vía de gestión',
  visit_scheduled: 'Visita',
  appointment_confirmed: 'Visita confirmada',
  visit_completed: 'Visita realizada',
  visit_cancelled: 'Visita cancelada',
  visit_rescheduled: 'Visita reprogramada',
  wait_overdue: 'Sin respuesta',
  claim_opened: 'Siniestro',
  claim_updated: 'Siniestro',
  provider_assigned: 'Profesional asignado',
  task_opened: 'Tarea creada',
  task_resolved: 'Tarea completada',
  task_cancelled: 'Tarea cancelada',
  task_reopened: 'Tarea reabierta',
  milestone_added: 'Hito añadido',
  milestone_renamed: 'Hito renombrado',
  milestone_linked: 'Hito y estado',
  milestone_done: 'Hito completado',
  milestone_reopened: 'Hito reabierto',
  milestone_moved: 'Hito reordenado',
  milestone_removed: 'Hito quitado',
};

function metaOf(entry: IssueTimelineEntry): Record<string, unknown> {
  return entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
}

/** Un aviso suelto al solicitante deja dos eventos: la gestión (resumen) y el aviso (texto exacto). Solo se enseña el segundo. */
function isStandaloneRequesterNotice(entry: IssueTimelineEntry): boolean {
  if (entry.kind !== 'communication') return false;
  const meta = metaOf(entry);
  const effects = Array.isArray(meta['effects']) ? (meta['effects'] as unknown[]) : [];
  return meta['party'] === 'requester' && effects.length === 1 && effects[0] === 'inform_requester';
}

export function toneOf(entry: IssueTimelineEntry): TimelineTone {
  const kind = entry.kind ?? 'note';
  if (kind === 'status_changed') return 'status';
  if (entry.actorKind === 'external') return 'third';
  if (COMMUNICATION_KINDS.has(kind)) return 'communication';
  if (entry.actorKind === 'ai' || entry.actorKind === 'system') return 'domora';
  return 'person';
}

function detailOf(entry: IssueTimelineEntry): string | null {
  if (entry.kind !== 'communication') return null;
  const meta = metaOf(entry);
  const parts = [CHANNEL_LABEL[String(meta['channel'])] ?? null, typeof meta['partyLabel'] === 'string' ? meta['partyLabel'] : null];
  if (typeof meta['claimRef'] === 'string' && meta['claimRef']) parts.push(`Ref. ${meta['claimRef']}`);
  const text = parts.filter((p): p is string => !!p).join(' · ');
  return text || null;
}

const whenFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Madrid' });
const dayFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' });

/** «23 oct, 10:15»: cuándo ocurrió, con la hora si se conoce (los eventos antiguos solo traen el día). */
export function whenLabel(entry: IssueTimelineEntry): string {
  const instant = entry.at && entry.at.length > 10 ? new Date(entry.at) : null;
  if (instant && Number.isFinite(instant.getTime())) return whenFormat.format(instant);
  const day = new Date(entry.date);
  return Number.isFinite(day.getTime()) ? dayFormat.format(day) : entry.date;
}

export function presentTimeline(entries: readonly IssueTimelineEntry[]): TimelineItem[] {
  return entries
    .filter((e) => !HIDDEN_KINDS.has(e.kind ?? 'note') && !isStandaloneRequesterNotice(e))
    .map((e, index) => {
      const tone = toneOf(e);
      return {
        key: `${e.date}-${index}`,
        tone,
        // La chispa solo para lo que hizo la IA; un proceso automático sin IA (un plazo vencido) no la lleva.
        icon: tone === 'domora' && e.actorKind === 'ai' ? 'sparkles' : ICON[tone],
        author: e.author,
        date: whenLabel(e),
        iso: e.at ?? e.date,
        // Una nota interna lo dice: es la única nota que quien avisó no ve.
        lead: e.internal && (e.kind ?? 'note') === 'note' ? 'Nota interna' : (LEAD[e.kind ?? ''] ?? null),
        text: e.text,
        detail: detailOf(e),
      };
    });
}
