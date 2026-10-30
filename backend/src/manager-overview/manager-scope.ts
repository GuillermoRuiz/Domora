import type { AuthenticatedUser } from '../auth/auth.types';
import type { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Fincas sobre las que responde la «Vista general» del gestor: la finca pedida
 * (comprobando que el usuario puede verla) o, sin ella, todas las suyas.
 * `estateIds` del JWT es la única fuente de verdad; una finca ajena es 403.
 */
export function resolveScope(
  access: EstateAccessService,
  user: AuthenticatedUser,
  estateId?: string,
): string[] {
  if (estateId) {
    access.assertAccess(estateId, user);
    return [estateId];
  }
  return [...user.estateIds];
}

/** Fecha situada `months` meses antes (o después, si es negativo) de `from`, recortando el día a fin de mes. */
export function shiftMonths(from: Date, months: number): Date {
  const target = new Date(from.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Ejercicio vigente de una finca (el que contiene hoy). */
export interface EstateYear {
  estateId: string;
  year: number;
  start: Date;
  end: Date;
}

/**
 * Ejercicio vigente de cada finca: su fila de `fiscal_years` que contiene hoy; si todavía
 * no tiene fila, el año natural en curso (como hace el módulo de ejercicios).
 */
export async function currentFiscalYears(prisma: PrismaService, ids: string[], today: Date): Promise<EstateYear[]> {
  const rows = await prisma.fiscalYear.findMany({
    where: { estateId: { in: ids }, startDate: { lte: today }, endDate: { gte: today } },
    select: { estateId: true, year: true, startDate: true, endDate: true },
    orderBy: { year: 'desc' },
  });
  const byEstate = new Map<string, EstateYear>();
  for (const r of rows) {
    if (!byEstate.has(r.estateId)) byEstate.set(r.estateId, { estateId: r.estateId, year: r.year, start: r.startDate, end: r.endDate });
  }
  const year = today.getUTCFullYear();
  return ids.map(
    (id) => byEstate.get(id) ?? { estateId: id, year, start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) },
  );
}
