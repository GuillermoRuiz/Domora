import { issuesOfEstate } from '../issues/issue-estate';
import { Injectable } from '@nestjs/common';
import { Prisma, type AiJob } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { toCents } from '../ledger/money';
import { AiBatchService } from './ai-batch.service';
import { weeklyIntelligence, type WeeklyIntelligenceSource } from './use-cases';
import { AiConfigService } from './ai-config.service';
import { json, type Signal } from './ai.types';
import { madridDate, madridWeekKey } from './weekly-clock';
export function ageDays(created: Date, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - created.getTime()) / 86400000));
}
const pct = (n: number) => String(n).replace('.', ',');
const eur = (cents: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );
export function percentOver(actual: number, budget: number): number | null {
  return budget > 0
    ? Math.round(((actual - budget) * 10000) / budget) / 100
    : null;
}
@Injectable()
export class WeeklyAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batch: AiBatchService,
    private readonly config: AiConfigService,
  ) {}
  async process(job: AiJob, now = new Date()) {
    const week =
      /^weekly:[^:]+:(\d{4}-\d{2}-\d{2})$/.exec(job.dedupeKey)?.[1] ??
      madridWeekKey(now);
    const prior = await this.prisma.aiWeeklySnapshot.findUnique({
      where: { estateId_weekKey: { estateId: job.estateId, weekKey: week } },
    });
    if (prior) {
      if (prior.status === 'pending') await this.submit(prior);
      return;
    }
    const calculated = await this.snapshot(job.estateId, now);
    const snapshot = await this.prisma.aiWeeklySnapshot.upsert({
      where: { estateId_weekKey: { estateId: job.estateId, weekKey: week } },
      create: {
        estateId: job.estateId,
        weekKey: week,
        snapshotAt: now,
        snapshot: json(calculated.facts),
        signals: json(calculated.signals),
      },
      update: {},
    });
    await this.submit(snapshot);
  }
  private async submit(snapshot: {
    id: string;
    estateId: string;
    snapshot: Prisma.JsonValue;
    signals: Prisma.JsonValue;
  }) {
    if (!this.config.enabled) return;
    await this.batch.enqueue(
      snapshot.estateId,
      weeklyIntelligence,
      snapshot.id,
      `weekly:${snapshot.estateId}:${snapshot.id}`,
      snapshot.snapshot as WeeklyIntelligenceSource,
      { signalCount: (snapshot.signals as unknown as Signal[]).length },
    );
  }
  async snapshot(estateId: string, at: Date) {
    return this.prisma.$transaction(
      async (tx) => {
        const estate = await tx.estate.findFirst({
          where: {
            id: estateId,
            deletedAt: null,
            administrator: { deletedAt: null },
          },
          select: { id: true, name: true },
        });
        if (!estate) throw new Error('SNAPSHOT_ESTATE_INACTIVE');
        const today = madridDate(at),
          year = Number(today.slice(0, 4)),
          date = new Date(`${today}T00:00:00Z`),
          from = new Date(`${year}-01-01T00:00:00Z`),
          lastWeek = new Date(at.getTime() - 7 * 86400000);
        const issueWhere = {
          deletedAt: null,
          ...issuesOfEstate(estateId),
        };
        const [
          openCount,
          resolvedWeek,
          ageing,
          waiting,
          recurring,
          contracts,
          unpaidCount,
          unpaidTotal,
          _unpaid,
          bankGroups,
          balances,
          expense,
          budget,
          events,
        ] = await Promise.all([
          tx.issue.count({
            where: {
              ...issueWhere,
              status: { in: ACTIVE_ISSUE_STATUSES },
            },
          }),
          // updatedAt is the only available completion marker; clearly labeled below.
          tx.issue.count({
            where: {
              ...issueWhere,
              status: { in: ['Resuelta', 'Cerrada'] },
              updatedAt: { gte: lastWeek, lte: at },
            },
          }),
          tx.issue.findMany({
            where: {
              ...issueWhere,
              status: { in: ACTIVE_ISSUE_STATUSES },
              createdAt: { lte: new Date(at.getTime() - 7 * 86400000) },
            },
            orderBy: { createdAt: 'asc' },
            take: 30,
            select: { id: true, ref: true, createdAt: true },
          }),
          tx.issueWait.findMany({
            where: {
              issue: { ...issueWhere, status: { in: ACTIVE_ISSUE_STATUSES } },
              party: 'provider',
              endedAt: null,
              startedAt: { lte: new Date(at.getTime() - 72 * 3600000) },
            },
            orderBy: { startedAt: 'asc' },
            take: 100,
            select: { issueId: true, startedAt: true },
          }),
          Promise.resolve(0),
          tx.supplierContract.findMany({
            where: {
              estateId,
              cancelledAt: null,
              endDate: {
                gte: date,
                lte: new Date(date.getTime() + 60 * 86400000),
              },
            },
            orderBy: { endDate: 'asc' },
            take: 30,
            select: { id: true, endDate: true, serviceType: true },
          }),
          tx.supplierInvoice.count({
            where: { estateId, cancelledAt: null, outstanding: { gt: 0 } },
          }),
          tx.supplierInvoice.aggregate({
            where: { estateId, cancelledAt: null, outstanding: { gt: 0 } },
            _sum: { outstanding: true },
          }),
          tx.supplierInvoice.findMany({
            where: {
              estateId,
              cancelledAt: null,
              outstanding: { gt: 0 },
              dueDate: { lt: date },
            },
            orderBy: { dueDate: 'asc' },
            take: 20,
            select: {
              id: true,
              number: true,
              dueDate: true,
              outstanding: true,
            },
          }),
          tx.bankExtractEntry.groupBy({
            by: ['bankAccountId'],
            where: { estateId, reconciliationGroupId: null },
            _count: { _all: true },
          }),
          tx.journalLine.aggregate({
            where: {
              estateId,
              date: { lte: date },
              account: { estateId, systemRole: { in: ['bank', 'cash'] } },
            },
            _sum: { debit: true, credit: true },
          }),
          tx.journalLine.aggregate({
            where: {
              estateId,
              date: { gte: from, lte: date },
              entryType: 'standard',
              account: { estateId, nature: 'expense' },
            },
            _sum: { debit: true, credit: true },
          }),
          tx.budgetItem.aggregate({
            where: {
              estateId,
              fiscalYear: year,
              account: { estateId, nature: 'expense' },
            },
            _sum: { budgeted: true },
          }),
          tx.propertyEvent.findMany({
            where: {
              estateId,
              date: { gte: date, lte: new Date(date.getTime() + 7 * 86400000) },
            },
            orderBy: { date: 'asc' },
            take: 20,
            select: { id: true, title: true, date: true },
          }),
        ]);
        const signals: Signal[] = [];
        const add = (
          type: Signal['entity_type'],
          id: string,
          fact: string,
          priority: Signal['priority'],
          link: string,
        ) =>
          signals.push({
            id: `${type}:${id}:${signals.length}`,
            entity_type: type,
            entity_id: id,
            fact,
            priority,
            link,
          });
        for (const issue of ageing)
          add(
            'issue',
            issue.id,
            `${issue.ref}: incidencia abierta desde hace ${ageDays(issue.createdAt, at)} días.`,
            'medium',
            `/b/incidencias/${issue.id}`,
          );
        for (const message of waiting) {
          const issue = await tx.issue.findFirst({
            where: {
              id: message.issueId,
              ...issueWhere,
              status: { in: ACTIVE_ISSUE_STATUSES },
            },
          });
          if (!issue) continue;
          if (
            !signals.some(
              (s) =>
                s.entity_id === issue.id && s.fact.includes('sin respuesta'),
            )
          )
            add(
              'issue',
              issue.id,
              `${issue.ref}: proveedor sin respuesta durante ${Math.floor((at.getTime() - message.startedAt.getTime()) / 3600000)} horas.`,
              'high',
              `/b/incidencias/${issue.id}`,
            );
        }
        for (const contract of contracts)
          add(
            'contract',
            contract.id,
            `${contract.serviceType}: contrato vence en ${Math.round((contract.endDate!.getTime() - date.getTime()) / 86400000)} días.`,
            'medium',
            `/b/estates/${estateId}?tab=providers&contract=${contract.id}`,
          );
        // La conciliación bancaria es trabajo de contabilidad, no un aviso para propietarios: sus cifras siguen en `accounting` pero no se emite señal.
        for (const event of events)
          add(
            'event',
            event.id,
            `${event.title}: evento ${event.date.toISOString().slice(0, 10)}.`,
            'low',
            `/b/estates/${estateId}?event=${event.id}`,
          );
        const spending =
            toCents(expense._sum.debit ?? 0) -
            toCents(expense._sum.credit ?? 0),
          annualBudget = toCents(budget._sum.budgeted ?? 0),
          over = percentOver(spending, annualBudget);
        if (over !== null && over > 0)
          add(
            'estate',
            estateId,
            `Gastos contabilizados hasta ${today}: ${eur(spending)}, ${pct(over)}% por encima del presupuesto ANUAL (${eur(annualBudget)}).`,
            'high',
            `/b/accounting/${estateId}?tab=budget`,
          );
        // Gasto por partida: qué partidas superan su presupuesto anual y cuáles suben respecto a los 30 días anteriores.
        const day = 86400000,
          w1 = new Date(date.getTime() - 29 * day),
          w0 = new Date(date.getTime() - 59 * day),
          w0end = new Date(date.getTime() - 30 * day);
        const spendWhere = (gte: Date, lte: Date) => ({
          estateId,
          date: { gte, lte },
          entryType: 'standard' as const,
          account: { estateId, nature: 'expense' as const },
        });
        const net = (g: {
          _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null };
        }) => toCents(g._sum.debit ?? 0) - toCents(g._sum.credit ?? 0);
        const [ytdRows, recentRows, priorRows, budgetRows] = await Promise.all([
          tx.journalLine.groupBy({
            by: ['accountId'],
            where: spendWhere(from, date),
            _sum: { debit: true, credit: true },
          }),
          tx.journalLine.groupBy({
            by: ['accountId'],
            where: spendWhere(w1, date),
            _sum: { debit: true, credit: true },
          }),
          tx.journalLine.groupBy({
            by: ['accountId'],
            where: spendWhere(w0, w0end),
            _sum: { debit: true, credit: true },
          }),
          tx.budgetItem.findMany({
            where: {
              estateId,
              fiscalYear: year,
              account: { estateId, nature: 'expense' },
            },
            select: { accountId: true, budgeted: true },
          }),
        ]);
        const ids = [
          ...new Set(
            [...ytdRows, ...recentRows, ...priorRows].map((r) => r.accountId),
          ),
        ];
        const accountRows = ids.length
          ? await tx.chartAccount.findMany({
              where: { id: { in: ids }, estateId },
              select: { id: true, name: true, shortName: true },
            })
          : [];
        const label = (id: string) => {
          const a = accountRows.find((x) => x.id === id);
          return a ? a.shortName || a.name : 'Partida';
        };
        const byAccount = new Map<
          string,
          { ytd: number; recent: number; prior: number; budget: number }
        >();
        const slot = (id: string) => {
          let v = byAccount.get(id);
          if (!v) {
            v = { ytd: 0, recent: 0, prior: 0, budget: 0 };
            byAccount.set(id, v);
          }
          return v;
        };
        for (const r of ytdRows) slot(r.accountId).ytd = net(r);
        for (const r of recentRows) slot(r.accountId).recent = net(r);
        for (const r of priorRows) slot(r.accountId).prior = net(r);
        for (const r of budgetRows)
          slot(r.accountId).budget = toCents(r.budgeted);
        const categories = [...byAccount.entries()].map(([id, v]) => ({
          id,
          name: label(id),
          ...v,
        }));
        const budgetLink = `/b/accounting/${estateId}?tab=budget`;
        categories
          .filter((c) => c.budget > 0 && c.ytd > c.budget)
          .map((c) => ({ c, over: percentOver(c.ytd, c.budget)! }))
          .sort((a, b) => b.over - a.over)
          .slice(0, 4)
          .forEach(({ c, over }) =>
            add(
              'estate',
              estateId,
              `Partida «${c.name}»: ${eur(c.ytd)} gastados este año frente a ${eur(c.budget)} presupuestados (${pct(over)}% más).`,
              over >= 10 ? 'high' : 'medium',
              budgetLink,
            ),
          );
        categories
          .filter((c) => c.prior >= 10000 && c.recent > c.prior * 1.2)
          .sort((a, b) => b.recent - b.prior - (a.recent - a.prior))
          .slice(0, 4)
          .forEach((c) =>
            add(
              'estate',
              estateId,
              `Partida «${c.name}»: ${eur(c.recent)} en los últimos 30 días, un ${Math.round(((c.recent - c.prior) * 100) / c.prior)}% más que en los 30 días anteriores (${eur(c.prior)}).`,
              'medium',
              budgetLink,
            ),
          );
        // Dónde se va el dinero: las dos partidas con más peso en el gasto del año (informativo).
        const ytdTotal = categories.reduce((t, c) => t + Math.max(c.ytd, 0), 0);
        if (ytdTotal > 0)
          [...categories]
            .filter((c) => c.ytd > 0)
            .sort((a, b) => b.ytd - a.ytd)
            .slice(0, 2)
            .forEach((c) =>
              add(
                'estate',
                estateId,
                `Partida «${c.name}»: ${eur(c.ytd)} gastados este año, el ${Math.round((c.ytd * 100) / ytdTotal)}% del gasto total.`,
                'low',
                budgetLink,
              ),
            );
        const expenseByCategory = categories
          .sort((a, b) => b.ytd - a.ytd)
          .slice(0, 8)
          .map((c) => ({
            category: c.name,
            year_to_date_cents: c.ytd,
            annual_budget_cents: c.budget > 0 ? c.budget : null,
            last_30_days_cents: c.recent,
            previous_30_days_cents: c.prior,
          }));
        const sorted = signals
          .sort(
            (a, b) =>
              ({ high: 0, medium: 1, low: 2 })[a.priority] -
              { high: 0, medium: 1, low: 2 }[b.priority],
          )
          .slice(0, 100);
        return {
          facts: {
            community_id: estate.id,
            snapshot_at: at.toISOString(),
            as_of_calendar_date: today,
            time_zone: 'Europe/Madrid',
            finance: {
              currency: 'EUR',
              cash_and_bank_balance_cents:
                toCents(balances._sum.debit ?? 0) -
                toCents(balances._sum.credit ?? 0),
              year_to_date_expense_cents: spending,
              annual_expense_budget_cents: annualBudget,
              over_annual_budget_percent: over,
              expense_by_category: expenseByCategory,
            },
            incidents: {
              open: openCount,
              resolved_or_closed_updated_last_7_days: resolvedWeek,
              duplicate_reports_linked: recurring,
            },
            contracts: {
              upcoming_expiry_examples: contracts.length,
              example_limit: 30,
            },
            accounting: {
              unpaid_invoices: unpaidCount,
              outstanding_cents: toCents(unpaidTotal._sum.outstanding ?? 0),
              unreconciled_transactions: bankGroups.reduce(
                (s, b) => s + b._count._all,
                0,
              ),
            },
            signals: sorted,
            coverage: {
              signals_emitted: sorted.length,
              signal_limit: 100,
              ageing_example_limit: 30,
              provider_wait_example_limit: 100,
              overdue_invoice_example_limit: 20,
              upcoming_event_example_limit: 20,
            },
            limitations: [
              'No historical balance trend stored in this snapshot.',
              'Resolved-week uses updatedAt because there is no resolvedAt field.',
              'Contract/event signals are bounded examples; counts are not total portfolio counts.',
              'Annual budget comparison is not a prorated budget comparison.',
            ],
          },
          signals: sorted,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30000,
      },
    );
  }
}
