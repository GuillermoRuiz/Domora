import type { Cents } from '../money';

/**
 * Reglas puras de los modelos 111, 190 y 347 (fase 7b,
 * doc/compliance/fiscal-comunidades.md). Todo en céntimos enteros.
 */

/** Umbral del 347: se declaran los terceros que SUPERAN 3.005,06 € al año, IVA incluido. */
export const THRESHOLD_347: Cents = 300506;

export type Quarter = 1 | 2 | 3 | 4;

/** Primer y último día (UTC) de un trimestre. */
export function quarterRange(
  year: number,
  quarter: Quarter,
): { from: Date; to: Date } {
  const startMonth = (quarter - 1) * 3;
  return {
    from: new Date(Date.UTC(year, startMonth, 1)),
    to: new Date(Date.UTC(year, startMonth + 3, 0)),
  };
}

export function quarterOf(date: Date): Quarter {
  return (Math.floor(date.getUTCMonth() / 3) + 1) as Quarter;
}

/** Último día para presentar el 111 de un trimestre: el 20 del mes siguiente. */
export function deadline111(year: number, quarter: Quarter): Date {
  return quarter === 4
    ? new Date(Date.UTC(year + 1, 0, 20))
    : new Date(Date.UTC(year, quarter * 3, 20));
}

/** round(a · b / c) con redondeo medio hacia arriba, sin coma flotante. */
function mulDivRound(a: Cents, b: Cents, c: Cents): Cents {
  const num = BigInt(a) * BigInt(b) * 2n + BigInt(c);
  return Number(num / (BigInt(c) * 2n));
}

/**
 * Parte de un importe (la retención o la base de una factura) que
 * corresponde a un pago parcial. Se calcula por acumulado —lo que tocaba
 * hasta después del pago menos lo que tocaba hasta antes— para que los
 * pagos de una factura sumen exactamente su importe, sin céntimos perdidos
 * por redondeo.
 */
export function proratedShare(
  amount: Cents,
  payable: Cents,
  paidBefore: Cents,
  paidAfter: Cents,
): Cents {
  if (payable <= 0)
    throw new RangeError('El importe a pagar debe ser positivo.');
  if (paidBefore < 0 || paidAfter < paidBefore || paidAfter > payable) {
    throw new RangeError(
      'Los pagos acumulados no son coherentes con la factura.',
    );
  }
  return (
    mulDivRound(amount, paidAfter, payable) -
    mulDivRound(amount, paidBefore, payable)
  );
}

/** Una percepción sujeta a retención, en la fecha en que se paga. */
export interface WithholdingEvent {
  date: Date;
  /** A: trabajo; G: actividades profesionales; other: otra (revisar). */
  key: 'A' | 'G' | 'other';
  /** Identifica al perceptor: NIF si lo hay, o un id interno. */
  recipientKey: string;
  nif: string | null;
  name: string;
  /** Percepción íntegra (base, sin IVA), en céntimos. */
  perception: Cents;
  withholding: Cents;
  source: 'payroll' | 'supplier_payment';
  /** Nómina o número de factura, para el detalle. */
  documentRef: string;
}

export interface Box111 {
  recipients: number;
  perceptions: Cents;
  withholdings: Cents;
}

export interface Summary111 {
  /** Casillas 01 a 03: rendimientos del trabajo, dinerarios. */
  work: Box111;
  /** Casillas 07 a 09: rendimientos de actividades económicas, dinerarios. */
  activities: Box111;
  /** Casilla 28: suma de retenciones. */
  total: Cents;
  /** Retenciones con clave "otra": no entran en el 111 sin revisarlas (un alquiler va al 115). */
  unclassified: Box111;
}

function box(events: WithholdingEvent[]): Box111 {
  return {
    recipients: new Set(events.map((e) => e.recipientKey)).size,
    perceptions: events.reduce((s, e) => s + e.perception, 0),
    withholdings: events.reduce((s, e) => s + e.withholding, 0),
  };
}

export function summarize111(events: readonly WithholdingEvent[]): Summary111 {
  const work = box(events.filter((e) => e.key === 'A'));
  const activities = box(events.filter((e) => e.key === 'G'));
  return {
    work,
    activities,
    total: work.withholdings + activities.withholdings,
    unclassified: box(events.filter((e) => e.key === 'other')),
  };
}

export interface Row190 {
  nif: string | null;
  name: string;
  key: 'A' | 'G' | 'other';
  /** Subclave: 01 en la G para actividades profesionales en general; en la A no hay subclave. */
  subkey: string | null;
  perceptions: Cents;
  withholdings: Cents;
}

/** Resumen anual por perceptor y clave, ordenado por nombre. */
export function summarize190(events: readonly WithholdingEvent[]): Row190[] {
  const rows = new Map<string, Row190>();
  for (const e of events) {
    const id = `${e.recipientKey}|${e.key}`;
    const row = rows.get(id) ?? {
      nif: e.nif,
      name: e.name,
      key: e.key,
      subkey: e.key === 'G' ? '01' : null,
      perceptions: 0,
      withholdings: 0,
    };
    row.perceptions += e.perception;
    row.withholdings += e.withholding;
    rows.set(id, row);
  }
  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'es') || a.key.localeCompare(b.key),
  );
}

/** Una operación con un tercero (factura recibida), para el 347. */
export interface Operation347 {
  thirdPartyId: string;
  name: string;
  nif: string | null;
  date: Date;
  /** IVA incluido. */
  amount: Cents;
  /** Tercero excluido por el art. 33.5 del RGAT (suministros y seguros). */
  excludedThirdParty: boolean;
  /** Factura con retención: se declara en el 190, no en el 347. */
  withheld: boolean;
}

export interface Row347 {
  thirdPartyId: string;
  name: string;
  nif: string | null;
  total: Cents;
  quarters: [Cents, Cents, Cents, Cents];
}

export interface Summary347 {
  declared: Row347[];
  /** Por qué no entra lo que no entra, para que la gestora lo vea. */
  excluded: {
    thirdPartyId: string;
    name: string;
    total: Cents;
    reason: 'art_33_5' | 'retencion' | 'umbral';
  }[];
}

export function summarize347(operations: readonly Operation347[]): Summary347 {
  const byThird = new Map<
    string,
    { name: string; nif: string | null; ops: Operation347[] }
  >();
  for (const op of operations) {
    const entry = byThird.get(op.thirdPartyId) ?? {
      name: op.name,
      nif: op.nif,
      ops: [],
    };
    entry.ops.push(op);
    byThird.set(op.thirdPartyId, entry);
  }
  const declared: Row347[] = [];
  const excluded: Summary347['excluded'] = [];
  for (const [thirdPartyId, { name, nif, ops }] of byThird) {
    const all = ops.reduce((s, o) => s + o.amount, 0);
    if (ops.every((o) => o.excludedThirdParty)) {
      excluded.push({ thirdPartyId, name, total: all, reason: 'art_33_5' });
      continue;
    }
    const counted = ops.filter((o) => !o.excludedThirdParty && !o.withheld);
    const total = counted.reduce((s, o) => s + o.amount, 0);
    if (counted.length === 0) {
      excluded.push({ thirdPartyId, name, total: all, reason: 'retencion' });
      continue;
    }
    if (total <= THRESHOLD_347) {
      excluded.push({ thirdPartyId, name, total, reason: 'umbral' });
      continue;
    }
    const quarters: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
    for (const o of counted) quarters[quarterOf(o.date) - 1] += o.amount;
    declared.push({ thirdPartyId, name, nif, total, quarters });
  }
  declared.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  excluded.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { declared, excluded };
}
