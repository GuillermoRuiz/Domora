import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { currentFiscalYears, resolveScope, type EstateYear } from './manager-scope';

/** Euros con dos decimales. */
export interface EconomicSummary {
  /** `null` = todas las fincas del gestor. */
  estateId: string | null;
  /** Con una sola finca, su ejercicio vigente; en la vista global cada una tiene el suyo. */
  fiscalYear: number | null;
  /** Total emitido en el ejercicio (con derramas, sin anulados) = cobrado + pendiente. */
  billed: number;
  collected: number;
  pending: number;
  /** Dinero en bancos y caja (57x), a hoy. */
  treasury: number;
  /** Fondo de reserva (saldo acreedor de la 117), a hoy. */
  reserve: number;
  /** Gasto devengado del ejercicio. */
  expenses: number;
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const round2 = (d: Prisma.Decimal) => Number(d.toDecimalPlaces(2));

/**
 * «Resumen económico» de la vista general (D47). El ejercicio es el vigente de cada
 * finca (el que contiene hoy; si todavía no tiene fila, el año natural en curso, como
 * hace el módulo de ejercicios). El anillo es lo facturado en el ejercicio dividido en
 * cobrado y pendiente según el estado de cobro de esos mismos recibos, de modo que
 * cobrado + pendiente = facturado. Puede diferir de «Cuotas pendientes» (que incluye
 * deuda de ejercicios anteriores).
 */
@Injectable()
export class ManagerEconomicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EstateAccessService,
    private readonly ledgerQuery: LedgerQueryService,
  ) {}

  async summary(user: AuthenticatedUser, estateId?: string, now: Date = new Date()): Promise<EconomicSummary> {
    const ids = resolveScope(this.access, user, estateId);
    const zero = new Prisma.Decimal(0);
    if (!ids.length) {
      return { estateId: estateId ?? null, fiscalYear: null, billed: 0, collected: 0, pending: 0, treasury: 0, reserve: 0, expenses: 0 };
    }
    const today = startOfUtcDay(now);
    const years = await currentFiscalYears(this.prisma, ids, today);

    const [treasury, balances, billing, expenses] = await Promise.all([
      this.ledgerQuery.treasuryBalancesForEstates(ids),
      this.ledgerQuery.reportAccountBalances(ids, { excludeEntryTypes: LedgerQueryService.BALANCE_EXCLUDED }),
      this.billing(years),
      this.expenses(years),
    ]);

    const reserve = balances.filter((r) => r.systemRole === 'reserve_fund').reduce((s, r) => s.plus(r.balance.negated()), zero);
    const treasuryTotal = [...treasury.values()].reduce((s, v) => s.plus(v), zero);
    const pending = billing.pending;
    return {
      estateId: estateId ?? null,
      fiscalYear: ids.length === 1 ? (years[0]?.year ?? null) : null,
      billed: round2(billing.billed),
      collected: round2(billing.billed.minus(pending)),
      pending: round2(pending),
      treasury: round2(treasuryTotal),
      reserve: round2(reserve),
      expenses: round2(expenses),
    };
  }

  /** Facturado y pendiente de los recibos emitidos dentro del ejercicio de cada finca. */
  private async billing(years: EstateYear[]): Promise<{ billed: Prisma.Decimal; pending: Prisma.Decimal }> {
    const groups = new Map<string, { start: Date; end: Date; ids: string[] }>();
    for (const y of years) {
      const key = `${y.start.toISOString()}|${y.end.toISOString()}`;
      const group = groups.get(key) ?? { start: y.start, end: y.end, ids: [] };
      group.ids.push(y.estateId);
      groups.set(key, group);
    }
    let billed = new Prisma.Decimal(0);
    let pending = new Prisma.Decimal(0);
    const sums = await Promise.all(
      [...groups.values()].map((g) =>
        this.prisma.accountingReceipt.aggregate({
          where: { estateId: { in: g.ids }, accrualDate: { gte: g.start, lte: g.end }, status: { not: 'Anulado' } },
          _sum: { amount: true, outstanding: true },
        }),
      ),
    );
    for (const s of sums) {
      billed = billed.plus(s._sum.amount ?? 0);
      pending = pending.plus(s._sum.outstanding ?? 0);
    }
    return { billed, pending };
  }

  /** Gasto devengado del ejercicio de cada finca (mismo criterio que la ficha de la finca). */
  private async expenses(years: EstateYear[]): Promise<Prisma.Decimal> {
    const byYear = new Map<number, string[]>();
    for (const y of years) byYear.set(y.year, [...(byYear.get(y.year) ?? []), y.estateId]);
    const parts = await Promise.all(
      [...byYear.entries()].map(([fiscalYear, ids]) =>
        this.ledgerQuery.reportAccountBalances(ids, { fiscalYear, excludeEntryTypes: LedgerQueryService.RESULT_EXCLUDED }),
      ),
    );
    return parts
      .flat()
      .filter((r) => r.nature === 'expense')
      .reduce((s, r) => s.plus(r.debit.minus(r.credit)), new Prisma.Decimal(0));
  }
}
