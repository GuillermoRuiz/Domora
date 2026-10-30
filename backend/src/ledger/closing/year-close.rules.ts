import { Prisma } from '../../prisma/client';
import type { Cents } from '../money';
import type { LineDraft } from '../posting/posting.types';

/**
 * Cierre de ejercicio (fase 11 de doc/contabilidad/roadmap-partida-doble.md).
 * Funciones puras: sin base de datos, para poder probar exhaustivamente los
 * modos de dotación y el "llevar a cero" de cualquier cuenta.
 */

/**
 * La línea que lleva EXACTAMENTE a cero el saldo de una cuenta (cierre), o
 * null si ya está a cero. Vale para cualquier naturaleza — no hace falta
 * distinguir activo/pasivo/ingreso/gasto: un saldo deudor (positivo, debe
 * − haber) se abona, uno acreedor (negativo) se carga.
 */
export function closingLine(
  accountId: string,
  balanceCents: Cents,
  extra: Partial<LineDraft> = {},
): LineDraft | null {
  if (balanceCents === 0) return null;
  return balanceCents > 0
    ? { account: { accountId }, credit: balanceCents, ...extra }
    : { account: { accountId }, debit: -balanceCents, ...extra };
}

/**
 * La línea espejo que restablece ese mismo saldo (apertura del año
 * siguiente) — exactamente la contraria de `closingLine` para el mismo
 * importe, así que ambas juntas en la misma transacción no cambian el
 * saldo acumulado de la cuenta (ni el de ningún documento que cite, vía
 * `receiptId`/`supplierInvoiceId`, esa línea).
 */
export function openingLine(
  accountId: string,
  balanceCents: Cents,
  extra: Partial<LineDraft> = {},
): LineDraft | null {
  if (balanceCents === 0) return null;
  return balanceCents > 0
    ? { account: { accountId }, debit: balanceCents, ...extra }
    : { account: { accountId }, credit: -balanceCents, ...extra };
}

export type ReserveAllocationRuleInput =
  'fixed_amount' | 'pct_of_result' | 'top_up_to_legal_minimum';

export interface ReserveAllocationInput {
  rule: ReserveAllocationRuleInput;
  /** Euros o %, según la regla — null solo se admite en `top_up_to_legal_minimum`. */
  value: Prisma.Decimal | string | number | null;
  /** Resultado del ejercicio ya regularizado (positivo = beneficio). */
  resultCents: Cents;
  /** Saldo actual de la 117 (antes de esta dotación). */
  currentReserveCents: Cents;
  /** 10 % del último presupuesto ordinario aprobado (art. 9.1.f LPH). */
  legalMinimumCents: Cents;
}

/**
 * Cuánto dotar al fondo de reserva en el cierre (ADR D3, modo
 * `year_end_allocation`/`both`). Nunca dota con pérdidas, y nunca más de lo
 * que da el resultado del ejercicio — dotar por encima descapitalizaría la
 * comunidad más allá de lo que ganó.
 */
export function computeReserveAllocation(input: ReserveAllocationInput): Cents {
  if (input.resultCents <= 0) return 0;
  switch (input.rule) {
    case 'fixed_amount': {
      const fixed = new Prisma.Decimal(input.value ?? 0)
        .mul(100)
        .toDecimalPlaces(0)
        .toNumber();
      return Math.min(fixed, input.resultCents);
    }
    case 'pct_of_result': {
      const pct = new Prisma.Decimal(input.value ?? 0)
        .div(100)
        .mul(input.resultCents)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toNumber();
      return Math.min(Math.max(pct, 0), input.resultCents);
    }
    case 'top_up_to_legal_minimum': {
      const gap = Math.max(
        input.legalMinimumCents - input.currentReserveCents,
        0,
      );
      return Math.min(gap, input.resultCents);
    }
  }
}
