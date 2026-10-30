import type { SupplierInvoiceStatus } from '../../../prisma/client';
import { percentOf, splitByWeights, type Cents } from '../../money';

/**
 * Reglas puras de las facturas y pagos a proveedores (fase 7). Todo en
 * céntimos enteros.
 *
 * Una comunidad no deduce IVA (ADR, D10): el IVA es gasto y se reparte
 * entre las líneas de gasto en proporción a su base, por el método del
 * mayor resto, para que cada cuenta 6xx y cada centro de coste cargue su
 * parte y la suma sea exactamente el total.
 */

export interface InvoiceLineInput {
  accountId: string;
  costCentreId?: string | null;
  description?: string | null;
  /** Base imponible de la línea, en céntimos. */
  base: Cents;
}

export interface InvoiceLineAmounts extends InvoiceLineInput {
  /** Lo que se carga en la cuenta: base más su parte del IVA. */
  amount: Cents;
}

export interface InvoiceAmounts {
  base: Cents;
  vat: Cents;
  withholding: Cents;
  total: Cents;
  payable: Cents;
  lines: InvoiceLineAmounts[];
}

const PCT = /^\d{1,3}(\.\d{1,2})?$/;

function assertPct(value: number, label: string): void {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100 ||
    !PCT.test(String(value))
  ) {
    throw new RangeError(
      `${label} debe estar entre 0 y 100, con dos decimales como mucho.`,
    );
  }
}

export function computeInvoice(
  lines: readonly InvoiceLineInput[],
  vatRatePct: number,
  withholdingRatePct: number,
): InvoiceAmounts {
  if (lines.length === 0) {
    throw new RangeError('La factura necesita al menos una línea de gasto.');
  }
  for (const l of lines) {
    if (!Number.isSafeInteger(l.base) || l.base <= 0) {
      throw new RangeError('La base de cada línea debe ser mayor que cero.');
    }
  }
  assertPct(vatRatePct, 'El IVA');
  assertPct(withholdingRatePct, 'La retención');

  const base = lines.reduce((s, l) => s + l.base, 0);
  const vat = percentOf(base, vatRatePct);
  const withholding = percentOf(base, withholdingRatePct);
  const total = base + vat;
  const payable = total - withholding;
  if (payable <= 0) {
    throw new RangeError(
      'La retención no puede ser igual o mayor que el total de la factura.',
    );
  }
  const vatShares =
    vat > 0
      ? splitByWeights(
          vat,
          lines.map((l) => l.base),
        )
      : lines.map(() => 0);
  return {
    base,
    vat,
    withholding,
    total,
    payable,
    lines: lines.map((l, i) => ({ ...l, amount: l.base + vatShares[i] })),
  };
}

export interface OpenInvoice {
  id: string;
  number: string;
  outstanding: Cents;
  dueDate: Date | null;
  issueDate: Date;
}

export interface PaymentAllocation {
  invoiceId: string;
  amount: Cents;
}

/**
 * Reparte un pago entre las facturas abiertas del proveedor: las que indique
 * la gestora, en su orden, o si no, primero las que vencen antes (y a igual
 * vencimiento, la más antigua). A un proveedor no se le paga de más: el
 * exceso es un error, no un anticipo.
 */
export function allocatePayment(
  amount: Cents,
  open: readonly OpenInvoice[],
  explicitIds?: readonly string[],
): PaymentAllocation[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(
      'El importe del pago debe ser positivo y en céntimos.',
    );
  }
  let ordered: OpenInvoice[];
  if (explicitIds && explicitIds.length > 0) {
    const byId = new Map(open.map((i) => [i.id, i]));
    ordered = explicitIds.map((id) => {
      const inv = byId.get(id);
      if (!inv)
        throw new RangeError(
          `La factura ${id} no está pendiente de pago en este proveedor.`,
        );
      return inv;
    });
  } else {
    ordered = [...open].sort((a, b) => {
      const da = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const db = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return (
        da - db ||
        a.issueDate.getTime() - b.issueDate.getTime() ||
        a.number.localeCompare(b.number)
      );
    });
  }
  const pending = ordered.reduce((s, i) => s + i.outstanding, 0);
  if (amount > pending) {
    throw new RangeError(
      `El pago (${(amount / 100).toFixed(2)} €) supera lo pendiente de ${explicitIds?.length ? 'esas facturas' : 'este proveedor'} (${(pending / 100).toFixed(2)} €).`,
    );
  }
  let remaining = amount;
  const allocations: PaymentAllocation[] = [];
  for (const inv of ordered) {
    if (remaining === 0) break;
    const take = Math.min(remaining, inv.outstanding);
    if (take > 0) allocations.push({ invoiceId: inv.id, amount: take });
    remaining -= take;
  }
  return allocations;
}

/** Estado de pago a partir de lo que queda por pagar (mismo criterio que la base de datos). */
export function invoiceStatusFor(
  payable: Cents,
  outstanding: Cents,
): SupplierInvoiceStatus {
  if (outstanding === 0) return 'Pagada';
  if (outstanding === payable) return 'Registrada';
  return 'Parcial';
}
