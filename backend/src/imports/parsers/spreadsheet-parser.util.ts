import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

const CSV_EXTENSIONS = ['.csv'];
const XLSX_EXTENSIONS = ['.xlsx', '.xls'];

/**
 * Se usa `exceljs`, no `xlsx` (SheetJS) — la versión de `xlsx` publicada en
 * npm (0.18.5, la última disponible ahí) tiene una vulnerabilidad de
 * prototype pollution conocida sin parchear en el registro (SheetJS movió
 * los fixes a su propio CDN). Justo el caso de uso de este módulo — parsear
 * ficheros subidos por cualquier gestora — es el vector de riesgo real, así
 * que se descartó esa dependencia al detectarla en `npm audit` antes de
 * escribir código sobre ella.
 */
function formatFromFilename(fileKeyOrName: string): 'csv' | 'xlsx' {
  const lower = fileKeyOrName.toLowerCase();
  if (CSV_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'csv';
  if (XLSX_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'xlsx';
  throw new BadRequestException(
    'Formato de fichero no soportado para importación (se esperaba .csv, .xlsx o .xls).',
  );
}

/**
 * `exceljs` interpreta las celdas de fecha (tanto CSV como XLSX) en hora
 * LOCAL del proceso, no en UTC — un `Date` que representa "3 de febrero
 * medianoche hora local" da `toISOString() === "2020-02-02T23:00:00.000Z"`
 * en cualquier huso horario adelantado a UTC (verificado con exceljs
 * directamente, no asumido). Usar `toISOString()` acá corre la fecha un día
 * hacia atrás. Se extraen los componentes de fecha en hora LOCAL en su
 * lugar — son celdas de fecha de calendario, no timestamps con hora.
 */
function dateToLocalIso(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateToLocalIso(value);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value && value.result !== undefined) {
      return cellToString(value.result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('');
    }
    return '';
  }
  return String(value);
}

/**
 * Separador de un CSV a partir de su primera línea: `;` (el habitual en los
 * exports de la banca y del Excel en español, donde la coma es decimal), `,`
 * o tabulador. Se cuenta fuera de comillas; a igualdad, gana la coma.
 */
export function detectCsvDelimiter(buffer: Buffer): string {
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  let text = buffer.subarray(0, 4096).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(LF, 1)[0].split(CR, 1)[0];
  const counts: Record<string, number> = { ',': 0, ';': 0, [TAB]: 0 };
  let quoted = false;
  for (const c of firstLine) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in counts) counts[c] += 1;
  }
  const best = Object.entries(counts).sort(
    (x, y) => y[1] - x[1] || (x[0] === ',' ? -1 : y[0] === ',' ? 1 : 0),
  )[0];
  return best[1] > 0 ? best[0] : ',';
}

/** `row.values` de exceljs es 1-indexado (values[0] siempre undefined). */
function normalizeRow(values: ExcelJS.CellValue[]): string[] {
  return values.slice(1).map(cellToString);
}

/**
 * `fileKeyOrName` sirve solo para inferir el formato por extensión — la
 * clave de `StorageService` conserva el nombre original saneado, así que no
 * hace falta persistir el mimetype por separado en `ImportBatch`.
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  fileKeyOrName: string,
): Promise<ParsedSheet> {
  const format = formatFromFilename(fileKeyOrName);
  const workbook = new ExcelJS.Workbook();
  if (format === 'csv') {
    await workbook.csv.read(Readable.from(buffer), {
      parserOptions: { delimiter: detectCsvDelimiter(buffer) },
    });
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new BadRequestException('El fichero no tiene ninguna hoja de datos.');
  }

  let headers: string[] = [];
  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    const values = normalizeRow(row.values as ExcelJS.CellValue[]);
    if (rowNumber === 1) {
      headers = values.map((v, i) => v.trim() || `Columna ${i + 1}`);
      return;
    }
    if (values.every((v) => !v.trim())) return; // fila vacía — se ignora
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (values[i] ?? '').trim();
    });
    rows.push(record);
  });

  if (headers.length === 0) {
    throw new BadRequestException(
      'El fichero no tiene cabeceras (primera fila vacía).',
    );
  }

  return { headers, rows };
}
