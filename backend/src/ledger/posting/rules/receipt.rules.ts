import type {
  AccountRole,
  PayMethod,
  Prisma,
  ReceiptKind,
  ReserveMode,
} from '../../../prisma/client';
import { percentOf, type Cents } from '../../money';

/**
 * Reglas de contabilización de los recibos (ADR, fase 4). Funciones puras:
 * sin base de datos, fáciles de probar exhaustivamente.
 */

/** Cuenta de ingreso de cada tipo de recibo. "Saldo anterior" no tiene: su contrapartida es la apertura. */
export const RECEIPT_KIND_INCOME_ROLE: Record<ReceiptKind, AccountRole | null> =
  {
    cuota_ordinaria: 'income_ordinary',
    derrama: 'income_extraordinary',
    fondo_reserva: 'reserve_fund',
    saldo_anterior: null,
    intereses_demora: 'interest_income',
    gastos_devolucion: 'income_recharges',
    otros: 'income_recharges',
  };

export interface ReserveConfig {
  mode: ReserveMode;
  sharePct: Prisma.Decimal | string | number | null;
}

export interface ReceiptCreditLine {
  role: AccountRole;
  amount: Cents;
  concept: string;
}

/**
 * Desglose del abono de la emisión. Solo la cuota ordinaria separa la parte
 * del fondo de reserva (modo "por recibo" o "ambos"); derramas y demás van
 * enteras a su cuenta. El reparto redondea la parte de la reserva al
 * céntimo (medio céntimo hacia arriba) y la cuota se queda con el resto,
 * así que las líneas suman siempre el importe exacto.
 */
export function receiptCreditLines(
  kind: ReceiptKind,
  amount: Cents,
  reserve: ReserveConfig,
): ReceiptCreditLine[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(
      'El importe del recibo debe ser positivo y en céntimos.',
    );
  }
  const role = RECEIPT_KIND_INCOME_ROLE[kind];
  if (!role) {
    throw new RangeError(
      'Un recibo de saldo anterior no tiene desglose de ingresos.',
    );
  }

  const splitsReserve =
    kind === 'cuota_ordinaria' &&
    (reserve.mode === 'receipt_share' || reserve.mode === 'both') &&
    reserve.sharePct !== null &&
    Number(reserve.sharePct) > 0;

  if (!splitsReserve) {
    return [{ role, amount, concept: conceptFor(role) }];
  }
  const share = percentOf(amount, reserve.sharePct!);
  const net = amount - share;
  if (share <= 0) return [{ role, amount, concept: conceptFor(role) }];
  if (net <= 0)
    return [
      { role: 'reserve_fund', amount, concept: conceptFor('reserve_fund') },
    ];
  return [
    { role, amount: net, concept: conceptFor(role) },
    {
      role: 'reserve_fund',
      amount: share,
      concept: 'Aportación al fondo de reserva',
    },
  ];
}

function conceptFor(role: AccountRole): string {
  switch (role) {
    case 'income_ordinary':
      return 'Cuota ordinaria';
    case 'income_extraordinary':
      return 'Derrama';
    case 'reserve_fund':
      return 'Aportación al fondo de reserva';
    case 'interest_income':
      return 'Intereses de demora';
    default:
      return 'Otros ingresos';
  }
}

/** Efectivo y pago en oficina van a caja (570); lo demás, al banco. */
export function collectionAccountRole(method: PayMethod): 'cash' | 'bank' {
  return method === 'Efectivo' || method === 'PagoEnOficina' ? 'cash' : 'bank';
}

/**
 * Fecha contable de la emisión: el primer día del periodo del recibo, o la
 * fecha de inicio contable si el periodo empieza antes (ADR, D1).
 */
export function receiptAccrualDate(periodKey: string, cutover: Date): Date {
  const [year, month] = periodKey.split('-').map(Number);
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  return periodStart < cutover ? cutover : periodStart;
}

/**
 * Sugerencia del porcentaje del recibo para el fondo de reserva que cubre el
 * mínimo legal (10 % del presupuesto ordinario, art. 9.1.f LPH): si las
 * cuotas recaudan presupuesto + reserva, la reserva es 10 / 110 del total
 * (9,0909… %). Se redondea hacia ARRIBA, a 9,10 %: 9,09 % se quedaría corto.
 */
export const LEGAL_MINIMUM_RESERVE_SHARE_PCT = '9.10';
