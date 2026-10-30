import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ReportSection,
  TableReport,
} from '../../common/reports/table-report';
import { LedgerQueryService } from '../../ledger/ledger-query.service';
import { LedgerReportsService } from '../../ledger/reports/ledger-reports.service';
import { BudgetService } from '../../ledger/budget/budget.service';
import { JournalBookService } from '../../ledger/journal-book/journal-book.service';
import { TaxReportsService } from '../../ledger/tax/tax-reports.service';
import {
  document111,
  document190,
  document347,
} from '../../ledger/tax/tax-report-documents';
import { reportDay } from '../report-validation';
import type {
  ReportData,
  ReportInput,
  ReportScope,
  ReportSummary,
} from '../reporting.types';

const ZERO = new Prisma.Decimal(0);
const money = (key: string, header: string) => ({
  key,
  header,
  kind: 'money' as const,
});
const text = (key: string, header: string) => ({ key, header });
type Activity = Awaited<
  ReturnType<LedgerQueryService['reportAccountBalances']>
>;
const sum = <T>(rows: T[], value: (row: T) => Prisma.Decimal) =>
  rows.reduce((total, row) => total.plus(value(row)), ZERO);
const documentData = (document: TableReport): ReportData => ({
  sections: document.sections,
  warnings: [
    document.title,
    ...(document.subtitle ?? []),
    ...(document.notes ?? []),
  ],
});

/** Reporting orchestrates the accounting services; account aggregation stays in ledger. */
@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly reports: LedgerReportsService,
    private readonly budget: BudgetService,
    private readonly journal: JournalBookService,
    private readonly tax: TaxReportsService,
  ) {}

  async run(
    key: string,
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const estateId = scope.estateIds[0];
    switch (key) {
      case 'income-expenses':
      case 'income-expenses-summary':
      case 'income-expenses-monthly':
        return this.incomeExpenses(key, input, scope);
      case 'period-comparison':
        return this.comparison(input, scope);
      case 'account-by-estate':
        return this.accountByEstate(input, scope);
      case 'balances-reserve':
        return this.balances(input.asOf!, scope);
      case 'trial-balance':
        return documentData(
          this.reports.documentTrialBalance(
            await this.reports.trialBalance(
              estateId,
              input.fiscalYear!,
              scope.user,
            ),
          ),
        );
      case 'general-ledger':
        return documentData(
          this.reports.documentGeneralLedger(
            await this.reports.generalLedger(
              estateId,
              {
                accountCode: input.filters!.accountCode!,
                from: input.from,
                to: input.to,
                propertyId: input.filters?.propertyId,
                supplierId: input.filters?.supplierId,
              },
              scope.user,
            ),
          ),
        );
      case 'balance-sheet':
        return documentData(
          this.reports.documentBalanceSheet(
            await this.reports.balanceSheet(estateId, input.asOf!, scope.user),
          ),
        );
      case 'budget':
        return this.budgetOnly(input, scope);
      case 'budget-comparison':
      case 'budget-vs-actual':
        return this.budgetComparison(input, scope);
      case 'cash-settlement':
        return documentData(
          this.reports.documentCashSettlement(
            await this.reports.cashSettlement(
              estateId,
              { from: input.from!, to: input.to! },
              scope.user,
            ),
          ),
        );
      case 'journal':
        return this.journalBook(input, scope);
      case 'tax-111':
        return documentData(
          document111(
            await this.tax.model111(
              estateId,
              input.fiscalYear!,
              input.quarter! as 1 | 2 | 3 | 4,
              scope.user,
            ),
          ),
        );
      case 'tax-190':
        return documentData(
          document190(
            await this.tax.model190(estateId, input.fiscalYear!, scope.user),
          ),
        );
      case 'tax-347-draft': {
        const result = documentData(
          document347(
            await this.tax.model347(estateId, input.fiscalYear!, scope.user),
          ),
        );
        return {
          ...result,
          warnings: [
            ...(result.warnings ?? []),
            'Borrador parcial: solo compras y proveedores. No incluye ingresos de terceros ni constituye un fichero oficial AEAT.',
          ],
        };
      }
      default:
        throw new UnprocessableEntityException(
          'Informe financiero no disponible.',
        );
    }
  }

  async activity(
    input: ReportInput,
    scope: ReportScope,
    monthly = false,
  ): Promise<Activity> {
    return this.ledger.reportAccountBalances(scope.estateIds, {
      from: reportDay(input.from!),
      to: reportDay(input.to!),
      monthly,
      excludeEntryTypes: LedgerQueryService.RESULT_EXCLUDED,
    });
  }

  private financialTotals(rows: Activity) {
    const income = sum(
      rows.filter((r) => r.nature === 'income'),
      (r) => r.credit.minus(r.debit),
    );
    const expense = sum(
      rows.filter((r) => r.nature === 'expense'),
      (r) => r.debit.minus(r.credit),
    );
    return { income, expense, result: income.minus(expense) };
  }

  private summary(rows: Activity): ReportSummary[] {
    const totals = this.financialTotals(rows);
    return [
      {
        label: 'Ingresos por devengo',
        value: totals.income.toNumber(),
        format: 'money',
      },
      {
        label: 'Gastos por devengo',
        value: totals.expense.toNumber(),
        format: 'money',
      },
      {
        label: 'Resultado del periodo',
        value: totals.result.toNumber(),
        format: 'money',
      },
    ];
  }

  async incomeExpenses(
    key: string,
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const activity = await this.activity(
      input,
      scope,
      key === 'income-expenses-monthly',
    );
    const names = new Map(scope.estates.map((e) => [e.id, e.name]));
    const rows = activity.filter(
      (r) => r.nature === 'income' || r.nature === 'expense',
    );
    const detailed = key === 'income-expenses';
    let section: ReportSection;
    if (detailed) {
      section = {
        columns: [
          text('estate', 'Comunidad'),
          text('code', 'Cuenta'),
          text('name', 'Nombre'),
          text('nature', 'Naturaleza'),
          money('amount', 'Importe'),
        ],
        rows: rows.map((r) => ({
          estate: names.get(r.estateId),
          code: r.code,
          name: r.name,
          nature: r.nature === 'income' ? 'Ingreso' : 'Gasto',
          amount: (r.nature === 'income'
            ? r.credit.minus(r.debit)
            : r.balance
          ).toNumber(),
        })),
      };
    } else {
      const slots = new Map<
        string,
        { estateId: string; period: string; rows: Activity }
      >();
      for (const row of rows) {
        const id = `${row.estateId}:${row.period}`;
        if (!slots.has(id))
          slots.set(id, {
            estateId: row.estateId,
            period: row.period,
            rows: [],
          });
        slots.get(id)!.rows.push(row);
      }
      section = {
        columns: [
          text('estate', 'Comunidad'),
          ...(key === 'income-expenses-monthly' ? [text('period', 'Mes')] : []),
          money('income', 'Ingresos'),
          money('expense', 'Gastos'),
          money('result', 'Resultado'),
        ],
        rows: [...slots.values()].map((slot) => {
          const totals = this.financialTotals(slot.rows);
          return {
            estate: names.get(slot.estateId),
            period: slot.period,
            income: totals.income.toNumber(),
            expense: totals.expense.toNumber(),
            result: totals.result.toNumber(),
          };
        }),
      };
    }
    return {
      sections: [section],
      summary: this.summary(rows),
      warnings: [
        'Criterio de devengo. Rangos inclusivos por fecha contable; se excluyen regularización, cierre, apertura anual y aplicación de resultados.',
      ],
    };
  }

  private async comparison(
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const [current, previous] = await Promise.all([
      this.activity(input, scope),
      this.activity(
        { ...input, from: input.compareFrom, to: input.compareTo },
        scope,
      ),
    ]);
    const rows = scope.estates.map((estate) => {
      const a = this.financialTotals(
        current.filter((r) => r.estateId === estate.id),
      );
      const b = this.financialTotals(
        previous.filter((r) => r.estateId === estate.id),
      );
      return {
        estate: estate.name,
        income: a.income.toNumber(),
        priorIncome: b.income.toNumber(),
        expense: a.expense.toNumber(),
        priorExpense: b.expense.toNumber(),
        deviation: a.expense.minus(b.expense).toNumber(),
        variation: b.expense.isZero()
          ? null
          : a.expense
              .minus(b.expense)
              .div(b.expense)
              .mul(100)
              .toDecimalPlaces(2)
              .toNumber(),
      };
    });
    const days = (from: string, to: string) =>
      (reportDay(to).getTime() - reportDay(from).getTime()) / 86400000 + 1;
    return {
      sections: [
        {
          columns: [
            text('estate', 'Comunidad'),
            money('income', 'Ingresos A'),
            money('priorIncome', 'Ingresos B'),
            money('expense', 'Gastos A'),
            money('priorExpense', 'Gastos B'),
            money('deviation', 'Diferencia gastos A−B'),
            text('variation', 'Variación gastos %'),
          ],
          rows,
        },
      ],
      warnings: [
        'Periodos A y B inclusivos por devengo. Porcentaje no definido cuando el gasto B es cero.',
        ...(days(input.from!, input.to!) ===
        days(input.compareFrom!, input.compareTo!)
          ? []
          : [
              'Los periodos tienen distinta duración; los importes no se anualizan ni prorratean.',
            ]),
      ],
    };
  }

  private async accountByEstate(
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const code = input.filters!.accountCode!;
    const [accounts, activity] = await Promise.all([
      this.prisma.chartAccount.findMany({
        where: { estateId: { in: scope.estateIds }, code },
        select: { estateId: true, name: true },
      }),
      this.ledger.reportAccountBalances(scope.estateIds, {
        from: reportDay(input.from!),
        to: reportDay(input.to!),
        accountCode: code,
      }),
    ]);
    const accountMap = new Map(accounts.map((a) => [a.estateId, a]));
    const rows = scope.estates
      .filter((e) => accountMap.has(e.id))
      .map((estate) => {
        const lines = activity.filter((r) => r.estateId === estate.id);
        return {
          estate: estate.name,
          code,
          name: accountMap.get(estate.id)!.name,
          debit: sum(lines, (r) => r.debit).toNumber(),
          credit: sum(lines, (r) => r.credit).toNumber(),
          balance: sum(lines, (r) => r.balance).toNumber(),
        };
      });
    return {
      sections: [
        {
          columns: [
            text('estate', 'Comunidad'),
            text('code', 'Código'),
            text('name', 'Denominación'),
            money('debit', 'Debe'),
            money('credit', 'Haber'),
            money('balance', 'Movimiento neto'),
          ],
          rows,
          totals: {
            estate: 'Total cartera',
            debit: sum(activity, (r) => r.debit).toNumber(),
            credit: sum(activity, (r) => r.credit).toNumber(),
            balance: sum(activity, (r) => r.balance).toNumber(),
          },
        },
      ],
      warnings: [
        'Identidad por código exacto en cada plan de cuentas. Importes del periodo, no saldo acumulado. Incluye los tipos de asiento del Mayor existente.',
        ...(accounts.length < scope.estates.length
          ? [
              'Hay comunidades sin esta cuenta; se muestran solo las que la tienen.',
            ]
          : []),
      ],
    };
  }

  async balances(asOf: string, scope: ReportScope): Promise<ReportData> {
    const activity = await this.ledger.reportAccountBalances(scope.estateIds, {
      to: reportDay(asOf),
      excludeEntryTypes: LedgerQueryService.BALANCE_EXCLUDED,
    });
    const rows = scope.estates.map((estate) => ({
      estate: estate.name,
      treasury: sum(
        activity.filter(
          (r) => r.estateId === estate.id && r.code.startsWith('57'),
        ),
        (r) => r.balance,
      ).toNumber(),
      reserve: sum(
        activity.filter(
          (r) => r.estateId === estate.id && r.systemRole === 'reserve_fund',
        ),
        (r) => r.balance.negated(),
      ).toNumber(),
    }));
    return {
      sections: [
        {
          columns: [
            text('estate', 'Comunidad'),
            money('treasury', 'Tesorería a fecha'),
            money('reserve', 'Fondo comunitario a fecha'),
          ],
          rows,
        },
      ],
      warnings: [
        'Saldos por fecha contable; se excluyen cierre y apertura anual para evitar duplicidades. Fondo de reserva y tesorería son conceptos distintos.',
      ],
    };
  }

  private async budgetOnly(
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const rows = await this.budget.listBudget(
      scope.estateIds[0],
      input.fiscalYear!,
      scope.user,
    );
    return {
      sections: [
        {
          columns: [
            text('code', 'Cuenta'),
            text('name', 'Partida'),
            money('budgeted', 'Presupuestado'),
          ],
          rows: rows.map((row) => ({
            code: row.accountCode,
            name: row.accountLabel,
            budgeted: row.budgeted.toNumber(),
          })),
          totals: {
            name: 'Total',
            budgeted: sum(rows, (row) => row.budgeted).toNumber(),
          },
        },
      ],
    };
  }

  private async budgetComparison(
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const data = await this.reports.budgetVsActual(
      scope.estateIds[0],
      input.fiscalYear!,
      scope.user,
    );
    const document = this.reports.documentBudgetVsActual(data);
    const [items, executed] = await Promise.all([
      this.budget.listBudget(scope.estateIds[0], input.fiscalYear!, scope.user),
      this.ledger.executedByAccount(scope.estateIds, input.fiscalYear!),
    ]);
    const budgetedIds = new Set(items.map((item) => item.accountId));
    const missingIds = [...executed.keys()].filter(
      (id) => !budgetedIds.has(id) && !executed.get(id)!.isZero(),
    );
    const accounts = missingIds.length
      ? await this.prisma.chartAccount.findMany({
          where: {
            id: { in: missingIds },
            estateId: { in: scope.estateIds },
            nature: { in: ['expense', 'income'] },
          },
          select: { id: true, code: true, name: true },
        })
      : [];
    const warnings = [
      'Presupuesto del ejercicio completo; no se prorratea entre meses.',
    ];
    const sections = [...document.sections];
    sections[0] = {
      ...sections[0],
      columns: [...sections[0].columns, text('deviationPct', 'Desviación %')],
      rows: sections[0].rows.map((row) => ({
        ...row,
        deviationPct:
          Number(row.budgeted) === 0
            ? null
            : new Prisma.Decimal(String(row.executed))
                .minus(String(row.budgeted))
                .div(String(row.budgeted))
                .mul(100)
                .toDecimalPlaces(2)
                .toNumber(),
      })),
    };
    if (accounts.length) {
      warnings.push(
        'Hay ejecución sin presupuesto. Se detalla aparte y no forma parte del subtotal de partidas presupuestadas.',
      );
      sections.push({
        title: 'Ejecución sin presupuesto',
        columns: [
          text('code', 'Cuenta'),
          text('name', 'Nombre'),
          money('executed', 'Ejecutado'),
        ],
        rows: accounts.map((account) => ({
          code: account.code,
          name: account.name,
          executed: executed.get(account.id)!.toNumber(),
        })),
      });
    }
    return { sections, warnings };
  }

  private async journalBook(
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const entries: Awaited<ReturnType<JournalBookService['list']>>['items'] =
      [];
    let page = 1;
    let total = 0;
    do {
      const result = await this.journal.list(
        scope.estateIds[0],
        { from: input.from, to: input.to, page, pageSize: 200 },
        scope.user,
      );
      total = result.total;
      if (total > 10000)
        throw new UnprocessableEntityException(
          'El Diario supera 10.000 asientos. Reduce el periodo.',
        );
      entries.push(...result.items);
      page++;
    } while (entries.length < total);
    return {
      sections: [
        {
          columns: [
            text('date', 'Fecha'),
            text('number', 'Asiento'),
            text('code', 'Cuenta'),
            text('concept', 'Concepto'),
            money('debit', 'Debe'),
            money('credit', 'Haber'),
          ],
          rows: entries.flatMap((entry) =>
            entry.lines.map((line) => ({
              date: entry.date.toISOString().slice(0, 10),
              number: `${entry.fiscalYear}/${entry.number}`,
              code: line.accountCode,
              concept: line.concept ?? entry.concept,
              debit: Number(line.debit),
              credit: Number(line.credit),
            })),
          ),
        },
      ],
      warnings: [
        'Libro completo del rango solicitado; incluye todos los tipos de asiento.',
      ],
    };
  }
}
