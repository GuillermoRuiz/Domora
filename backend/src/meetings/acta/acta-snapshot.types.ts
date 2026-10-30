/**
 * Snapshot de los datos de una junta tal y como eran al generar su acta.
 *
 * Es la ÚNICA entrada del `ActaDocumentBuilder`: el documento se reproduce a partir de estos
 * valores, nunca de referencias vivas. Por eso guarda valores (coeficientes, referencias,
 * recuentos…) y no ids que haya que volver a consultar: un acta de octubre de 2026 sigue
 * mostrando los datos de octubre de 2026 aunque luego cambie un coeficiente, se revoque una
 * delegación o se retoque el censo.
 *
 * Contiene el nombre completo y el DNI de quien asistió a cada propiedad (el acta debe
 * identificarlo), pero no emails.
 */
export const ACTA_SNAPSHOT_SCHEMA_VERSION = 1;

export type ActaMeetingType = 'ordinaria' | 'extraordinaria';
export type ActaConvocation = 'primera' | 'segunda';
export type ActaMajorityType = 'unanimidad' | 'tresQuintos' | 'mayoriaSimple';

export interface ActaSnapshotMeeting {
  id: string;
  type: ActaMeetingType;
  title: string;
  status: string;
  /** ISO 8601 (UTC). */
  scheduledAt1: string;
  scheduledAt2: string;
  /** Lugar de la reunión, si se indicó al convocar. */
  location: string | null;
  /** Convocatoria confirmada por la gestora. */
  effectiveConvocation: ActaConvocation;
  /** Confirmados por la gestora; null = no consta. */
  actualStartAt: string | null;
  actualEndAt: string | null;
  celebratedAt: string | null;
}

export interface ActaSnapshotCommunity {
  name: string;
  /** Calle y número, tal y como figura en la ficha de la finca. */
  address: string | null;
  /** Localidad de la ficha de la finca. */
  locality: string | null;
}

export interface ActaSnapshotCensus {
  propertyCount: number;
  /** Suma de coeficientes del censo, con 2 decimales. */
  totalQuota: number;
  /** Propiedades del censo sin coeficiente asignado. */
  missingQuotaCount: number;
}

export interface ActaSnapshotQuorum {
  convocatoria: ActaConvocation;
  quorumRequired: boolean;
  quorumMet: boolean;
  owners: { present: number; total: number; percent: number };
  quota: { present: number; total: number; percent: number };
}

export interface ActaSnapshotAttendanceRow {
  propertyId: string;
  /** Referencia mostrable de la propiedad («1A»). */
  ref: string;
  /** Coeficiente de participación EN ESE MOMENTO, como texto decimal; null = sin coeficiente. */
  participationQuota: string | null;
  /** `representada`: hay una delegación vigente (tiene prioridad sobre la asistencia). */
  status: 'presente' | 'representada';
  /**
   * Nombre completo de quien asistió: el asistente, o el representante («X, en representación de Y»).
   * null o ausente = no consta (snapshots anteriores a incluir los nombres).
   */
  attendeeName?: string | null;
  /** DNI/NIF de quien asistió (varios, separados por coma, en el mismo orden que los nombres). null o ausente = no consta. */
  attendeeDni?: string | null;
}

export interface ActaSnapshotAgendaItem {
  id: string;
  /** Posición (1, 2, 3…) en el orden del día. */
  order: number;
  title: string;
  description: string | null;
  /** Comentarios de la gestora sobre el punto (notas de partida de la redacción). */
  comments: string | null;
  /** Cuándo se dio por tratado un punto sin votación; null = no consta. */
  treatedAt: string | null;
  hasVote: boolean;
}

export interface ActaSnapshotVoteOption {
  optionIndex: number;
  /** Texto literal de la opción tal y como se configuró. */
  label: string;
  count: number;
  /** % sobre el total de respuestas emitidas, 2 decimales. */
  percent: number;
}

export interface ActaSnapshotVote {
  voteSessionId: string;
  agendaItemId: string;
  questionIndex: number;
  question: { title: string; type: 'single_choice' | 'multiple_choice' };
  majorityType: ActaMajorityType;
  closedAt: string | null;
  /** Respuestas emitidas (propiedades que votaron). */
  totalResponses: number;
  options: ActaSnapshotVoteOption[];
  /** null = sin veredicto (selección múltiple o resultado no registrado). */
  passed: boolean | null;
  denominatorBasis: 'censo' | 'presentes' | null;
  ownersFavorablePct: number | null;
  quotaFavorablePct: number | null;
  /** `resultSummary` tal y como lo guardó el cierre de la votación. */
  resultSummary: unknown;
}

export interface ActaSourceSnapshot {
  schemaVersion: typeof ACTA_SNAPSHOT_SCHEMA_VERSION;
  /** Cuándo se congelaron los datos (ISO). */
  capturedAt: string;
  meeting: ActaSnapshotMeeting;
  community: ActaSnapshotCommunity;
  census: ActaSnapshotCensus;
  quorum: ActaSnapshotQuorum;
  /** Solo las propiedades presentes o representadas, ordenadas por referencia. */
  attendance: ActaSnapshotAttendanceRow[];
  agenda: ActaSnapshotAgendaItem[];
  votes: ActaSnapshotVote[];
  text: {
    generalComments: string | null;
    nextSteps: string | null;
  };
}
