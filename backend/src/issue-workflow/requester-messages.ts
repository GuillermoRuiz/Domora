/**
 * Mensajes de hechos con plantilla que se pueden enviar al solicitante. Lo que se comunica sale SOLO de aquí
 * (plantilla + datos estructurados), sin texto libre del modelo: por eso Domora puede enviarlos sola en
 * autonomía ≥ 2. El texto exacto queda en el historial de la incidencia.
 *
 * Las únicas con texto libre son las que escribe una PERSONA (`custom`): Domora nunca las usa, por eso `REQUESTER_TEMPLATES`
 * (lo que puede enviar o proponer Domora) no las incluye y `MANUAL_REQUESTER_TEMPLATES` (lo que puede enviar la gestión) sí.
 */
export const REQUESTER_TEMPLATES = [
  'visit_scheduled',
  'third_party_contacted',
  'waiting_third_party',
  'issue_resolved',
] as const;
export const CUSTOM_REQUESTER_TEMPLATE = 'custom';
export const MANUAL_REQUESTER_TEMPLATES = [...REQUESTER_TEMPLATES, CUSTOM_REQUESTER_TEMPLATE] as const;
export type RequesterTemplate = (typeof MANUAL_REQUESTER_TEMPLATES)[number];
/** Longitud máxima del mensaje escrito por la gestión. */
export const CUSTOM_REQUESTER_TEXT_MAX = 500;

export interface RequesterTemplateParams {
  /** ISO 8601: cuándo (la visita). */
  when?: string;
  /** Nombre del tercero tal como se le presenta al solicitante («el seguro», «Mapfre»…). */
  label?: string;
  /** El mensaje tal como lo escribe la gestión (solo la plantilla `custom`). */
  text?: string;
}

export interface RenderedRequesterMessage {
  title: string;
  body: string;
}

const when = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

/** Qué datos exige cada plantilla; sin ellos no se puede renderizar (no se inventa «el jueves»). */
const REQUIRES: Record<RequesterTemplate, (keyof RequesterTemplateParams)[]> = {
  visit_scheduled: ['when'],
  third_party_contacted: ['label'],
  waiting_third_party: ['label'],
  issue_resolved: [],
  custom: ['text'],
};

export function renderRequesterMessage(
  template: RequesterTemplate,
  params: RequesterTemplateParams,
): RenderedRequesterMessage {
  for (const field of REQUIRES[template]) {
    if (!params[field]) throw new Error('REQUESTER_TEMPLATE_PARAMS_MISSING');
  }
  const label = (params.label ?? '').slice(0, 200);
  switch (template) {
    case 'custom': {
      const text = (params.text ?? '').trim();
      if (!text) throw new Error('REQUESTER_TEMPLATE_PARAMS_MISSING');
      return {
        title: 'Mensaje sobre tu incidencia',
        body: text.slice(0, CUSTOM_REQUESTER_TEXT_MAX),
      };
    }
    case 'visit_scheduled': {
      const date = new Date(params.when as string);
      if (!Number.isFinite(date.getTime()))
        throw new Error('REQUESTER_TEMPLATE_PARAMS_MISSING');
      return {
        title: 'Visita programada',
        body: `Se ha programado una visita para revisar tu incidencia: ${when.format(date)}.`,
      };
    }
    case 'third_party_contacted':
      return {
        title: 'Hemos contactado para gestionar tu incidencia',
        body: `Hemos contactado con ${label} para gestionar tu incidencia.`,
      };
    case 'waiting_third_party':
      return {
        title: 'Seguimos esperando respuesta',
        body: `Seguimos esperando la respuesta de ${label} sobre tu incidencia.`,
      };
    case 'issue_resolved':
      return {
        title: 'Incidencia resuelta',
        body: 'Tu incidencia figura como resuelta. Si el problema continúa, avísanos.',
      };
  }
}
