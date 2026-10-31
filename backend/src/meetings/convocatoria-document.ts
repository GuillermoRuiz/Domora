/**
 * Documento de la convocatoria de una junta (art. 16.2 LPH): el texto que la gestora revisa y edita en el
 * tercer paso del alta y que se guarda en `Meeting.convocatoriaDoc`. Cada bloque es texto ya resuelto
 * (nada de plantillas por rellenar): lo que se ve al editar es exactamente lo que sale en el `.docx`.
 *
 * Las juntas sin documento guardado (las anteriores, o las editadas después de convocarse) se generan con
 * `buildDefaultConvocatoria`, que redacta el mismo documento a partir de los datos de la junta.
 */
export interface ConvocatoriaAgendaLine {
  /** Número del punto tal y como se imprime (`01`, `02`…). */
  number: string;
  text: string;
}

export interface ConvocatoriaDocument {
  header: {
    /** Comunidad de propietarios (nombre de la finca). */
    community: string;
    /** `Convocatoria Junta General Ordinaria` / `Extraordinaria`. */
    title: string;
  };
  /** Aviso en cursiva bajo la cabecera (p. ej. quién recibe la convocatoria por correo). */
  notice: string;
  /** `en Madrid a 9 de septiembre de 2026`. */
  issuedLine: string;
  /** `Sr./a. Propietario/a:`. */
  greeting: string;
  /** Párrafo de convocatoria con fecha, horas y lugar. */
  intro: string;
  agenda: ConvocatoriaAgendaLine[];
  closing: string;
  /** Líneas de la firma (cargo, nombre, nº de colegiado…). */
  signature: string[];
  /** Autorización para delegar el voto, a recortar al pie de la convocatoria. */
  authorization: { enabled: boolean; text: string };
}

export type ConvocatoriaMeetingType = 'ordinaria' | 'extraordinaria';
export type ConvocatoriaConvokedBy =
  'presidente' | 'cuotas25' | 'propietarios25' | 'mandatoJudicial';
export type ConvocatoriaSignerRole =
  'administrador' | 'presidente' | 'secretario';

export interface ConvocatoriaInput {
  communityName: string;
  /** Localidad para «en Madrid a…». */
  communityLocation?: string | null;
  type: ConvocatoriaMeetingType;
  convokedBy: ConvocatoriaConvokedBy;
  scheduledAt1: Date;
  scheduledAt2: Date;
  /** Lugar de celebración. */
  location?: string | null;
  agenda: unknown;
  signerRole: ConvocatoriaSignerRole;
  signerName?: string | null;
  /** Fecha de emisión de la convocatoria. */
  issuedAt: Date;
}

const TIME_ZONE = 'Europe/Madrid';

const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});
const TIME_FORMAT = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
});
const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
});

/** `14 de septiembre de 2026`, en hora de Madrid. */
export function formatConvocatoriaDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

/** `19:00`, en hora de Madrid. */
export function formatConvocatoriaTime(date: Date): string {
  return TIME_FORMAT.format(date);
}

const OPENING: Record<ConvocatoriaConvokedBy, string> = {
  presidente:
    'Siguiendo instrucciones del Sr. Presidente de la Comunidad y de conformidad con lo dispuesto en el artículo 16.2 de la vigente Ley de Propiedad Horizontal',
  cuotas25:
    'A petición de propietarios que representan al menos el 25 % de las cuotas de participación y de conformidad con lo dispuesto en el artículo 16.2 de la vigente Ley de Propiedad Horizontal',
  propietarios25:
    'A petición de la cuarta parte de los propietarios y de conformidad con lo dispuesto en el artículo 16.2 de la vigente Ley de Propiedad Horizontal',
  mandatoJudicial:
    'Por mandato judicial y de conformidad con lo dispuesto en el artículo 16.2 de la vigente Ley de Propiedad Horizontal',
};

const SIGNER_LABEL: Record<ConvocatoriaSignerRole, string> = {
  administrador: 'El administrador',
  presidente: 'El presidente',
  secretario: 'El secretario',
};

export const DEFAULT_NOTICE =
  'Los propietarios que hayan facilitado su dirección de correo electrónico a la Administración recibirán la convocatoria por dicha vía.';

export const DEFAULT_CLOSING =
  'Dada la importancia de los temas a tratar, rogamos su asistencia a esta Junta y, en el caso de no serle posible, le agradeceremos haga uso de la autorización que a este fin se une a la presente convocatoria.';

function agendaLines(agenda: unknown): ConvocatoriaAgendaLine[] {
  if (!Array.isArray(agenda)) return [];
  const titles = agenda
    .map((item) =>
      typeof (item as { title?: unknown })?.title === 'string'
        ? (item as { title: string }).title.trim()
        : '',
    )
    .filter((title) => title.length > 0);
  return titles.map((text, index) => ({
    number: String(index + 1).padStart(2, '0'),
    text,
  }));
}

/** Redacta la convocatoria con el texto habitual, a partir de los datos de la junta. */
export function buildDefaultConvocatoria(
  input: ConvocatoriaInput,
): ConvocatoriaDocument {
  const typeLabel = input.type === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria';
  const day1 = formatConvocatoriaDate(input.scheduledAt1);
  const sameDay =
    DAY_KEY_FORMAT.format(input.scheduledAt1) ===
    DAY_KEY_FORMAT.format(input.scheduledAt2);
  const second = `${formatConvocatoriaTime(input.scheduledAt2)} horas en segunda${sameDay ? '' : ` del día ${formatConvocatoriaDate(input.scheduledAt2)}`}`;
  const place = input.location?.trim();
  const intro =
    `${OPENING[input.convokedBy]}, por la presente se le convoca para que asista a la Junta General ${typeLabel} ` +
    `que se celebrará el próximo día ${day1} a las ${formatConvocatoriaTime(input.scheduledAt1)} horas en primera convocatoria, ` +
    `o de no concurrir el quórum necesario, a las ${second}${place ? `, en ${place}` : ''}, con el fin de tratar el siguiente:`;

  const issued = formatConvocatoriaDate(input.issuedAt);
  const town = input.communityLocation?.trim();
  const signerName = input.signerName?.trim();

  return {
    header: {
      community: input.communityName,
      title: `Convocatoria Junta General ${typeLabel}`,
    },
    notice: DEFAULT_NOTICE,
    issuedLine: town ? `en ${town} a ${issued}` : `a ${issued}`,
    greeting: 'Sr./a. Propietario/a:',
    intro,
    agenda: agendaLines(input.agenda),
    closing: DEFAULT_CLOSING,
    signature: [
      SIGNER_LABEL[input.signerRole],
      ...(signerName ? [signerName] : []),
    ],
    authorization: {
      enabled: true,
      text:
        `Sr. Presidente de la Comunidad de Propietarios ${input.communityName}\n\n` +
        'Muy Sr. mío:\n\n' +
        `Ante la imposibilidad de asistir a la Junta convocada por Vd., para el próximo ${day1} le participo haber otorgado mi representación ` +
        'para tal acto y a todos los efectos, al portador/a de la presente',
    },
  };
}

/** El JSON guardado tiene la forma que `render` necesita (un valor a medias no debe tumbar la descarga). */
export function isConvocatoriaDocument(
  value: unknown,
): value is ConvocatoriaDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  const header = doc['header'] as Record<string, unknown> | null | undefined;
  const authorization = doc['authorization'] as
    Record<string, unknown> | null | undefined;
  return (
    typeof header?.['community'] === 'string' &&
    typeof header?.['title'] === 'string' &&
    ['notice', 'issuedLine', 'greeting', 'intro', 'closing'].every(
      (key) => typeof doc[key] === 'string',
    ) &&
    Array.isArray(doc['agenda']) &&
    (doc['agenda'] as unknown[]).every(
      (line) =>
        typeof (line as Record<string, unknown> | null)?.['number'] ===
          'string' &&
        typeof (line as Record<string, unknown>)['text'] === 'string',
    ) &&
    Array.isArray(doc['signature']) &&
    (doc['signature'] as unknown[]).every((line) => typeof line === 'string') &&
    typeof authorization?.['enabled'] === 'boolean' &&
    typeof authorization?.['text'] === 'string'
  );
}
