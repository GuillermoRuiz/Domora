import type { ActaDocumentModel, ActaItem, ActaVoteBlock } from '../../../../core/acta.models';

/**
 * Del modelo del acta a bloques de maquetación y de bloques a páginas A4.
 *
 * No calcula contenido: solo ordena lo que ya dice el `ActaDocumentModel` en bloques que se
 * pueden medir y repartir en páginas. Los textos, las cifras y los resultados salen siempre del
 * modelo.
 */

/** Qué texto editable es (los demás elementos del documento son factuales y no se editan). */
export type ActaEditKey =
  | { kind: 'introduction' }
  | { kind: 'observations' }
  | { kind: 'nextSteps' }
  | { kind: 'item'; id: string };

export type ActaBlockKind =
  | 'title'
  | 'subtitle'
  | 'community'
  | 'address'
  | 'rule'
  | 'paragraph'
  | 'heading'
  | 'agendaLine'
  | 'tableHeader'
  | 'tableRow'
  | 'itemTitle'
  | 'italic'
  | 'bullet'
  | 'vote'
  | 'agreement'
  | 'signatures'
  | 'placeholder';

export interface ActaBlock {
  key: string;
  kind: ActaBlockKind;
  text?: string;
  /** Fila de tabla (propiedad, coeficiente, asistencia). */
  cells?: string[];
  vote?: ActaVoteBlock;
  signatures?: { role: string; lines: string[] }[];
  /** No se separa del bloque siguiente (un título no se queda solo al final de una página). */
  keepWithNext?: boolean;
  /** Texto editable al que pertenece el bloque. `first` es el que lleva el botón de edición. */
  edit?: { key: ActaEditKey; first: boolean };
}

export function editKeyId(key: ActaEditKey): string {
  return key.kind === 'item' ? `item:${key.id}` : key.kind;
}

export function sameEditKey(a: ActaEditKey | null, b: ActaEditKey | null): boolean {
  return !!a && !!b && editKeyId(a) === editKeyId(b);
}

const PLACEHOLDER: Record<ActaEditKey['kind'], string> = {
  introduction: 'Añadir un párrafo inicial (opcional)',
  observations: 'Añadir observaciones',
  nextSteps: 'Añadir actuaciones derivadas de los acuerdos',
  item: 'Añadir desarrollo del punto',
};

/** Párrafos de un texto editable: una línea de texto = un párrafo. */
function paragraphsOf(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0);
}

/**
 * Bloques del documento, en el mismo orden que el PDF. Con `editable`, los textos redactables
 * vacíos muestran un hueco para escribirlos (solo en pantalla: no forma parte del documento).
 */
export function layoutBlocks(model: ActaDocumentModel, editable: boolean): ActaBlock[] {
  const blocks: ActaBlock[] = [];
  const push = (block: ActaBlock) => blocks.push(block);

  const editable_ = (key: ActaEditKey, text: string, kind: ActaBlockKind, keyPrefix: string) => {
    const paragraphs = paragraphsOf(text);
    paragraphs.forEach((paragraph, index) =>
      push({ key: `${keyPrefix}-${index}`, kind, text: paragraph, edit: editable ? { key, first: index === 0 } : undefined }),
    );
    if (paragraphs.length === 0 && editable) {
      push({ key: `${keyPrefix}-empty`, kind: 'placeholder', text: PLACEHOLDER[key.kind], edit: { key, first: true } });
    }
  };

  // ── Encabezado ──
  push({ key: 'title', kind: 'title', text: model.header.title });
  push({ key: 'subtitle', kind: 'subtitle', text: model.header.subtitle });
  push({ key: 'community', kind: 'community', text: model.header.communityName.toUpperCase() });
  if (model.header.address) push({ key: 'address', kind: 'address', text: model.header.address });
  push({ key: 'rule', kind: 'rule' });

  // ── Constitución ──
  editable_({ kind: 'introduction' }, model.constitution.introduction.text, 'paragraph', 'intro');
  push({ key: 'constitution', kind: 'paragraph', text: model.constitution.paragraph });

  // ── Orden del día ──
  push({ key: 'h-agenda', kind: 'heading', text: model.labels.agenda, keepWithNext: true });
  for (const entry of model.agenda) push({ key: `agenda-${entry.order}`, kind: 'agendaLine', text: entry.line });
  if (model.agenda.length === 0) push({ key: 'agenda-none', kind: 'italic', text: 'No constan puntos en el orden del día.' });

  // ── Asistencia ──
  push({ key: 'h-attendance', kind: 'heading', text: model.labels.attendance, keepWithNext: true });
  push({ key: 'attendance-sentence', kind: 'paragraph', text: model.attendance.summary.sentence, keepWithNext: model.attendance.rows.length > 0 });
  if (model.attendance.rows.length > 0) {
    // El DNI consta en el documento (PDF y .docx) pero nunca se muestra en la pantalla de revisión.
    const columnLabels = model.labels.attendanceColumns.filter((label) => !/^dni$/i.test(label.trim()));
    push({ key: 'table-header', kind: 'tableHeader', cells: columnLabels, keepWithNext: true });
    // Las actas anteriores llevan menos columnas (sin asistente) y se siguen viendo como se generaron.
    const columns = columnLabels.length;
    model.attendance.rows.forEach((row, index) =>
      push({
        key: `row-${index}`,
        kind: 'tableRow',
        cells: columns >= 4 ? [row.ref, row.attendee ?? '—', row.quota, row.status] : [row.ref, row.quota, row.status],
      }),
    );
  } else {
    push({ key: 'attendance-none', kind: 'italic', text: 'No constan propiedades presentes ni representadas.' });
  }

  // ── Desarrollo ──
  push({ key: 'h-development', kind: 'heading', text: model.labels.development, keepWithNext: true });
  for (const item of model.items) itemBlocks(item, editable_, push);

  // ── Observaciones y actuaciones ──
  if (model.observations.text || editable) {
    if (model.observations.text) push({ key: 'h-observations', kind: 'heading', text: model.observations.title, keepWithNext: true });
    editable_({ kind: 'observations' }, model.observations.text, 'paragraph', 'observations');
  }
  if (model.nextSteps.text || editable) {
    if (model.nextSteps.text) push({ key: 'h-next', kind: 'heading', text: model.nextSteps.title, keepWithNext: true });
    editable_({ kind: 'nextSteps' }, model.nextSteps.text, 'bullet', 'next');
  }

  // ── Cierre y firmas ──
  if (model.closing.paragraph) push({ key: 'closing', kind: 'paragraph', text: model.closing.paragraph });
  push({ key: 'signatures', kind: 'signatures', signatures: model.signatures.blocks });
  return blocks;
}

function itemBlocks(
  item: ActaItem,
  editableBlocks: (key: ActaEditKey, text: string, kind: ActaBlockKind, keyPrefix: string) => void,
  push: (block: ActaBlock) => void,
): void {
  push({ key: `item-${item.id}`, kind: 'itemTitle', text: item.headingText, keepWithNext: true });
  editableBlocks({ kind: 'item', id: item.id }, item.narrative.text, 'paragraph', `narrative-${item.id}`);
  if (item.stateText) push({ key: `state-${item.id}`, kind: 'italic', text: item.stateText });
  for (const vote of item.votes) push({ key: `vote-${vote.voteSessionId}`, kind: 'vote', vote });
  for (const agreement of item.agreements) push({ key: agreement.id, kind: 'agreement', text: agreement.line });
}

/** Marca de «cabecera de tabla repetida» en una página. */
export const REPEATED_TABLE_HEADER = -1;

/**
 * Reparte bloques en páginas según su altura medida. Reglas:
 *  - un bloque no se parte: si no cabe, pasa a la página siguiente;
 *  - un bloque con `keepWithNext` viaja con lo que le sigue (un título no se queda solo);
 *  - la cabecera de la tabla de asistencia se repite al empezar una página con filas;
 *  - un bloque más alto que una página ocupa una página para él solo.
 * Devuelve, por página, los índices de los bloques (o `REPEATED_TABLE_HEADER`).
 */
export function paginate(blocks: ActaBlock[], heights: number[], pageInner: number): number[][] {
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  const headerIndex = blocks.findIndex((block) => block.kind === 'tableHeader');
  const headerHeight = headerIndex >= 0 ? (heights[headerIndex] ?? 0) : 0;

  const startPage = () => {
    if (page.length > 0) pages.push(page);
    page = [];
    used = 0;
  };

  for (let i = 0; i < blocks.length; i++) {
    // Cadena de bloques que no se pueden separar: los `keepWithNext` consecutivos y el que cierra la cadena.
    let end = i;
    while (blocks[end]?.keepWithNext && end + 1 < blocks.length) end++;
    const chain = Array.from({ length: end - i + 1 }, (_, offset) => i + offset);
    const needed = chain.reduce((sum, index) => sum + (heights[index] ?? 0), 0);

    if (used > 0 && used + needed > pageInner) startPage();
    // Una página que continúa la tabla de asistencia repite su cabecera.
    if (page.length === 0 && blocks[i].kind === 'tableRow' && pages.length > 0 && headerIndex >= 0) {
      page.push(REPEATED_TABLE_HEADER);
      used += headerHeight;
    }
    for (const index of chain) {
      page.push(index);
      used += heights[index] ?? 0;
    }
    i = end;
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

/** Media página A4 a 96 dpi: 794 × 1123 px. */
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;
export const PAGE_PADDING = { top: 76, bottom: 84, side: 76 };
export const PAGE_INNER_HEIGHT = A4_HEIGHT_PX - PAGE_PADDING.top - PAGE_PADDING.bottom;
