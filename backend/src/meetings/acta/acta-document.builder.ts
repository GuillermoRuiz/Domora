import {
  ACTA_DOCUMENT_SCHEMA_VERSION,
  type ActaAgreement,
  type ActaAttendanceRow,
  type ActaDocumentModel,
  type ActaItem,
  type ActaSource,
  type ActaTextBlock,
  type ActaVoteBlock,
} from './acta-document.model';
import { actaDayKey, capitalize, formatActaDate, formatActaPercent, formatActaTime } from './acta-format';
import type { ActaMajorityType, ActaSnapshotAgendaItem, ActaSnapshotVote, ActaSourceSnapshot } from './acta-snapshot.types';

const MAJORITY_LABEL: Record<ActaMajorityType, string> = {
  unanimidad: 'Unanimidad',
  tresQuintos: 'Tres quintas partes',
  mayoriaSimple: 'Mayoría simple',
};

/** Frases fijas del documento. Nada de esto lo decide una IA. */
export const ACTA_PHRASES = {
  approved: 'La propuesta resulta aprobada.',
  rejected: 'La propuesta resulta rechazada.',
  agreement: 'Se aprueba la propuesta sometida a votación.',
  treatedWithoutContent: 'El punto quedó tratado sin contenido adicional registrado.',
  notTreated: 'Este punto no consta como tratado en la reunión.',
  noVoteRecorded: 'No consta votación registrada sobre este punto.',
} as const;

/** Redacción de un bloque: lo que entra en el documento y de dónde viene. */
export interface ActaDraftedText {
  text: string;
  origin: 'generated' | 'notes';
}

/**
 * Textos que no salen de los datos de la junta: la redacción de las notas de la gestora y el
 * párrafo previo opcional. Todo lo demás lo construye el builder, solo con el snapshot.
 */
export interface ActaTexts {
  introduction?: string;
  /** Redacción de las notas de cada punto, por id de punto. Un punto sin entrada no tiene desarrollo. */
  items: Record<string, ActaDraftedText | undefined>;
  observations: ActaDraftedText | null;
}

function cleanLines(text: string | null | undefined): string {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function block(text: string, origin: ActaTextBlock['origin'], source: ActaSource): ActaTextBlock {
  return { text, origin, source };
}

const BASIS_TEXT = { censo: 'sobre el total de propiedades de la comunidad', presentes: 'sobre las propiedades presentes' } as const;

function voteBlock(vote: ActaSnapshotVote, item: ActaSnapshotAgendaItem): ActaVoteBlock {
  const outcome = vote.passed === true ? 'approved' : vote.passed === false ? 'rejected' : null;
  const outcomeText = outcome === 'approved' ? ACTA_PHRASES.approved : outcome === 'rejected' ? ACTA_PHRASES.rejected : null;
  const question = vote.question.title.trim();
  const owners = vote.ownersFavorablePct == null ? null : formatActaPercent(vote.ownersFavorablePct);
  const quota = vote.quotaFavorablePct == null ? null : formatActaPercent(vote.quotaFavorablePct);
  const basis = vote.denominatorBasis ? ` (${BASIS_TEXT[vote.denominatorBasis]})` : '';
  const majority = { type: vote.majorityType, label: MAJORITY_LABEL[vote.majorityType] };
  return {
    voteSessionId: vote.voteSessionId,
    question,
    // Las opciones son las configuradas, con su texto literal: ningún índice significa «en contra» por sí solo.
    options: vote.options.map((option) => ({ label: option.label, count: option.count })),
    totalResponses: vote.totalResponses,
    majority,
    favorable: { owners, quota, basis: vote.denominatorBasis },
    outcome,
    outcomeText,
    lines: {
      question: question ? `Propuesta sometida a votación: «${question}»` : null,
      options: vote.options.map((option) => `${option.label}: ${option.count}`),
      majority: `Mayoría aplicada: ${majority.label}.`,
      favorable: owners && quota ? `A favor: ${owners} de las propiedades y ${quota} del coeficiente${basis}.` : null,
      outcome: outcomeText,
    },
    source: {
      agendaItemId: item.id,
      voteSessionIds: [vote.voteSessionId],
      fields: ['voteSession.question', 'voteSession.optionTally', 'voteSession.majorityType', 'voteSession.resultSummary'],
    },
  };
}

function itemOf(item: ActaSnapshotAgendaItem, snapshot: ActaSourceSnapshot, texts: ActaTexts): ActaItem {
  const votes = snapshot.votes
    .filter((vote) => vote.agendaItemId === item.id)
    .sort((a, b) => a.questionIndex - b.questionIndex);
  const hasComments = !!cleanLines(item.comments);
  const voted = votes.length > 0;
  const treated = voted || hasComments || !!item.treatedAt;
  const state: ActaItem['state'] = voted ? 'voted' : treated ? 'treated' : 'not-treated';

  let stateText: string | null = null;
  if (!voted) {
    if (!treated) stateText = ACTA_PHRASES.notTreated;
    else if (hasComments) stateText = item.hasVote ? ACTA_PHRASES.noVoteRecorded : null;
    else stateText = ACTA_PHRASES.treatedWithoutContent;
  }

  const drafted = hasComments ? texts.items[item.id] : undefined;
  const itemSource: ActaSource = {
    agendaItemId: item.id,
    voteSessionIds: votes.map((vote) => vote.voteSessionId),
    fields: ['agenda.title', 'agenda.description', 'agenda.comments', 'agenda.treatedAt', ...(voted ? ['voteSession.resultSummary'] : [])],
  };
  const agreements: ActaAgreement[] = votes
    .filter((vote) => vote.passed === true)
    .map((vote) => ({
      id: `agreement-${vote.voteSessionId}`,
      itemId: item.id,
      text: ACTA_PHRASES.agreement,
      line: `ACUERDO: ${ACTA_PHRASES.agreement}`,
      source: { agendaItemId: item.id, voteSessionIds: [vote.voteSessionId], fields: ['voteSession.passed', 'voteSession.resultSummary'] },
    }));

  return {
    id: item.id,
    order: item.order,
    label: `${item.order}º`,
    title: item.title,
    headingText: `${item.order}º  ${item.title.toUpperCase()}`,
    description: item.description?.trim() || null,
    state,
    stateText,
    narrative: block(drafted?.text ?? '', drafted?.origin ?? 'notes', {
      agendaItemId: item.id,
      fields: ['agenda.comments'],
    }),
    votes: votes.map((vote) => voteBlock(vote, item)),
    agreements,
    source: itemSource,
  };
}

function constitutionParagraph(snapshot: ActaSourceSnapshot, missing: string[]): { paragraph: string; dateLabel: string | null; startTime: string | null } {
  const { meeting, community } = snapshot;
  const startTime = formatActaTime(meeting.actualStartAt);
  if (!meeting.actualStartAt) missing.push('actualStartAt');
  // Sin hora real de inicio se usa solo el día de la convocatoria, sin hora.
  const dateLabel = formatActaDate(meeting.actualStartAt ?? meeting.scheduledAt1);
  const when = startTime ? `siendo las ${startTime} horas del día ${dateLabel}` : `el día ${dateLabel}`;
  const place = community.locality ? `En ${community.locality}, ` : '';
  const where = meeting.location ? ` en ${meeting.location},` : '';
  const kind = meeting.type === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria';
  const address = community.address ? `, sita en ${community.address}` : '';
  const sentence =
    `${place}${when}, se reúnen${where} en ${meeting.effectiveConvocation} convocatoria, ` +
    `los propietarios presentes o representados de la comunidad de propietarios ${community.name}${address}, ` +
    `al objeto de celebrar la Junta General ${kind} conforme al siguiente orden del día.`;
  return { paragraph: capitalize(sentence), dateLabel, startTime };
}

function closingParagraph(snapshot: ActaSourceSnapshot, missing: string[]): string | null {
  const { meeting } = snapshot;
  const endTime = formatActaTime(meeting.actualEndAt);
  if (!endTime) {
    missing.push('actualEndAt');
    return null;
  }
  const sameDay = actaDayKey(meeting.actualEndAt) === actaDayKey(meeting.actualStartAt ?? meeting.scheduledAt1);
  const day = sameDay ? '' : ` del día ${formatActaDate(meeting.actualEndAt)}`;
  return `Y no habiendo más asuntos que tratar, se levanta la sesión a las ${endTime} horas${day}.`;
}

/**
 * ÚNICA fuente del contenido del acta. Función pura: mismo snapshot y mismos textos, mismo
 * documento. No consulta la base de datos, ni la hora actual, ni a una IA.
 */
export function buildActaDocument(snapshot: ActaSourceSnapshot, texts: ActaTexts): ActaDocumentModel {
  const missing: string[] = [];
  const { meeting, community } = snapshot;
  const isOrdinary = meeting.type === 'ordinaria';

  const constitution = constitutionParagraph(snapshot, missing);
  const items = snapshot.agenda.map((item) => itemOf(item, snapshot, texts));

  const rows: ActaAttendanceRow[] = snapshot.attendance.map((row) => ({
    ref: row.ref,
    attendee: row.attendeeName?.trim() || '—',
    attendeeDni: row.attendeeDni?.trim() || '—',
    quota: row.participationQuota == null ? '—' : formatActaPercent(row.participationQuota),
    status: row.status === 'representada' ? 'Representada' : 'Presente',
  }));
  const representedCount = snapshot.attendance.filter((row) => row.status === 'representada').length;
  if (snapshot.census.missingQuotaCount > 0) {
    missing.push(`participationQuota (${snapshot.census.missingQuotaCount} propiedad(es) sin coeficiente)`);
  }
  const { owners, quota } = snapshot.quorum;

  const generalText = texts.observations?.text ?? '';
  const nextStepsText = cleanLines(snapshot.text.nextSteps);

  return {
    schemaVersion: ACTA_DOCUMENT_SCHEMA_VERSION,
    header: {
      title: `ACTA DE LA JUNTA GENERAL ${isOrdinary ? 'ORDINARIA' : 'EXTRAORDINARIA'}`,
      subtitle: 'DE LA COMUNIDAD DE PROPIETARIOS',
      communityName: community.name,
      address: [community.address, community.locality].filter(Boolean).join(', ') || null,
      meetingType: meeting.type,
      source: { fields: ['meeting.type', 'community.name', 'community.address'] },
    },
    constitution: {
      paragraph: constitution.paragraph,
      introduction: block(texts.introduction?.trim() ?? '', texts.introduction?.trim() ? 'edited' : 'notes', { fields: ['editor.introduction'] }),
      facts: {
        dateLabel: constitution.dateLabel,
        startTime: constitution.startTime,
        convocation: meeting.effectiveConvocation,
        location: meeting.location,
        locality: community.locality,
      },
      source: {
        fields: ['meeting.actualStartAt', 'meeting.scheduledAt1', 'meeting.effectiveConvocation', 'meeting.location', 'community.locality', 'community.name'],
      },
    },
    labels: {
      agenda: 'ORDEN DEL DÍA',
      attendance: 'ASISTENCIA',
      development: 'DESARROLLO',
      attendanceColumns: ['PROPIEDAD', 'ASISTENTE', 'DNI', 'COEFICIENTE', 'ASISTENCIA'],
    },
    agenda: snapshot.agenda.map((item) => ({
      order: item.order,
      label: `${item.order}º`,
      title: item.title,
      line: `${item.order}º  ${item.title}`,
      source: { agendaItemId: item.id, fields: ['agenda.title'] },
    })),
    attendance: {
      summary: {
        presentCount: owners.present,
        totalCount: owners.total,
        representedCount,
        propertiesPercent: formatActaPercent(owners.percent),
        quotaPercent: formatActaPercent(quota.percent),
        sentence:
          `Asisten, presentes o representadas, ${owners.present} de ${owners.total} propiedades ` +
          `(${formatActaPercent(owners.percent)} de las propiedades), que representan el ` +
          `${formatActaPercent(quota.percent)} del coeficiente de participación.`,
      },
      rows,
      source: { fields: ['attendance.ref', 'attendance.attendeeName', 'attendance.attendeeDni', 'attendance.participationQuota', 'attendance.status', 'quorum'] },
    },
    items,
    agreements: items.flatMap((item) => item.agreements),
    observations: {
      ...block(generalText, texts.observations?.origin ?? 'notes', { fields: ['text.generalComments'] }),
      title: 'OBSERVACIONES',
    },
    nextSteps: {
      ...block(nextStepsText, 'notes', { fields: ['text.nextSteps'] }),
      title: 'ACTUACIONES DERIVADAS DE LOS ACUERDOS',
    },
    closing: { paragraph: closingParagraph(snapshot, missing), source: { fields: ['meeting.actualEndAt'] } },
    signatures: {
      blocks: [
        { role: 'presidente', lines: ['Vº Bº', 'EL/LA PRESIDENTE/A'] },
        { role: 'secretario', lines: ['EL/LA SECRETARIO/A-ADMINISTRADOR/A'] },
      ],
    },
    missing,
  };
}
