/**
 * Validación previa a preparar el acta. Distingue:
 *  - ERROR: impide continuar (falta un dato que Domora no puede inventar, o el estado no lo permite).
 *  - WARNING: requiere atención pero no bloquea.
 * No introduce requisitos legales: solo comprueba que haya datos suficientes y coherentes.
 */
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
  /** Lo que la gestora ya confirmó. */
  confirmed: {
    actualStartAt: string | null;
    actualEndAt: string | null;
    effectiveConvocation: 'primera' | 'segunda' | null;
  };
  /** Referencias para ayudar a rellenar el formulario; ninguna se aplica sola. */
  reference: { scheduledAt1: string; scheduledAt2: string; celebratedAt: string | null };
  /** Hay una versión de documento preparada para mostrar (borrador o lista para firma). */
  hasVersion: boolean;
}

export interface ActaValidationInput {
  meeting: {
    status: string;
    scheduledAt1: Date;
    scheduledAt2: Date;
    celebratedAt: Date | null;
    actualStartAt: Date | null;
    actualEndAt: Date | null;
    effectiveConvocation: 'primera' | 'segunda' | null;
    location: string | null;
    agenda: unknown;
  };
  openVoteSessions: number;
  closedVoteSessions: { agendaItemId: string; questionIndex: number }[];
  censusCount: number;
  missingQuotaCount: number;
  presentCount: number;
  hasVersion: boolean;
}

interface AgendaShape {
  id?: string;
  title?: string;
  hasVote?: boolean;
  comments?: string;
  treatedAt?: string;
  voteTemplate?: { questions?: { type?: string }[] };
}

export function validateActaPreparation(input: ActaValidationInput): ActaValidation {
  const { meeting } = input;
  const errors: ActaValidationIssue[] = [];
  const warnings: ActaValidationIssue[] = [];
  const missingFields: ActaMissingField[] = [];

  if (meeting.status === 'cancelada') {
    errors.push({ code: 'MEETING_CANCELLED', message: 'La junta está cancelada: no tiene acta.' });
  } else if (meeting.status === 'convocada') {
    errors.push({ code: 'MEETING_NOT_HELD', message: 'La junta aún no está celebrada: márcala como celebrada para preparar el acta.' });
  } else if (meeting.status === 'firmada') {
    errors.push({ code: 'ALREADY_SIGNED', message: 'El acta ya está firmada: no se puede generar de nuevo.' });
  }

  if (!meeting.effectiveConvocation) {
    missingFields.push('effectiveConvocation');
    errors.push({ code: 'MISSING_EFFECTIVE_CONVOCATION', field: 'effectiveConvocation', message: 'Falta indicar en qué convocatoria se constituyó la junta.' });
  }
  if (!meeting.actualStartAt) {
    missingFields.push('actualStartAt');
    errors.push({ code: 'MISSING_ACTUAL_START', field: 'actualStartAt', message: 'Falta la hora real de inicio de la reunión.' });
  }
  if (!meeting.actualEndAt) {
    missingFields.push('actualEndAt');
    errors.push({ code: 'MISSING_ACTUAL_END', field: 'actualEndAt', message: 'Falta confirmar la hora real de fin de la reunión.' });
  }
  if (meeting.actualStartAt && meeting.actualEndAt && meeting.actualEndAt.getTime() <= meeting.actualStartAt.getTime()) {
    errors.push({ code: 'TIME_ORDER', field: 'actualEndAt', message: 'La hora de fin debe ser posterior a la hora de inicio.' });
  }

  if (input.openVoteSessions > 0) {
    errors.push({
      code: 'VOTES_OPEN',
      message: `Hay ${input.openVoteSessions} votación(es) abierta(s): ciérralas antes de preparar el acta.`,
    });
  }
  if (input.censusCount === 0) {
    errors.push({ code: 'NO_CENSUS', message: 'La finca no tiene propiedades en el censo: no se puede reproducir la asistencia.' });
  }

  // ── Avisos ──
  const agenda = (Array.isArray(meeting.agenda) ? (meeting.agenda as AgendaShape[]) : []).filter((item) => item && typeof item.id === 'string');
  if (agenda.length === 0) {
    warnings.push({ code: 'AGENDA_EMPTY', message: 'La junta no tiene puntos en el orden del día.' });
  }
  const closedFor = new Set(input.closedVoteSessions.map((session) => session.agendaItemId));
  const notTreated = agenda.filter((item) => !closedFor.has(item.id as string) && !item.comments?.trim() && !item.treatedAt);
  if (notTreated.length > 0) {
    warnings.push({
      code: 'ITEMS_NOT_TREATED',
      message: `${notTreated.length} punto(s) no constan como tratados y así figurarán en el acta: ${notTreated.map((item) => `«${item.title ?? item.id}»`).join(', ')}.`,
    });
  }
  const orphan = input.closedVoteSessions.filter((session) => {
    const item = agenda.find((entry) => entry.id === session.agendaItemId);
    const question = item?.voteTemplate?.questions?.[session.questionIndex];
    return !item || !question || question.type === 'text';
  });
  if (orphan.length > 0) {
    warnings.push({
      code: 'VOTE_WITHOUT_AGENDA_ITEM',
      message: `${orphan.length} votación(es) cerrada(s) ya no corresponden a un punto del orden del día y se omitirán del acta.`,
    });
  }
  if (input.censusCount > 0 && input.presentCount === 0) {
    warnings.push({ code: 'NO_ATTENDANCE', message: 'No hay propiedades presentes ni representadas registradas.' });
  }
  if (input.missingQuotaCount > 0) {
    warnings.push({
      code: 'MISSING_QUOTA',
      message: `${input.missingQuotaCount} propiedad(es) no tienen coeficiente de participación: no cuentan en los porcentajes y figurarán sin coeficiente.`,
    });
  }
  if (!meeting.location?.trim()) {
    warnings.push({ code: 'NO_LOCATION', message: 'La junta no tiene lugar indicado: se omitirá de la constitución de la junta.' });
  }
  if (meeting.actualStartAt && meeting.actualStartAt.getTime() < meeting.scheduledAt1.getTime()) {
    warnings.push({ code: 'START_BEFORE_FIRST_CALL', message: 'La hora de inicio es anterior a la primera convocatoria.' });
  }

  const canGenerate = errors.length === 0;
  return {
    canGenerate,
    canPrepareForSignature: canGenerate && input.hasVersion,
    errors,
    warnings,
    missingFields,
    confirmed: {
      actualStartAt: meeting.actualStartAt?.toISOString() ?? null,
      actualEndAt: meeting.actualEndAt?.toISOString() ?? null,
      effectiveConvocation: meeting.effectiveConvocation,
    },
    reference: {
      scheduledAt1: meeting.scheduledAt1.toISOString(),
      scheduledAt2: meeting.scheduledAt2.toISOString(),
      celebratedAt: meeting.celebratedAt?.toISOString() ?? null,
    },
    hasVersion: input.hasVersion,
  };
}
