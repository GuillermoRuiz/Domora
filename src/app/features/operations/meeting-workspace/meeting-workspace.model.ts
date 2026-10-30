import type {
  AgendaItem,
  Meeting,
  MeetingAttachment,
  MeetingAttendee,
  MeetingVoteDelegation,
  OwnerProperty,
  PropertyHolder,
  PropertyHolders,
  QuorumResult,
  VoteMajorityType,
  VoteResponseEntry,
  VoteSession,
} from '../../../core/models';

/**
 * Modelo de vista del detalle de junta. Son funciones puras sobre los datos
 * que ya devuelve la API (junta, quórum, asistencia, propiedades,
 * delegaciones y votaciones): las pestañas solo pintan lo que se calcula aquí.
 */

export type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'muted';

/** La junta ya se celebró: está celebrada o, con el acta firmada, firmada. */
export function meetingHeld(meeting: Pick<Meeting, 'status'>): boolean {
  return meeting.status === 'celebrada' || meeting.status === 'firmada';
}

/** Las notas y comentarios del acta se pueden escribir hasta que el acta se firma o la junta se cancela. */
export function actaEditable(meeting: Pick<Meeting, 'status'>): boolean {
  return meeting.status === 'convocada' || meeting.status === 'celebrada';
}

export interface MeetingData {
  meeting: Meeting;
  quorum: QuorumResult | null;
  attendance: MeetingAttendee[];
  properties: OwnerProperty[];
  /** Titulares con cuenta de cada propiedad; ausente si no se pudieron cargar. */
  holders?: PropertyHolders[];
  delegations: MeetingVoteDelegation[];
  voteSessions: VoteSession[];
  attachments: MeetingAttachment[];
}

const numberFormat = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 1,
});
const MAJORITY_LABEL: Record<VoteMajorityType, string> = {
  mayoriaSimple: 'mayoría simple',
  tresQuintos: 'tres quintas partes',
  unanimidad: 'unanimidad',
};

export function formatPercent(value: number | null | undefined): string {
  return value == null || Number.isNaN(value)
    ? '—'
    : `${numberFormat.format(value)}%`;
}

// ── Participación ──────────────────────────────────────────────────────────

export type AttendanceStatus = 'presente' | 'representado' | 'ausente';

export interface ParticipationRow {
  propertyId: string;
  owner: string;
  initials: string;
  unit: string;
  status: AttendanceStatus;
  statusLabel: string;
  representedBy: string | null;
  /** DNI del representante cuando es una persona externa sin cuenta. */
  representedByDni: string | null;
  /** Titulares con cuenta de la propiedad: si hay varios, se elige cuál asiste. */
  holders?: PropertyHolder[];
  /** Titular que asiste (si ya está presente) o que asistirá al marcarla como presente. */
  holderUserId?: string | null;
  /** Delegación vigente de la propiedad (para cambiarla o quitarla). */
  delegationId: string | null;
  /** Cuenta del representante, si la tiene (los externos no pueden asistir en Domora). */
  representativeUserId: string | null;
  /** Asistencias registradas de la propiedad (para marcarla como ausente). */
  attendanceIds: string[];
  /** Asistencias del propio representante — se retiran al quitarle la representación. */
  representativeAttendanceIds: string[];
  quota: string;
  /** Coeficiente como número (en %), para sumarlo por edificio. */
  quotaValue: number;
  /** Edificio o bloque de la propiedad; vacío si la finca no los distingue. */
  group: string;
  hasVote: boolean;
  voteLabel: string;
}

export interface AttendanceGroup {
  name: string;
  /** Propiedades presentes o representadas que se muestran (tras la búsqueda). */
  units: { propertyId: string; unit: string; quota: string }[];
  /** `5 de 7`: presentes sobre el total de propiedades del grupo. */
  count: string;
  /** Coeficiente presente del grupo. */
  quota: string;
}

/** «Edificio A», «Bloque 2»…: un bloque suelto se muestra como edificio. */
function groupLabel(group: string): string {
  if (!group) return 'Propiedades';
  return /^(edificio|bloque|portal|escalera|torre)/i.test(group) ? group : `Edificio ${group}`;
}

/** Propiedades presentes o representadas, agrupadas por edificio y, opcionalmente, filtradas por unidad. */
export function attendanceGroups(rows: ParticipationRow[], query = ''): AttendanceGroup[] {
  const needle = query.trim().toLowerCase();
  const byGroup = new Map<string, ParticipationRow[]>();
  for (const row of rows) byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
  const groups: AttendanceGroup[] = [];
  for (const [group, members] of byGroup) {
    const present = members.filter((row) => row.status !== 'ausente');
    const shown = present.filter((row) => !needle || row.unit.toLowerCase().includes(needle));
    if (!shown.length) continue;
    groups.push({
      name: groupLabel(group),
      units: shown.map((row) => ({ propertyId: row.propertyId, unit: row.unit, quota: row.quota })),
      count: `${present.length} de ${members.length}`,
      quota: formatPercent(present.reduce((sum, row) => sum + row.quotaValue, 0)),
    });
  }
  return groups;
}

export interface ParticipationStats {
  attending: number;
  totalOwners: number;
  represented: number;
  /** % de propietarios presentes (asistentes + representados) sobre el censo. */
  ownersPercent: number;
  quotaPercent: number;
  quorumTone: Tone;
  quorumLabel: string;
  quorumHint: string;
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  presente: 'Presente',
  representado: 'Representado',
  ausente: 'Ausente',
};

export function initialsOf(name: string): string {
  const parts = name
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

export function activeDelegations(
  delegations: MeetingVoteDelegation[],
): MeetingVoteDelegation[] {
  return delegations.filter((delegation) => !delegation.revokedAt);
}

/**
 * `holderChoice`: titular elegido a mano por propiedad (`propertyId → userId`) para cuando la
 * propiedad tiene varios y aún no ha asistido ninguno.
 */
export function participationRows(
  data: MeetingData,
  holderChoice: Record<string, string> = {},
): ParticipationRow[] {
  const delegations = activeDelegations(data.delegations);
  return data.properties.map((property) => {
    const attendees = data.attendance.filter(
      (attendee) => attendee.propertyId === property.id,
    );
    const delegation = delegations.find(
      (item) => item.propertyId === property.id,
    );
    const representative =
      delegation?.representativeUser?.fullName ?? delegation?.representativeName ?? null;
    // Una delegación vigente significa «representado»: el representante ejerce
    // la presencia y el voto del titular aunque no haya entrado a la sala.
    const status: AttendanceStatus = delegation
      ? 'representado'
      : attendees.length
        ? 'presente'
        : 'ausente';
    const unit = property.ref ?? [property.floor, property.door].filter(Boolean).join('');
    const holders = data.holders?.find((entry) => entry.propertyId === property.id)?.holders ?? [];
    // Quien asiste, si es uno de los titulares; si no, el elegido a mano o el primero.
    const attending = holders.find((holder) => attendees.some((attendee) => attendee.userId === holder.userId));
    const chosen = holders.find((holder) => holder.userId === holderChoice[property.id]);
    const holder = attending ?? chosen ?? holders[0] ?? null;
    const owner =
      delegation?.delegatorUser?.fullName ??
      attendees[0]?.displayName ??
      holder?.name ??
      (unit ? `Titular de ${unit}` : 'Titular sin nombre');
    const hasVote = status !== 'ausente';
    return {
      propertyId: property.id,
      owner,
      initials: initialsOf(owner),
      unit: unit || '—',
      holders,
      holderUserId: holder?.userId ?? null,
      status,
      statusLabel: STATUS_LABEL[status],
      representedBy: representative,
      representedByDni: delegation && !delegation.representativeUser ? (delegation.representativeDni ?? null) : null,
      delegationId: delegation?.id ?? null,
      representativeUserId: delegation?.representativeUserId ?? null,
      attendanceIds: attendees.map((attendee) => attendee.id),
      representativeAttendanceIds: delegation?.representativeUserId
        ? attendees
            .filter((attendee) => attendee.userId === delegation.representativeUserId)
            .map((attendee) => attendee.id)
        : [],
      quota: formatPercent(property.participationQuota),
      quotaValue: property.participationQuota ?? 0,
      group: property.block?.trim() || property.staircase?.trim() || '',
      hasVote,
      voteLabel: hasVote ? 'Con voto' : 'Sin registrar',
    };
  });
}

export function participationStats(
  data: MeetingData,
  rows: ParticipationRow[],
): ParticipationStats {
  const quorum = data.quorum;
  let quorumTone: Tone = 'muted';
  let quorumLabel = 'Quórum sin calcular';
  let quorumHint = 'Todavía no hay datos de asistencia.';
  if (quorum) {
    if (!quorum.quorumRequired) {
      quorumTone = 'blue';
      quorumLabel = 'Sin quórum exigible';
      quorumHint = 'En segunda convocatoria no se exige quórum mínimo.';
    } else if (quorum.quorumMet) {
      quorumTone = 'green';
      quorumLabel = 'Quórum alcanzado';
      quorumHint =
        'Se ha alcanzado el quórum necesario para la celebración de la junta.';
    } else {
      quorumTone = 'red';
      quorumLabel = 'Quórum no alcanzado';
      quorumHint = 'Aún no hay asistencia suficiente para celebrar la junta.';
    }
  }
  return {
    attending: quorum?.owners.present ?? 0,
    totalOwners: quorum?.owners.total ?? data.properties.length,
    represented: rows.filter((row) => row.status === 'representado').length,
    ownersPercent: quorum?.owners.percent ?? 0,
    quotaPercent: quorum?.quota.percent ?? 0,
    quorumTone,
    quorumLabel,
    quorumHint,
  };
}

// ── Orden del día ──────────────────────────────────────────────────────────

export interface TallyOption {
  label: string;
  count: number;
  tone: Tone;
}

export interface AgendaRow {
  id: string;
  number: string;
  title: string;
  description: string;
  tone: Tone;
  statusLabel: string;
  hint: string;
  result: { label: string; tone: Tone } | null;
  tally: TallyOption[];
  /** Hay una votación que se puede abrir desde la gestión de la junta. */
  canStartVote: boolean;
  /** Ningún propietario está presente ni representado: no se puede abrir ninguna votación. */
  noParticipants: boolean;
  /** La votación ya se cerró: solo se puede consultar su resultado. */
  voteClosed: boolean;
  /** Hay una votación abierta que se puede cerrar desde la gestión de la junta (junta convocada). */
  canCloseVote: boolean;
  /** El punto lleva votación; si no, se puede dar por tratado a mano. */
  votable: boolean;
  /** Punto sin votación que aún se puede dar por tratado (junta convocada). */
  canMarkTreated: boolean;
  /** Punto sin votación ya tratado a mano al que aún se le puede quitar la marca (junta convocada). */
  canUnmarkTreated: boolean;
  /** Comentarios del administrador sobre el punto (salen en el acta); vacío si no hay. */
  comments: string;
  /** Se pueden escribir comentarios: junta no cancelada y acta sin firmar. */
  canComment: boolean;
}

function isVotable(item: AgendaItem): boolean {
  return (
    !!item.hasVote &&
    !!item.voteTemplate?.questions.some((question) => question.type !== 'text')
  );
}

const TALLY_TONES: Tone[] = ['green', 'red', 'muted'];

function tallyFor(item: AgendaItem, session: VoteSession | undefined): TallyOption[] {
  if (!session) return [];
  const tally = session.status === 'abierta' ? session.liveTally : session.resultSummary;
  const question = item.voteTemplate?.questions[session.questionIndex];
  if (!tally || !question?.options) return [];
  return question.options.map((label, index) => ({
    label,
    count: tally.optionTally.find((entry) => entry.optionIndex === index)?.propertyCount ?? 0,
    tone: TALLY_TONES[index] ?? 'muted',
  }));
}

export function agendaRows(data: MeetingData): AgendaRow[] {
  const celebrated = meetingHeld(data.meeting);
  const noParticipants =
    !data.attendance.length && !activeDelegations(data.delegations).length;
  return data.meeting.agenda.map((item, index) => {
    const sessions = data.voteSessions.filter(
      (session) => session.agendaItemId === item.id,
    );
    const open = sessions.find((session) => session.status === 'abierta');
    const closed = sessions.filter((session) => session.status === 'cerrada');
    const shown = open ?? closed[closed.length - 1];
    const votable = isVotable(item);
    const row: AgendaRow = {
      id: item.id,
      number: String(index + 1).padStart(2, '0'),
      title: item.title,
      description: item.description ?? '',
      tone: 'muted',
      statusLabel: 'Pendiente',
      hint: 'Aún no se ha tratado',
      result: null,
      tally: tallyFor(item, shown),
      canStartVote: votable && !open && !closed.length && data.meeting.status === 'convocada',
      noParticipants,
      voteClosed: !open && closed.length > 0,
      canCloseVote: !!open && data.meeting.status === 'convocada',
      votable,
      canMarkTreated: !votable && !item.treatedAt && data.meeting.status === 'convocada',
      canUnmarkTreated: !votable && !!item.treatedAt && data.meeting.status === 'convocada',
      comments: item.comments?.trim() ?? '',
      canComment: actaEditable(data.meeting),
    };
    if (open) {
      row.tone = 'yellow';
      row.statusLabel = 'En votación';
      row.hint = 'Votación en curso';
    } else if (closed.length) {
      row.tone = 'green';
      row.statusLabel = 'Completado';
      row.hint = 'Votación finalizada';
      const passed = closed[closed.length - 1].resultSummary?.passed;
      if (passed != null)
        row.result = passed
          ? { label: 'Aprobado', tone: 'green' }
          : { label: 'Rechazado', tone: 'red' };
    } else if (votable) {
      row.tone = 'yellow';
      row.statusLabel = 'Pendiente de votación';
      row.hint = celebrated ? 'Sin votación registrada' : 'Aún no se ha votado';
    } else if (item.treatedAt) {
      row.tone = 'green';
      row.statusLabel = 'Tratado';
      row.hint = 'Punto tratado';
    } else if (celebrated) {
      row.tone = 'green';
      row.statusLabel = 'Tratado';
      row.hint = 'Punto sin votación';
    }
    return row;
  });
}

// ── Detalle de un punto con votación ───────────────────────────────────────

export interface PointQuestion {
  questionIndex: number;
  title: string;
  options: string[];
  type: 'single_choice' | 'multiple_choice';
  /** Color elegido para cada respuesta (`''` = el de por defecto); `undefined` si no se eligió ninguno. */
  optionColors?: string[];
  /** Mayoría fijada al preparar la junta; `undefined` en juntas anteriores. */
  majorityType?: VoteMajorityType;
  /** Sesión abierta o, si no la hay, la última cerrada; `null` si todavía no se ha votado. */
  session: VoteSession | null;
}

/** Preguntas votables de un punto del orden del día, cada una con su sesión de voto. */
export function pointQuestions(item: AgendaItem, sessions: VoteSession[]): PointQuestion[] {
  const mine = sessions.filter((session) => session.agendaItemId === item.id);
  const questions = item.voteTemplate?.questions ?? [];
  const result: PointQuestion[] = [];
  questions.forEach((question, questionIndex) => {
    if (question.type === 'text') return;
    const ofQuestion = mine.filter((session) => session.questionIndex === questionIndex);
    result.push({
      questionIndex,
      title: question.title,
      options: question.options ?? [],
      type: question.type,
      optionColors: question.optionColors,
      majorityType: question.majorityType,
      session: ofQuestion.find((session) => session.status === 'abierta') ?? ofQuestion[ofQuestion.length - 1] ?? null,
    });
  });
  return result;
}

export type VoteState = 'voted' | 'pending' | 'absent';

export interface VoteRow {
  propertyId: string;
  unit: string;
  owner: string;
  initials: string;
  status: AttendanceStatus;
  statusLabel: string;
  /** Quien la representa, si la propiedad está representada. */
  representedBy: string | null;
  /** `voted`: ya votó; `pending`: está presente pero no ha votado; `absent`: no está en la junta. */
  state: VoteState;
  /** Opción(es) elegida(s); `null` si no ha votado. */
  choice: string | null;
  /** Color de la opción: a favor en verde, en contra en rojo y el resto (abstención…) en azul. */
  choiceTone: Tone;
  /** Quién emitió el voto (el titular o su representante). */
  voter: string | null;
  /** Gestora que lo registró en su nombre; `null` si votó el propio votante. */
  registeredBy: string | null;
  /** Índices de las opciones elegidas (para precargarlas al cambiar el voto). */
  selected: number[];
  castAt: string | null;
}

/** Por convención del producto, la opción 0 es «A favor» y la 1 «En contra»; el resto va en azul. */
const CHOICE_TONES: Tone[] = ['green', 'red'];

/** Color de una opción de voto; en selección múltiple no hay «a favor» ni «en contra»: todas en azul. */
export function choiceTone(index: number, type: 'single_choice' | 'multiple_choice' = 'single_choice'): Tone {
  return type === 'single_choice' ? (CHOICE_TONES[index] ?? 'blue') : 'blue';
}

/** Qué votó cada propiedad del censo en una sesión (mismo orden que la tabla de participación). */
export function voteRows(
  participation: ParticipationRow[],
  responses: VoteResponseEntry[],
  options: string[],
  type: 'single_choice' | 'multiple_choice' = 'single_choice',
): VoteRow[] {
  const byProperty = new Map(responses.map((response) => [response.propertyId, response]));
  return participation.map((row) => {
    const response = byProperty.get(row.propertyId);
    const selected = !response
      ? []
      : response.optionIndexes.length
        ? response.optionIndexes
        : response.optionIndex != null
          ? [response.optionIndex]
          : [];
    const picked = selected.map((index) => options[index] ?? `Opción ${index + 1}`);
    return {
      propertyId: row.propertyId,
      unit: row.unit,
      owner: row.owner,
      initials: row.initials,
      status: row.status,
      statusLabel: row.statusLabel,
      representedBy: row.representedBy,
      state: response ? 'voted' : row.status === 'ausente' ? 'absent' : 'pending',
      choice: response ? picked.join(', ') || '—' : null,
      choiceTone: selected.length === 1 ? choiceTone(selected[0], type) : 'blue',
      voter: response?.voterName ?? null,
      registeredBy: response?.registeredByName ?? null,
      selected,
      castAt: response?.castAt ?? null,
    };
  });
}

// ── Acta ───────────────────────────────────────────────────────────────────

export type ActaPhase = 'unavailable' | 'draft' | 'pending-signature' | 'signed';

export interface ActaStatus {
  phase: ActaPhase;
  tone: Tone;
  label: string;
  hint: string;
}

export function actaStatus(meeting: Meeting): ActaStatus {
  if (meeting.status === 'firmada' || meeting.actaSignedAt)
    return {
      phase: 'signed',
      tone: 'green',
      label: 'Acta firmada',
      hint: meeting.actaDistributedAt
        ? 'Enviada a los propietarios.'
        : 'Lista para descargar y enviar a los propietarios.',
    };
  if (meeting.status === 'celebrada')
    return {
      phase: 'pending-signature',
      tone: 'yellow',
      label: 'Pendiente de firma',
      hint: 'Faltan firmas para que el acta sea definitiva.',
    };
  if (meeting.status === 'cancelada')
    return {
      phase: 'unavailable',
      tone: 'muted',
      label: 'Sin acta',
      hint: 'La junta se canceló, no se generará acta.',
    };
  return {
    phase: 'draft',
    tone: 'blue',
    label: 'Borrador provisional',
    hint: 'Se actualiza con la asistencia y las votaciones de la junta.',
  };
}

export interface Signer {
  role: string;
  signed: boolean;
}

export function actaSigners(meeting: Meeting): Signer[] {
  return [
    { role: 'Presidente', signed: !!meeting.actaSignedByPresidenteUserId || !!meeting.actaSignedAt },
    { role: 'Secretario / Administrador', signed: !!meeting.actaSignedBySecretarioUserId || !!meeting.actaSignedAt },
  ];
}

// ── Fechas ─────────────────────────────────────────────────────────────────

const longDate = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortTime = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
});

export function formatLongDate(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? longDate.format(date) : '—';
}

export function formatTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? shortTime.format(date) : '—';
}

export function formatDateTime(iso: string | null | undefined): string {
  const date = iso ? formatLongDate(iso) : '—';
  return date === '—' ? date : `${date}, ${formatTime(iso)}`;
}

// ── Documentos adjuntos ────────────────────────────────────────────────────

export interface AttachmentKind {
  label: string;
  tone: 'pdf' | 'xls' | 'doc' | 'img' | 'file';
}

/** Tipo legible del adjunto: primero por MIME y, si falta (adjuntos antiguos), por la extensión. */
export function attachmentKind(attachment: Pick<MeetingAttachment, 'title' | 'mimeType'>): AttachmentKind {
  const mime = attachment.mimeType ?? '';
  const ext = /\.([a-z0-9]+)$/i.exec(attachment.title)?.[1]?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return { label: 'PDF', tone: 'pdf' };
  if (mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel' || ['xls', 'xlsx', 'csv'].includes(ext))
    return { label: 'Excel', tone: 'xls' };
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return { label: 'Word', tone: 'doc' };
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { label: 'Imagen', tone: 'img' };
  return { label: 'Archivo', tone: 'file' };
}

/** `245 KB`, `1,2 MB`; cadena vacía si no se conoce el tamaño. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${numberFormat.format(bytes / (1024 * 1024))} MB`;
}

const shortDateTime = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** `14 oct, 12:30`. */
export function formatShortDateTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? shortDateTime.format(date).replace(/\./g, '') : '—';
}

const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatShortDate(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? shortDate.format(date).replace(/\./g, '') : '—';
}
