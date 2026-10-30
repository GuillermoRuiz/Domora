import { Prisma } from '../../prisma/client';
import type { Cents } from '../money';

/**
 * Cálculo de intereses de demora (fase 10 de
 * doc/contabilidad/roadmap-partida-doble.md, ADR D7): interés SIMPLE, días
 * reales sobre 365 fijo (Actual/365, nunca 365,25 ni 366 aunque el tramo
 * cruce un 29 de febrero — el año bisiesto solo afecta al numerador), desde
 * el vencimiento más los días de gracia, sin anatocismo (nunca interés
 * sobre interés — por eso solo se liquida sobre `AccountingReceipt` que no
 * sean ellos mismos `intereses_demora`).
 *
 * Función pura: sin base de datos, para poder probar exhaustivamente
 * cambios de tipo a mitad de periodo, cobros parciales y años bisiestos.
 */

const MS_PER_DAY = 86_400_000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export interface InterestPolicyWindow {
  id: string;
  /** % anual, ej. 3.25. */
  annualRatePct: Prisma.Decimal | string | number;
  graceDays: number;
  validFrom: Date;
  /** null = sigue vigente. */
  validTo: Date | null;
}

/** Un tramo del saldo pendiente de la deuda: vale desde `from` hasta el siguiente evento (o `asOfDate`). */
export interface PrincipalEvent {
  from: Date;
  outstandingCents: Cents;
}

/** Un tramo ya liquidado de esta misma deuda (garantía T11 en base de datos: nunca se solapan). */
export interface LiquidatedRange {
  from: Date;
  to: Date;
}

export interface ComputeInterestInput {
  dueDate: Date;
  /** Se liquida hasta este día, sin incluirlo. */
  asOfDate: Date;
  policies: InterestPolicyWindow[];
  /** Orden cronológico; el primer evento es la emisión de la deuda (saldo = importe total). */
  principalTimeline: PrincipalEvent[];
  alreadyLiquidated: LiquidatedRange[];
}

export interface InterestSegment {
  policyId: string;
  from: Date;
  to: Date;
  days: number;
  annualRatePct: Prisma.Decimal;
  principalCents: Cents;
  amountCents: Cents;
}

export interface InterestPreview {
  /** null si todavía no ha pasado la carencia — no hay nada que liquidar. */
  interestStart: Date | null;
  segments: InterestSegment[];
  totalCents: Cents;
}

/** Interés simple de un tramo, céntimo redondeado al medio hacia arriba. */
function segmentAmount(
  principalCents: Cents,
  annualRatePct: Prisma.Decimal,
  days: number,
): Cents {
  return new Prisma.Decimal(principalCents)
    .mul(annualRatePct)
    .div(100)
    .mul(days)
    .div(365)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

function policyAt(
  policies: InterestPolicyWindow[],
  date: Date,
): InterestPolicyWindow | null {
  return (
    policies.find(
      (p) => p.validFrom <= date && (p.validTo === null || date < p.validTo),
    ) ?? null
  );
}

function principalAt(timeline: PrincipalEvent[], date: Date): Cents {
  let current = 0;
  for (const event of timeline) {
    if (event.from > date) break;
    current = event.outstandingCents;
  }
  return current;
}

function isAlreadyLiquidated(
  ranges: LiquidatedRange[],
  from: Date,
  to: Date,
): boolean {
  return ranges.some((r) => r.from <= from && to <= r.to);
}

/**
 * La política que rige la carencia es la vigente en el vencimiento (o, si
 * todavía no había ninguna, la primera que empiece después) — un cambio de
 * tipo posterior no reabre ni adelanta cuándo empieza a correr el interés.
 */
function graceDaysAt(
  policies: InterestPolicyWindow[],
  dueDate: Date,
): number | null {
  const governing =
    policyAt(policies, dueDate) ??
    policies
      .filter((p) => p.validFrom > dueDate)
      .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())[0] ??
    null;
  return governing ? governing.graceDays : null;
}

export function computeInterest(input: ComputeInterestInput): InterestPreview {
  const graceDays = graceDaysAt(input.policies, input.dueDate);
  if (graceDays === null) {
    return { interestStart: null, segments: [], totalCents: 0 };
  }
  const interestStart = addDays(input.dueDate, graceDays);
  if (interestStart >= input.asOfDate) {
    return { interestStart, segments: [], totalCents: 0 };
  }

  const withinWindow = (d: Date) => d > interestStart && d < input.asOfDate;
  const breakpoints = new Set<number>([
    interestStart.getTime(),
    input.asOfDate.getTime(),
  ]);
  for (const p of input.policies) {
    if (withinWindow(p.validFrom)) breakpoints.add(p.validFrom.getTime());
    if (p.validTo && withinWindow(p.validTo))
      breakpoints.add(p.validTo.getTime());
  }
  for (const e of input.principalTimeline) {
    if (withinWindow(e.from)) breakpoints.add(e.from.getTime());
  }
  for (const r of input.alreadyLiquidated) {
    if (withinWindow(r.from)) breakpoints.add(r.from.getTime());
    if (withinWindow(r.to)) breakpoints.add(r.to.getTime());
  }
  const points = [...breakpoints].sort((a, b) => a - b).map((t) => new Date(t));

  const segments: InterestSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (from >= to) continue;
    if (isAlreadyLiquidated(input.alreadyLiquidated, from, to)) continue;
    const policy = policyAt(input.policies, from);
    if (!policy) continue; // hueco sin política configurada: no se inventa un tipo.
    const principalCents = principalAt(input.principalTimeline, from);
    if (principalCents <= 0) continue;
    const rate = new Prisma.Decimal(policy.annualRatePct);
    const days = daysBetween(from, to);
    const amountCents = segmentAmount(principalCents, rate, days);
    if (amountCents <= 0) continue;
    segments.push({
      policyId: policy.id,
      from,
      to,
      days,
      annualRatePct: rate,
      principalCents,
      amountCents,
    });
  }

  const totalCents = segments.reduce((sum, s) => sum + s.amountCents, 0);
  return { interestStart, segments, totalCents };
}
