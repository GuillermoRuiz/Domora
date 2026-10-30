import { Prisma } from '../prisma/client';

type Db = Pick<Prisma.TransactionClient, 'journalLine' | 'chartAccount'>;

/**
 * Lo ejecutado del ejercicio frente al presupuesto (fase 8c). Funciones
 * sobre Prisma para que las usen también servicios que no inyectan el
 * libro (alertas, centros de coste); LedgerQueryService las expone.
 */
/**
 * Ejecutado del ejercicio por cuenta, para comparar con el presupuesto:
 * gasto (debe − haber) en las de gastos, ingreso (haber − debe) en las de
 * ingresos. Solo asientos corrientes: la apertura, la regularización y el
 * cierre no son gasto ni ingreso del año.
 */
export async function executedByAccount(
  db: Db,
  estateIds: string[],
  fiscalYear: number,
  accountIds?: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (estateIds.length === 0 || accountIds?.length === 0) return new Map();
  const rows = await db.journalLine.groupBy({
    by: ['accountId'],
    where: {
      estateId: { in: estateIds },
      fiscalYear,
      entryType: 'standard',
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    },
    _sum: { debit: true, credit: true },
  });
  const natures = await db.chartAccount.findMany({
    where: { id: { in: rows.map((r) => r.accountId) } },
    select: { id: true, nature: true },
  });
  const natureOf = new Map(natures.map((a) => [a.id, a.nature]));
  return new Map(
    rows.map((r) => {
      const debit = r._sum.debit ?? new Prisma.Decimal(0);
      const credit = r._sum.credit ?? new Prisma.Decimal(0);
      const value =
        natureOf.get(r.accountId) === 'income'
          ? credit.minus(debit)
          : debit.minus(credit);
      return [r.accountId, value];
    }),
  );
}

/** Gasto del ejercicio por centro de coste (líneas de gastos con centro, asientos corrientes). */
export async function executedByCostCentre(
  db: Db,
  estateIds: string[],
  fiscalYear: number,
  costCentreIds?: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (estateIds.length === 0 || costCentreIds?.length === 0) return new Map();
  const rows = await db.journalLine.groupBy({
    by: ['costCentreId'],
    where: {
      estateId: { in: estateIds },
      fiscalYear,
      entryType: 'standard',
      costCentreId: costCentreIds ? { in: costCentreIds } : { not: null },
      account: { nature: 'expense' },
    },
    _sum: { debit: true, credit: true },
  });
  return new Map(
    rows.map((r) => [
      r.costCentreId!,
      (r._sum.debit ?? new Prisma.Decimal(0)).minus(
        r._sum.credit ?? new Prisma.Decimal(0),
      ),
    ]),
  );
}
