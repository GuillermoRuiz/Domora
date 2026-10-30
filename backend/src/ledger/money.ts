import { Prisma } from '../prisma/client';

/**
 * Importes en céntimos enteros dentro de las reglas de contabilización.
 *
 * Los `Decimal` de Prisma son exactos, pero repartir importes (la parte de
 * un recibo que va al fondo de reserva, el prorrateo de una retención, una
 * devolución por coeficiente) exige decidir dónde va cada céntimo. Con
 * enteros esa decisión es explícita y el cuadre es exacto por construcción.
 */
export type Cents = number;

function assertSafeCents(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `Importe fuera de rango o con fracción de céntimo: ${value}`,
    );
  }
}

/** Convierte un importe en euros a céntimos. Rechaza más de dos decimales. */
export function toCents(value: Prisma.Decimal | string | number): Cents {
  const cents = new Prisma.Decimal(value).mul(100);
  if (!cents.isInteger()) {
    throw new RangeError(
      `El importe ${value.toString()} tiene más de dos decimales.`,
    );
  }
  const result = cents.toNumber();
  assertSafeCents(result);
  return result;
}

/** Convierte céntimos a un `Decimal` en euros con dos decimales. */
export function fromCents(cents: Cents): Prisma.Decimal {
  assertSafeCents(cents);
  return new Prisma.Decimal(cents).div(100).toDecimalPlaces(2);
}

/**
 * Porcentaje de un importe, redondeado a céntimos con la regla del medio
 * hacia arriba (0,5 céntimos → 1 céntimo), que es la habitual en recibos.
 */
export function percentOf(
  cents: Cents,
  percent: Prisma.Decimal | string | number,
): Cents {
  assertSafeCents(cents);
  const result = new Prisma.Decimal(cents)
    .mul(percent)
    .div(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
  assertSafeCents(result);
  return result;
}

/**
 * Reparte un importe en proporción a unos pesos por el método del mayor
 * resto: cada parte recibe su cuota truncada y los céntimos sobrantes van,
 * de uno en uno, a las partes con mayor fracción descartada. La suma de las
 * partes es SIEMPRE igual al total. A igualdad de fracción gana el primero,
 * así que el resultado es determinista.
 */
export function splitByWeights(
  total: Cents,
  weights: readonly (Prisma.Decimal | string | number)[],
): Cents[] {
  assertSafeCents(total);
  if (weights.length === 0) {
    throw new RangeError('Hace falta al menos un peso para repartir.');
  }
  const w = weights.map((x) => new Prisma.Decimal(x));
  if (w.some((x) => x.isNegative())) {
    throw new RangeError('Los pesos del reparto no pueden ser negativos.');
  }
  const sum = w.reduce((acc, x) => acc.plus(x), new Prisma.Decimal(0));
  if (sum.isZero()) {
    throw new RangeError('La suma de los pesos del reparto no puede ser cero.');
  }

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const exact = w.map((x) => x.mul(absTotal).div(sum));
  const parts = exact.map((x) => x.floor().toNumber());
  let remaining = absTotal - parts.reduce((acc, x) => acc + x, 0);

  const order = exact
    .map((x, index) => ({ index, fraction: x.minus(x.floor()) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);
  for (const { index } of order) {
    if (remaining === 0) break;
    parts[index] += 1;
    remaining -= 1;
  }
  return parts.map((x) => x * sign);
}
