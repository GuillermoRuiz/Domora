import { BadRequestException } from '@nestjs/common';
import { parseSpreadsheet } from '../../../imports/parsers/spreadsheet-parser.util';

export interface CsvBankMovement {
  date: string;
  concept: string;
  amount: number;
  bankRef?: string;
}

/**
 * Alias de cabeceras típicos de exports de banca online española. A
 * diferencia del wizard de Gesfincas, acá no hay paso de mapeo manual: es
 * "subir y listo" porque esto se sube recurrentemente (cada mes), no una
 * migración única con revisión exhaustiva.
 */
const DATE_ALIASES = [
  'fecha',
  'fecha operacion',
  'fecha operación',
  'fecha valor',
  'date',
];
const CONCEPT_ALIASES = [
  'concepto',
  'descripcion',
  'descripción',
  'concept',
  'description',
];
const AMOUNT_ALIASES = ['importe', 'importe eur', 'amount', 'cantidad'];
const REF_ALIASES = ['referencia', 'ref', 'reference', 'bankref'];

const ACCENTED_CHARS: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
};

function normalizeHeader(h: string): string {
  const lower = h.trim().toLowerCase();
  return Array.from(lower)
    .map((c) => ACCENTED_CHARS[c] ?? c)
    .join('');
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  for (const alias of aliases) {
    const match = normalized.find((h) => h.norm === alias);
    if (match) return match.raw;
  }
  return null;
}

/**
 * El importe puede venir con coma decimal y/o separador de miles con punto
 * (formato español, "1.234,56") o con notación estándar ("1234.56") —
 * exceljs ya nos entrega el valor como texto, así que hay que normalizarlo.
 */
function parseAmount(raw: string): number {
  const trimmed = raw.trim().replace(/[€\s]/g, '');
  const hasComma = trimmed.includes(',');
  const normalized = hasComma
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const value = Number(normalized);
  if (Number.isNaN(value)) {
    throw new BadRequestException(`Importe no numérico en el CSV: "${raw}".`);
  }
  return value;
}

function parseDate(raw: string): string {
  const trimmed = raw.trim();
  // dd/mm/aaaa o dd-mm-aaaa (formato español habitual en banca online).
  const spanish = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (spanish) {
    const [, dd, mm, yyyy] = spanish;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  // aaaa-mm-dd (ISO, por si el export ya viene así).
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  throw new BadRequestException(
    `Fecha con formato no reconocido en el CSV: "${raw}" (se espera dd/mm/aaaa o aaaa-mm-dd).`,
  );
}

export async function parseCsvBankExtract(
  buffer: Buffer,
  fileName: string,
): Promise<CsvBankMovement[]> {
  const { headers, rows } = await parseSpreadsheet(buffer, fileName);

  const dateCol = findColumn(headers, DATE_ALIASES);
  const conceptCol = findColumn(headers, CONCEPT_ALIASES);
  const amountCol = findColumn(headers, AMOUNT_ALIASES);
  const refCol = findColumn(headers, REF_ALIASES);

  if (!dateCol || !conceptCol || !amountCol) {
    throw new BadRequestException(
      `No se reconocen las columnas del CSV. Se esperan cabeceras como "Fecha", "Concepto" e "Importe" (encontradas: ${headers.join(', ')}).`,
    );
  }

  return rows.map((row) => ({
    date: parseDate(row[dateCol]),
    concept: row[conceptCol]?.trim() || 'Movimiento sin concepto',
    amount: parseAmount(row[amountCol]),
    bankRef:
      refCol && row[refCol]?.trim()
        ? row[refCol].trim().slice(0, 100)
        : undefined,
  }));
}
