/** Fichas de «Mi comunidad» de UNA propiedad (`GET properties/:id/my-overview`) o de todas (`GET properties/my-overview`). */
export interface PropertyOverview {
  /** null en el agregado de todas las propiedades. */
  propertyId: string | null;
  /** null si la propiedad aún no tiene finca (alta de autoservicio sin vincular). */
  estateId: string | null;
  /** El recibo por pagar que vence antes; `amount` es lo que queda por pagar. */
  nextReceipt: { id: string; propertyId?: string; concept: string; amount: number; dueDate: string | null; status: string } | null;
  requests: {
    /** Incidencias activas de la propiedad. */
    open: number;
    /** Abiertas en los últimos 30 días. */
    newLast30Days: number;
    /** Abiertas en los 30 días anteriores (base del «vs. mes anterior»); ausente en respuestas antiguas. */
    newPrevious30Days?: number;
  };
  nextMeeting: { id: string; estateId?: string; title: string; scheduledAt: string } | null;
  documents: { newLast30Days: number };
}

export type PropertyEventKind = 'junta' | 'recibo' | 'reserva' | 'revision';

/** Un evento de «Próximos eventos» (`GET properties/:id/my-events`). */
export interface PropertyEvent {
  id: string;
  kind: PropertyEventKind;
  title: string;
  subtitle: string | null;
  /** AAAA-MM-DD, en hora de Madrid. */
  date: string;
  /** HH:mm en hora de Madrid; null si es de día completo. */
  time: string | null;
}

export type CommonAreasState = 'sin_datos' | 'buen_estado' | 'en_mantenimiento' | 'requiere_atencion';

/** Resumen de la comunidad que ve el propietario (`GET estates/:id/community-summary`). */
export interface CommunitySummary {
  id: string;
  name: string;
  type: string;
  /** Calle y número. */
  address: string;
  postalCode: string | null;
  location: string;
  province: string | null;
  description: string | null;
  /** Hay foto subida si no es null. */
  photoUpdatedAt: string | null;
  catastroFacadeUrl: string | null;
  indicators: {
    owners: number;
    /** Incidencias activas de toda la comunidad: solo el número. */
    activeIssues: number;
    commonAreas: CommonAreasState;
  };
}

export type CommunityTone = 'positive' | 'warning' | 'danger' | 'neutral';

export const COMMON_AREAS: Record<CommonAreasState, { text: string; tone: CommunityTone }> = {
  buen_estado: { text: 'En buen estado', tone: 'positive' },
  en_mantenimiento: { text: 'En mantenimiento', tone: 'warning' },
  requiere_atencion: { text: 'Requiere atención', tone: 'danger' },
  sin_datos: { text: 'Sin información', tone: 'neutral' },
};
