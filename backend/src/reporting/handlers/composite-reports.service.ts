import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReportSection } from '../../common/reports/table-report';
import { reportDay } from '../report-validation';
import type {
  ReportData,
  ReportInput,
  ReportScope,
  ReportSummary,
} from '../reporting.types';
import { FinancialReportsService } from './financial-reports.service';
import { ReceiptReportsService } from './receipt-reports.service';
import { OperationsReportsService } from './operations-reports.service';

/** Deterministic composition; no model, prompt or external service participates. */
@Injectable()
export class CompositeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialReportsService,
    private readonly receipts: ReceiptReportsService,
    private readonly operations: OperationsReportsService,
  ) {}

  async run(
    key: string,
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const asOf = input.to!;
    const [results, balances, debt, operational, contracts, fiscalYear] =
      await Promise.all([
        this.financial.incomeExpenses('income-expenses', input, scope),
        this.financial.balances(asOf, scope),
        this.receipts.debtAt({ ...input, asOf }, scope),
        this.operations.executiveFacts(scope, asOf, 30),
        this.operations.run(
          'contracts-expiring',
          {
            scopeMode: input.scopeMode,
            estateIds: input.estateIds,
            asOf,
            filters: { days: 30 },
          },
          scope,
        ),
        this.prisma.fiscalYear.findFirst({
          where: {
            estateId: scope.estateIds[0],
            startDate: { lte: reportDay(input.from!) },
            endDate: { gte: reportDay(input.to!) },
          },
          select: { year: true, startDate: true, endDate: true },
        }),
      ]);
    const warnings = [
      ...(results.warnings ?? []),
      ...(balances.warnings ?? []),
      ...debt.warnings,
      ...operational.warnings,
      ...(contracts.warnings ?? []),
      'Fotografía versionada con corte contable explícito y conservación durante 30 días. Exportar esta versión reproduce sus datos; generar de nuevo crea otra versión con las fuentes vigentes, que pueden contener correcciones posteriores.',
    ];
    const pending = debt.rows.reduce(
      (total, row) => total.plus(row.balance),
      new Prisma.Decimal(0),
    );
    const overdue = debt.rows
      .filter((row) => row.bucket !== 'notDue' && row.bucket !== 'unknown')
      .reduce((total, row) => total.plus(row.balance), new Prisma.Decimal(0));
    const summary: ReportSummary[] = [
      ...(results.summary ?? []),
      {
        label: 'Pendiente al cierre',
        value: pending.toNumber(),
        format: 'money',
      },
      {
        label: 'Vencido al cierre',
        value: overdue.toNumber(),
        format: 'money',
      },
      {
        label: 'Incidencias abiertas al cierre',
        value: operational.openIssues,
        format: 'number',
      },
      {
        label: 'Abiertas con más de 30 días',
        value: operational.oldIssues,
        format: 'number',
      },
    ];
    const sections: ReportSection[] = [
      ...results.sections.map((section) => ({
        ...section,
        title: 'Ingresos y gastos del periodo',
      })),
      ...balances.sections.map((section) => ({
        ...section,
        title: 'Tesorería y fondo de reserva al cierre',
      })),
      {
        title: 'Pendiente y vencido al cierre',
        columns: [
          { key: 'label', header: 'Concepto' },
          { key: 'amount', header: 'Importe', kind: 'money' },
        ],
        rows: [
          { label: 'Pendiente total', amount: pending.toNumber() },
          { label: 'Vencido con fecha conocida', amount: overdue.toNumber() },
        ],
      },
    ];
    if (fiscalYear) {
      const budget = await this.prisma.budgetItem.findMany({
        where: { estateId: scope.estateIds[0], fiscalYear: fiscalYear.year },
        select: {
          accountId: true,
          budgeted: true,
          account: { select: { code: true, name: true } },
        },
      });
      const activity = await this.financial.activity(
        {
          ...input,
          from: fiscalYear.startDate.toISOString().slice(0, 10),
          to: asOf,
        },
        scope,
      );
      const executed = new Map(
        activity.map((row) => [
          row.accountId,
          row.nature === 'income' ? row.credit.minus(row.debit) : row.balance,
        ]),
      );
      sections.push({
        title: `Presupuesto completo del ejercicio ${fiscalYear.year}; ejecución desde ${fiscalYear.startDate.toISOString().slice(0, 10)} hasta ${asOf}`,
        columns: [
          { key: 'code', header: 'Cuenta' },
          { key: 'name', header: 'Partida' },
          { key: 'budget', header: 'Presupuesto anual', kind: 'money' },
          { key: 'actual', header: 'Ejecutado al corte', kind: 'money' },
          { key: 'variance', header: 'Desviación al corte', kind: 'money' },
        ],
        rows: budget.map((row) => ({
          code: row.account.code,
          name: row.account.name,
          budget: row.budgeted.toNumber(),
          actual: (
            executed.get(row.accountId) ?? new Prisma.Decimal(0)
          ).toNumber(),
          variance: (executed.get(row.accountId) ?? new Prisma.Decimal(0))
            .minus(row.budgeted)
            .toNumber(),
        })),
      });
      const ids = new Set(budget.map((row) => row.accountId));
      if (
        activity.some(
          (row) =>
            ['income', 'expense'].includes(row.nature) &&
            !ids.has(row.accountId) &&
            !row.balance.isZero(),
        )
      )
        warnings.push(
          'Existe ejecución sin partida presupuestada. La tabla presupuestaria no cubre todas las cuentas; el estado de resultados sí las incluye.',
        );
      warnings.push(
        'El presupuesto anual se muestra como tal: no hay presupuesto mensual aprobado ni prorrateo inventado. La desviación compara ejecución acumulada al corte con el presupuesto anual vigente.',
      );
    } else {
      warnings.push(
        'No hay un ejercicio configurado que contenga todo el periodo. No se presenta una desviación presupuestaria ni se presupone año natural.',
      );
    }
    sections.push(
      ...contracts.sections.map((section) => ({
        ...section,
        title: 'Contratos que vencen en los 30 días siguientes al cierre',
      })),
    );
    const attention: { fact: string }[] = [];
    if (overdue.greaterThan(0))
      attention.push({
        fact: 'Hay deuda vencida con fecha de vencimiento conocida.',
      });
    if (operational.oldIssues > 0)
      attention.push({
        fact: `${operational.oldIssues} incidencias seguían abiertas con más de 30 días al cierre.`,
      });
    if (operational.expiringContracts > 0)
      attention.push({
        fact: `${operational.expiringContracts} contratos vencen en los 30 días siguientes al cierre.`,
      });
    if (key === 'monthly-executive')
      sections.push({
        title: 'Elementos que requieren atención',
        columns: [{ key: 'fact', header: 'Hecho verificable' }],
        rows: attention,
        empty:
          'No se han detectado señales con estas reglas y los datos disponibles.',
      });
    return { sections, summary, warnings: [...new Set(warnings)] };
  }
}
