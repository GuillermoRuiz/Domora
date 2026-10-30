/**
 * Acta canónica de una junta: lo que devuelve el backend (`/meetings/:id/acta…`). El frontend
 * solo REPRESENTA este modelo (vista previa, edición de textos, descarga): no calcula asistencia,
 * votos, acuerdos ni resultados.
 */
export type ActaVersionStatus = 'draft' | 'readyForSignature' | 'signed' | 'superseded';

export interface ActaSource {
  agendaItemId?: string;
  voteSessionIds?: string[];
  fields: string[];
}

/** Texto editable por la gestora. */
export interface ActaTextBlock {
  text: string;
  origin: 'generated' | 'notes' | 'edited';
  generatedText?: string;
  generatedOrigin?: 'generated' | 'notes';
  source: ActaSource;
}

export interface ActaVoteBlock {
  voteSessionId: string;
  question: string;
  options: { label: string; count: number }[];
  totalResponses: number;
  majority: { type: 'unanimidad' | 'tresQuintos' | 'mayoriaSimple'; label: string };
  favorable: { owners: string | null; quota: string | null; basis: 'censo' | 'presentes' | null };
  outcome: 'approved' | 'rejected' | null;
  outcomeText: string | null;
  /** Líneas ya redactadas por el backend: el visor las pinta tal cual. */
  lines: { question: string | null; options: string[]; majority: string; favorable: string | null; outcome: string | null };
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
  label: string;
  title: string;
  headingText: string;
  description: string | null;
  state: 'voted' | 'treated' | 'not-treated';
  stateText: string | null;
  narrative: ActaTextBlock;
  votes: ActaVoteBlock[];
  agreements: ActaAgreement[];
  source: ActaSource;
}

export interface ActaDocumentModel {
  schemaVersion: number;
  header: {
    title: string;
    subtitle: string;
    communityName: string;
    address: string | null;
    meetingType: 'ordinaria' | 'extraordinaria';
    source: ActaSource;
  };
  constitution: {
    paragraph: string;
    introduction: ActaTextBlock;
    facts: { dateLabel: string | null; startTime: string | null; convocation: 'primera' | 'segunda'; location: string | null; locality: string | null };
    source: ActaSource;
  };
  labels: { agenda: string; attendance: string; development: string; attendanceColumns: string[] };
  agenda: { order: number; label: string; title: string; line: string; source: ActaSource }[];
  attendance: {
    summary: { presentCount: number; totalCount: number; representedCount: number; propertiesPercent: string; quotaPercent: string; sentence: string };
    rows: { ref: string; /** Nombre completo de quien asistió (ausente en actas anteriores). */ attendee?: string; /** DNI/NIF de quien asistió (ausente en actas anteriores). */ attendeeDni?: string; quota: string; status: 'Presente' | 'Representada' }[];
    source: ActaSource;
  };
  items: ActaItem[];
  agreements: ActaAgreement[];
  observations: ActaTextBlock & { title: string };
  nextSteps: ActaTextBlock & { title: string };
  closing: { paragraph: string | null; source: ActaSource };
  signatures: { blocks: { role: 'presidente' | 'secretario'; lines: string[] }[] };
  missing: string[];
}

export interface ActaVersionView {
  id: string;
  versionNumber: number;
  status: ActaVersionStatus;
  statusLabel: string;
  createdAt: string;
  generatedAt: string | null;
  preparedAt: string | null;
  savedByName: string | null;
  /** SHA-256 del contenido canónico. Integridad, no firma. */
  versionHash: string | null;
  hasPdf: boolean;
  snapshotCapturedAt: string | null;
  narrative: { mode: 'llm' | 'fallback'; model: string | null; reason: string | null } | null;
  /** Las notas de la gestora cambiaron después de generar esta versión. */
  notesChanged: boolean;
  editable: boolean;
  document: ActaDocumentModel;
}

/** Una versión del acta en el selector del visor (sin el documento). */
export interface ActaVersionSummary {
  id: string;
  versionNumber: number;
  status: ActaVersionStatus;
  statusLabel: string;
  createdAt: string;
  savedByName: string | null;
}

/**
 * Origen del acta de una junta: redactada dentro de Domora (`generated`) o subida por la gestora
 * como PDF/DOCX ya hecho (`uploaded`).
 */
export type ActaOrigin = 'generated' | 'uploaded';

/** Archivo subido como acta de la junta. */
export interface ActaUploadInfo {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** SHA-256 (hex) del archivo: lo que firman presidente y secretario. */
  sha256: string;
  uploadedAt: string;
}

export interface ActaState {
  /** Origen del acta. Con `uploaded` el documento que se firma es el archivo subido. Siempre lo envía el backend. */
  origin?: ActaOrigin;
  /** Archivo subido como acta, si lo hay. */
  upload?: ActaUploadInfo | null;
  version: ActaVersionView | null;
  /** Acta anterior al nuevo formato: solo existe el `.docx` heredado. */
  legacy: { signed: boolean; hasDocx: boolean };
}

export type ActaMissingField = 'actualStartAt' | 'actualEndAt' | 'effectiveConvocation';

export interface ActaValidationIssue {
  code: string;
  message: string;
  field?: ActaMissingField;
}

export interface ActaValidation {
  canGenerate: boolean;
  canPrepareForSignature: boolean;
  errors: ActaValidationIssue[];
  warnings: ActaValidationIssue[];
  missingFields: ActaMissingField[];
  confirmed: { actualStartAt: string | null; actualEndAt: string | null; effectiveConvocation: 'primera' | 'segunda' | null };
  reference: { scheduledAt1: string; scheduledAt2: string; celebratedAt: string | null };
  hasVersion: boolean;
}

export interface GenerateActaPayload {
  actualStartAt?: string;
  actualEndAt?: string;
  effectiveConvocation?: 'primera' | 'segunda';
  refresh?: boolean;
}

export interface SaveActaEditsPayload {
  baseVersionId: string;
  introduction?: string;
  observations?: string;
  nextSteps?: string;
  items?: { id: string; narrative: string }[];
}

/** Estado de las firmas del acta y si quien consulta puede firmar ahora (acta enviada a firma y su turno). */
export interface ActaSigning {
  readyForSignature: boolean;
  presidenteSigned: boolean;
  secretarioSigned: boolean;
  canSign: { presidente: boolean; secretario: boolean };
}
