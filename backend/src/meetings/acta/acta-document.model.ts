import type {
  ActaConvocation,
  ActaMajorityType,
  ActaMeetingType,
} from './acta-snapshot.types';

/**
 * Modelo del DOCUMENTO del acta: lo que se muestra y se renderiza, ya preparado. No es un
 * modelo Prisma. Lo genera `ActaDocumentBuilder` a partir de un `ActaSourceSnapshot` (más
 * los textos redactados) y lo consumen, sin recalcular nada, la vista previa, el PDF y el
 * `.docx`. Cada sección indica de dónde sale (`source`) para poder rastrearla.
 */
export const ACTA_DOCUMENT_SCHEMA_VERSION = 1;

export interface ActaSource {
  agendaItemId?: string;
  voteSessionIds?: string[];
  /** Campos del snapshot de los que sale, p. ej. `agenda.comments`, `vote.resultSummary`. */
  fields: string[];
}

/** Texto editable por la gestora. Todo lo demás del documento es factual y no se edita. */
export interface ActaTextBlock {
  /** Texto final. Vacío = no se muestra. */
  text: string;
  /** `generated`: redactado por IA; `notes`: las notas de la gestora tal cual; `edited`: editado a mano. */
  origin: 'generated' | 'notes' | 'edited';
  /** Texto original antes de editar, para poder compararlo o restaurarlo. */
  generatedText?: string;
  /** Origen que tenía el texto original (para recuperarlo si se deshace la edición). */
  generatedOrigin?: 'generated' | 'notes';
  source: ActaSource;
}

export interface ActaVoteOption {
  label: string;
  count: number;
}

export interface ActaVoteBlock {
  voteSessionId: string;
  question: string;
  options: ActaVoteOption[];
  totalResponses: number;
  majority: { type: ActaMajorityType; label: string };
  /** Porcentajes de la mayoría, ya formateados («66,67 %»), o null si no constan. */
  favorable: {
    owners: string | null;
    quota: string | null;
    basis: 'censo' | 'presentes' | null;
  };
  /** `approved`/`rejected` solo cuando `passed` es booleano. */
  outcome: 'approved' | 'rejected' | null;
  outcomeText: string | null;
  /** Líneas ya redactadas: cada renderizador (vista previa, PDF, .docx) las pinta tal cual. */
  lines: {
    question: string | null;
    options: string[];
    majority: string;
    favorable: string | null;
    outcome: string | null;
  };
  source: ActaSource;
}

export interface ActaAgreement {
  id: string;
  itemId: string;
  text: string;
  /** «ACUERDO: …», tal y como se muestra. */
  line: string;
  source: ActaSource;
}

export interface ActaItem {
  id: string;
  order: number;
  /** «1º», «2º»… */
  label: string;
  title: string;
  /** «1º  TÍTULO DEL PUNTO», tal y como encabeza el desarrollo. */
  headingText: string;
  description: string | null;
  /** `voted`: hay votación cerrada; `treated`: constan comentarios o marca de tratado; `not-treated`: no consta. */
  state: 'voted' | 'treated' | 'not-treated';
  /** Frase fija sobre el estado real del punto cuando no hay contenido que mostrar. */
  stateText: string | null;
  narrative: ActaTextBlock;
  votes: ActaVoteBlock[];
  agreements: ActaAgreement[];
  source: ActaSource;
}

export interface ActaAttendanceRow {
  ref: string;
  /** Nombre completo de quien asistió; «—» si no consta. Ausente en actas anteriores a incluirlo. */
  attendee?: string;
  /** DNI/NIF de quien asistió; «—» si no consta. Ausente en actas anteriores a incluirlo. */
  attendeeDni?: string;
  /** Coeficiente formateado («2,50 %») o «—» si no consta. */
  quota: string;
  status: 'Presente' | 'Representada';
}

export interface ActaDocumentModel {
  schemaVersion: typeof ACTA_DOCUMENT_SCHEMA_VERSION;
  header: {
    title: string;
    subtitle: string;
    communityName: string;
    address: string | null;
    meetingType: ActaMeetingType;
    source: ActaSource;
  };
  constitution: {
    /** Párrafo formal construido solo con datos disponibles. */
    paragraph: string;
    /** Párrafo previo opcional, escrito o redactado por la gestora. */
    introduction: ActaTextBlock;
    facts: {
      dateLabel: string | null;
      startTime: string | null;
      convocation: ActaConvocation;
      location: string | null;
      locality: string | null;
    };
    source: ActaSource;
  };
  /** Rótulos fijos del documento, para que todos los renderizadores usen los mismos. */
  labels: {
    agenda: string;
    attendance: string;
    development: string;
    /** Propiedad, asistente, DNI, coeficiente y asistencia (en actas anteriores faltan las columnas del asistente y del DNI). */
    attendanceColumns: string[];
  };
  agenda: {
    order: number;
    label: string;
    title: string;
    /** «1º  Título». */ line: string;
    source: ActaSource;
  }[];
  attendance: {
    summary: {
      presentCount: number;
      totalCount: number;
      representedCount: number;
      propertiesPercent: string;
      quotaPercent: string;
      sentence: string;
    };
    rows: ActaAttendanceRow[];
    source: ActaSource;
  };
  items: ActaItem[];
  /** Todos los acuerdos, aplanados desde los puntos. */
  agreements: ActaAgreement[];
  observations: ActaTextBlock & { title: string };
  nextSteps: ActaTextBlock & { title: string };
  closing: { paragraph: string | null; source: ActaSource };
  signatures: {
    /** Huecos reservados para las firmas (la firma electrónica se conecta después, sobre una versión concreta). */
    blocks: { role: 'presidente' | 'secretario'; lines: string[] }[];
  };
  /** Datos que no constan y que por eso se omiten del documento. */
  missing: string[];
}

/**
 * Tabla de asistencia tal y como se imprime: el DNI nunca sale en el acta, ni en las versiones que
 * lo guardaron en el documento. Devuelve los rótulos y las celdas sin esa columna.
 */
export function printableAttendance(
  labels: string[],
  rows: ActaAttendanceRow[],
): { labels: string[]; rows: string[][] } {
  const keep = labels
    .map((_, index) => index)
    .filter((index) => !/^dni$/i.test(labels[index].trim()));
  return {
    labels: keep.map((index) => labels[index]),
    rows: rows.map((row) => {
      const cells = attendanceCells(labels.length, row);
      return keep.map((index) => cells[index]);
    }),
  };
}

/**
 * Celdas de una fila de la tabla de asistencia según las columnas del acta: las actas anteriores
 * llevan menos columnas (sin asistente ni DNI) y se siguen pintando como se generaron.
 */
export function attendanceCells(
  columnCount: number,
  row: ActaAttendanceRow,
): string[] {
  if (columnCount >= 5)
    return [
      row.ref,
      row.attendee ?? '—',
      row.attendeeDni ?? '—',
      row.quota,
      row.status,
    ];
  if (columnCount === 4)
    return [row.ref, row.attendee ?? '—', row.quota, row.status];
  return [row.ref, row.quota, row.status];
}
