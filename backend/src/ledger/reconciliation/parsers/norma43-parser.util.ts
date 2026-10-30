import { BadRequestException } from '@nestjs/common';

export interface Norma43Movement {
  date: string;
  concept: string;
  amount: number;
  bankRef?: string;
}

export interface Norma43ParseResult {
  movements: Norma43Movement[];
  /** Registro 11: saldo inicial y periodo del extracto. */
  openingBalance: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Registro 33: saldo final. */
  closingBalance: number | null;
  /** Aviso no bloqueante si el saldo declarado en el registro 33 no cuadra con la suma de movimientos parseados. */
  warnings: string[];
}

const LINE_LENGTH = 80;

/** Registro 22 nunca trae el año completo — Norma 43 en uso hoy no tiene ficheros de los 90, así que se asume siempre prefijo "20". */
function parseNorma43Date(yymmdd: string): string {
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

/**
 * Verificado contra el fixture real de la implementación de referencia
 * `sergief/norma43parser` (github.com/sergief/norma43parser), no especulado:
 * el campo tras el importe (posiciones 42-80 del registro 22) es una
 * referencia bancaria numérica, NO el concepto — el texto legible del
 * movimiento viene concatenado desde los registros 23 que le siguen. Cuando
 * no hay ningún 23 detrás (raro, pero ocurre), se usa esa referencia como
 * concepto de respaldo porque `BankExtractEntryDto.concept` exige mínimo 1
 * carácter.
 */
export function parseNorma43(buffer: Buffer): Norma43ParseResult {
  const text = buffer.toString('latin1');
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) {
    throw new BadRequestException('El fichero Norma 43 está vacío.');
  }

  const movements: Norma43Movement[] = [];
  const warnings: string[] = [];
  let declaredDebitEntries: number | null = null;
  let declaredDebitAmount: number | null = null;
  let declaredCreditEntries: number | null = null;
  let declaredCreditAmount: number | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i].padEnd(LINE_LENGTH, ' ');
    const type = line.slice(0, 2);

    if (type === '22') {
      const date = parseNorma43Date(line.slice(10, 16));
      const sign = line.slice(27, 28);
      const amountRaw = line.slice(28, 42);
      const amount = (sign === '2' ? 1 : -1) * (Number(amountRaw) / 100);
      const referenceRaw = line
        .slice(42, LINE_LENGTH)
        .trim()
        .replace(/^0+(?=\d)/, '');
      // Una referencia formada solo por ceros (ej. "000000000000") no es una referencia real.
      const reference = /^0*$/.test(referenceRaw) ? '' : referenceRaw;

      const conceptParts: string[] = [];
      let j = i + 1;
      while (
        j < rawLines.length &&
        rawLines[j].padEnd(LINE_LENGTH, ' ').slice(0, 2) === '23'
      ) {
        conceptParts.push(rawLines[j].slice(4).trim());
        j += 1;
      }
      const concept =
        conceptParts.join(' ').trim() || reference || 'Movimiento sin concepto';

      movements.push({
        date,
        concept,
        amount: Math.round(amount * 100) / 100,
        bankRef: reference ? reference.slice(0, 100) : undefined,
      });
      i = j;
      continue;
    }

    // Registro 11 (cabecera de cuenta), verificado con el fixture real:
    // fechas en 21-26 y 27-32, clave de saldo en 33 (1 deudor, 2 acreedor)
    // e importe del saldo inicial en 34-47.
    if (type === '11' && openingBalance === null) {
      periodFrom = parseNorma43Date(line.slice(20, 26));
      periodTo = parseNorma43Date(line.slice(26, 32));
      openingBalance =
        (line.slice(32, 33) === '1' ? -1 : 1) *
        (Number(line.slice(33, 47)) / 100);
    }

    if (type === '33') {
      // Saldo final: clave en 59 e importe en 60-73.
      closingBalance =
        (line.slice(58, 59) === '1' ? -1 : 1) *
        (Number(line.slice(59, 73)) / 100);
      declaredDebitEntries = Number(line.slice(20, 25));
      declaredDebitAmount = Number(line.slice(25, 39)) / 100;
      declaredCreditEntries = Number(line.slice(39, 44));
      declaredCreditAmount = Number(line.slice(44, 58)) / 100;
    }

    i += 1;
  }

  if (movements.length === 0) {
    throw new BadRequestException(
      'El fichero Norma 43 no contiene ningún movimiento (registro tipo 22).',
    );
  }

  if (declaredDebitAmount !== null && declaredCreditAmount !== null) {
    const debits = movements.filter((m) => m.amount < 0);
    const credits = movements.filter((m) => m.amount > 0);
    const sumDebit = -debits.reduce((acc, m) => acc + m.amount, 0);
    const sumCredit = credits.reduce((acc, m) => acc + m.amount, 0);
    const mismatch =
      debits.length !== declaredDebitEntries ||
      credits.length !== declaredCreditEntries ||
      Math.abs(sumDebit - declaredDebitAmount) > 0.01 ||
      Math.abs(sumCredit - declaredCreditAmount) > 0.01;
    if (mismatch) {
      warnings.push(
        `El registro de cierre declara ${declaredDebitEntries} cargos (${declaredDebitAmount.toFixed(2)}) y ${declaredCreditEntries} abonos (${declaredCreditAmount.toFixed(2)}), pero se parsearon ${debits.length} cargos (${sumDebit.toFixed(2)}) y ${credits.length} abonos (${sumCredit.toFixed(2)}). Revisa el fichero antes de conciliar.`,
      );
    }
  }

  if (openingBalance !== null && closingBalance !== null) {
    const expected =
      Math.round(
        (openingBalance + movements.reduce((acc, m) => acc + m.amount, 0)) *
          100,
      ) / 100;
    if (Math.abs(expected - closingBalance) > 0.005) {
      warnings.push(
        `El saldo inicial (${openingBalance.toFixed(2)}) más los movimientos da ${expected.toFixed(2)}, pero el extracto declara un saldo final de ${closingBalance.toFixed(2)}.`,
      );
    }
  }

  return {
    movements,
    warnings,
    openingBalance,
    closingBalance,
    periodFrom,
    periodTo,
  };
}
