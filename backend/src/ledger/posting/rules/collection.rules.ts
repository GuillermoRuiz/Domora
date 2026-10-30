import type { ReceiptKind, ReceiptStatus } from '../../../prisma/client';
import type { Cents } from '../../money';

/**
 * Imputación de un cobro a los recibos pendientes de una propiedad
 * (ADR, decisión D6). Función pura.
 *
 * Orden legal cuando el propietario no dice qué paga:
 * - art. 1173 CC: primero los intereses, después el principal;
 * - art. 1174 CC: entre deudas de la misma naturaleza, la más onerosa, que
 *   en una comunidad es la más antigua (además, así la deuda que queda viva
 *   es la más reciente, dentro del periodo del art. 9.1.e LPH).
 *
 * Si la gestora indica recibos concretos, se respeta su orden. Lo que sobra
 * tras cubrir todo lo pendiente es un anticipo del propietario.
 */
export interface OpenReceipt {
  id: string;
  kind: ReceiptKind;
  outstanding: Cents;
  originYear: number;
  accrualDate: Date;
  dueDate: Date | null;
  no: string;
}

export interface Allocation {
  receiptId: string;
  amount: Cents;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Lo que no cubre ningún recibo: anticipo del propietario. */
  advance: Cents;
}

/** Orden por defecto: intereses primero, luego lo más antiguo. */
export function legalImputationOrder(
  receipts: readonly OpenReceipt[],
): OpenReceipt[] {
  const time = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);
  return [...receipts].sort((a, b) => {
    const interestA = a.kind === 'intereses_demora' ? 0 : 1;
    const interestB = b.kind === 'intereses_demora' ? 0 : 1;
    return (
      interestA - interestB ||
      a.originYear - b.originYear ||
      a.accrualDate.getTime() - b.accrualDate.getTime() ||
      time(a.dueDate) - time(b.dueDate) ||
      a.no.localeCompare(b.no)
    );
  });
}

export function allocateCollection(
  amount: Cents,
  openReceipts: readonly OpenReceipt[],
  explicitOrder?: readonly string[],
): AllocationResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(
      'El importe del cobro debe ser positivo y en céntimos.',
    );
  }
  let ordered: OpenReceipt[];
  if (explicitOrder && explicitOrder.length > 0) {
    const byId = new Map(openReceipts.map((r) => [r.id, r]));
    ordered = explicitOrder.map((id) => {
      const r = byId.get(id);
      if (!r)
        throw new RangeError(
          `El recibo ${id} no está pendiente en esta propiedad.`,
        );
      return r;
    });
  } else {
    ordered = legalImputationOrder(openReceipts);
  }

  let remaining = amount;
  const allocations: Allocation[] = [];
  for (const r of ordered) {
    if (remaining === 0) break;
    if (r.outstanding <= 0) continue;
    const take = Math.min(remaining, r.outstanding);
    allocations.push({ receiptId: r.id, amount: take });
    remaining -= take;
  }
  return { allocations, advance: remaining };
}

/**
 * Estado de cobro de un recibo a partir de lo que tiene pendiente (el mismo
 * criterio que verifica la base de datos, migración ledger_receipts).
 * `returned` indica que el último movimiento fue una devolución bancaria.
 */
export function receiptStatusFor(
  amount: Cents,
  outstanding: Cents,
  opts: { returned?: boolean; previous?: ReceiptStatus } = {},
): ReceiptStatus {
  if (outstanding === 0) return 'Pagada';
  if (opts.returned) return 'Devuelto';
  if (outstanding === amount)
    return opts.previous === 'Devuelto' ? 'Devuelto' : 'Pendiente';
  return 'Parcial';
}
