import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toCents } from '../ledger/money';
import { madridDate } from '../ai/weekly-clock';

const DAY_MS = 86_400_000;
const MAX_EXPENSE_LINES = 15;
const MAX_INCOME_LINES = 10;

const eur = (cents: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );

type SumRow = {
  accountId: string;
  _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null };
};

/**
 * Cuentas AGREGADAS de una comunidad para que Domo pueda responder sobre
 * gastos, ingresos, presupuesto y saldo.
 *
 * Privacidad por construcción — este servicio no puede devolver datos de
 * personas porque nunca los consulta:
 *  - solo agrupa por cuenta contable (`groupBy accountId`): jamás por
 *    propiedad, proveedor, recibo, factura ni concepto (texto libre);
 *  - no selecciona nombres, NIF, IBAN, referencias ni importes individuales;
 *  - deja fuera el grupo 64 (gastos de personal): con una sola persona
 *    empleada, una partida de sueldos sería su salario.
 * El único dato por comunidad que sale es el que ya ve cualquier propietario
 * en las cuentas anuales: cifras por partida y totales.
 */
@Injectable()
export class CommunityFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** JSON con las cuentas agregadas del ejercicio en curso, o null si no hay apuntes ni presupuesto. */
  async summaryFor(estateId: string, at = new Date()): Promise<string | null> {
    const today = madridDate(at);
    const year = Number(today.slice(0, 4));
    const date = new Date(`${today}T00:00:00Z`);
    const from = new Date(`${year}-01-01T00:00:00Z`);
    const recentFrom = new Date(date.getTime() - 29 * DAY_MS);
    const priorFrom = new Date(date.getTime() - 59 * DAY_MS);
    const priorTo = new Date(date.getTime() - 30 * DAY_MS);

    const lines = (nature: 'expense' | 'income', gte: Date, lte: Date) => ({
      estateId,
      date: { gte, lte },
      entryType: 'standard' as const,
      account: { estateId, nature },
    });
    const group = (where: ReturnType<typeof lines>) =>
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where,
        _sum: { debit: true, credit: true },
      });

    const [expenseYtd, incomeYtd, recent, prior, budgets, treasury] =
      await Promise.all([
        group(lines('expense', from, date)),
        group(lines('income', from, date)),
        group(lines('expense', recentFrom, date)),
        group(lines('expense', priorFrom, priorTo)),
        this.prisma.budgetItem.findMany({
          where: {
            estateId,
            fiscalYear: year,
            account: { estateId, nature: 'expense' },
          },
          select: { accountId: true, budgeted: true },
        }),
        this.prisma.journalLine.aggregate({
          where: {
            estateId,
            date: { lte: date },
            account: { estateId, systemRole: { in: ['bank', 'cash'] } },
          },
          _sum: { debit: true, credit: true },
        }),
      ]);

    if (
      expenseYtd.length === 0 &&
      incomeYtd.length === 0 &&
      budgets.length === 0
    ) {
      return null;
    }

    const ids = [
      ...new Set(
        [...expenseYtd, ...incomeYtd, ...recent, ...prior, ...budgets].map(
          (r) => r.accountId,
        ),
      ),
    ];
    const accounts = ids.length
      ? await this.prisma.chartAccount.findMany({
          where: { id: { in: ids }, estateId },
          select: { id: true, code: true },
        })
      : [];
    const info = new Map(accounts.map((a) => [a.id, a]));
    // Grupo 64: gastos de personal → fuera del detalle (ver cabecera).
    const isStaff = (id: string) => (info.get(id)?.code ?? '').startsWith('64');
    // Account labels are free text and may contain names/IBANs. Never send them to the model.
    const label = (id: string) =>
      `Cuenta ${info.get(id)?.code ?? 'sin código'}`;
    const net = (r: SumRow, sign: 1 | -1) =>
      sign * (toCents(r._sum.debit ?? 0) - toCents(r._sum.credit ?? 0));
    const byId = (rows: SumRow[], sign: 1 | -1) =>
      new Map(rows.map((r) => [r.accountId, net(r, sign)]));

    const ytd = byId(expenseYtd, 1);
    const recentMap = byId(recent, 1);
    const priorMap = byId(prior, 1);
    const income = byId(incomeYtd, -1);
    const budget = new Map(
      budgets.map((b) => [b.accountId, toCents(b.budgeted)]),
    );
    const sumValues = (m: Map<string, number>) =>
      [...m.entries()]
        .filter(([id]) => !isStaff(id))
        .reduce((t, [, v]) => t + v, 0);
    const hasStaff = [
      ...ytd.keys(),
      ...budget.keys(),
      ...recentMap.keys(),
      ...priorMap.keys(),
    ].some(isStaff);

    const expenseLines = [...ytd.entries()]
      .filter(([id]) => !isStaff(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_EXPENSE_LINES)
      .map(([id, spent]) => {
        const planned = budget.get(id) ?? 0;
        return {
          partida: label(id),
          gastado_en_el_año: eur(spent),
          presupuesto_anual: planned > 0 ? eur(planned) : null,
          diferencia_con_presupuesto_pct:
            planned > 0
              ? Math.round(((spent - planned) * 1000) / planned) / 10
              : null,
          ultimos_30_dias: eur(recentMap.get(id) ?? 0),
          periodo_anterior_30_dias: eur(priorMap.get(id) ?? 0),
        };
      });

    const incomeLines = [...income.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_INCOME_LINES)
      .map(([id, v]) => ({ partida: label(id), importe_en_el_año: eur(v) }));

    const balance =
      toCents(treasury._sum.debit ?? 0) - toCents(treasury._sum.credit ?? 0);

    return JSON.stringify({
      ejercicio: year,
      datos_a_fecha: today,
      gasto_total_del_año: eur(sumValues(ytd)),
      ingresos_totales_del_año: eur(sumValues(income)),
      presupuesto_anual_de_gastos: eur(sumValues(budget)),
      // Combined totals and balance can reconstruct suppressed payroll by subtraction.
      saldo_total_de_tesoreria: hasStaff ? null : eur(balance),
      gastos_por_partida: expenseLines,
      ingresos_por_partida: incomeLines,
      nota: 'Cifras agregadas de la comunidad. Totales excluyen gastos de personal. El saldo se omite cuando hay partidas de personal. Etiquetas por código contable.',
    });
  }
}
