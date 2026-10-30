import type { AccountRole } from '../../prisma/client';
import type { Cents } from '../money';

/**
 * Reglas puras del asiento de apertura (fase 9 de
 * doc/contabilidad/roadmap-partida-doble.md). El asiento es un único
 * "traspaso de saldos" al debe y al haber — sin líneas de resultado — por
 * eso el cálculo es una simple suma por lado, no una regla de negocio con
 * ramas. La diferencia entre ambos lados es lo que el ADR (D17) exige
 * aceptar explícitamente antes de contabilizar.
 */

export interface OpeningTotals {
  /** Bancos + deudas de propiedades + otros saldos deudores. */
  debit: Cents;
  /** Anticipos + facturas de proveedor pendientes + otros saldos acreedores. */
  credit: Cents;
  /** debit − credit. Positivo: sobra debe, hay que abonar la diferencia. */
  difference: Cents;
}

/** Cuentas donde tiene sentido meter "lo que sobra" de otros saldos (D3/D9/D11 del ADR). */
export const OTHER_BALANCE_ROLES: readonly AccountRole[] = [
  'reserve_fund',
  'retained',
  'prior_losses',
  'withholding_payable',
  'social_security_payable',
  'salaries_payable',
  'suspense',
];

/** Dónde puede ir la diferencia de cuadre (ADR, D17: "a la 117 o a la 120"). */
export const DIFFERENCE_ROLES: readonly AccountRole[] = [
  'reserve_fund',
  'retained',
];

export interface OpeningTotalsInput {
  bankBalances: { balance: Cents }[];
  propertyDebts: { amount: Cents }[];
  propertyAdvances: { amount: Cents }[];
  supplierInvoices: { amount: Cents }[];
  otherBalances: { side: 'debit' | 'credit'; amount: Cents }[];
}

export function computeOpeningTotals(input: OpeningTotalsInput): OpeningTotals {
  let debit = 0;
  let credit = 0;
  for (const b of input.bankBalances) debit += b.balance;
  for (const d of input.propertyDebts) debit += d.amount;
  for (const a of input.propertyAdvances) credit += a.amount;
  for (const i of input.supplierInvoices) credit += i.amount;
  for (const o of input.otherBalances) {
    if (o.side === 'debit') debit += o.amount;
    else credit += o.amount;
  }
  return { debit, credit, difference: debit - credit };
}
