import { UnprocessableEntityException } from '@nestjs/common';
import type { EntryDraft } from './posting.types';

/**
 * Comprobación en la aplicación de un borrador de asiento, antes de tocar la
 * base de datos. La base de datos vuelve a comprobarlo todo (no se fía de
 * esto); aquí se falla antes y con un mensaje que apunta a la línea.
 */
export function validateDraft(draft: EntryDraft): void {
  const fail = (message: string): never => {
    throw new UnprocessableEntityException(message);
  };

  if (!draft.concept?.trim()) fail('El asiento necesita un concepto.');
  if (!(draft.date instanceof Date) || Number.isNaN(draft.date.getTime())) {
    fail('La fecha del asiento no es válida.');
  }
  if (draft.lines.length < 2) fail('Un asiento necesita al menos dos líneas.');

  let debit = 0;
  let credit = 0;
  draft.lines.forEach((line, index) => {
    const n = index + 1;
    const d = line.debit ?? 0;
    const c = line.credit ?? 0;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c)) {
      fail(`La línea ${n} tiene un importe con fracción de céntimo.`);
    }
    if (d < 0 || c < 0) fail(`La línea ${n} tiene un importe negativo.`);
    if (d > 0 === c > 0) {
      fail(
        `La línea ${n} debe ir al debe o al haber, no a los dos ni a ninguno.`,
      );
    }
    debit += d;
    credit += c;
  });
  if (debit !== credit) {
    fail(
      `El asiento no cuadra: debe ${(debit / 100).toFixed(2)} y haber ${(credit / 100).toFixed(2)}.`,
    );
  }
}

/** Fecha contable normalizada al día UTC (la columna es DATE). */
export function accountingDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
