import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  renderReportPdf,
  renderReportXlsx,
  type TableReport,
} from '../common/reports/table-report';
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  findReport,
} from './definitions/report-catalog';
import { ReportScopeService } from './report-scope.service';
import { ReportAuditService } from './report-audit.service';
import { ReportSnapshotService } from './report-snapshot.service';
import { validateReportInput } from './report-validation';
import { FinancialReportsService } from './handlers/financial-reports.service';
import { PortfolioReportsService } from './handlers/portfolio-reports.service';
import { ReceiptReportsService } from './handlers/receipt-reports.service';
import { OperationsReportsService } from './handlers/operations-reports.service';
import { CompositeReportsService } from './handlers/composite-reports.service';
import type {
  ReportData,
  ReportInput,
  ReportResult,
  ReportScope,
} from './reporting.types';

const PORTFOLIO = new Set([
  'communities',
  'presidents',
  'properties',
  'owners',
  'portfolio-summary',
  'owners-coefficients',
  'meeting-participation',
]);
const RECEIPTS = new Set([
  'receipts',
  'receipts-pending',
  'receipts-by-kind',
  'debtors',
  'property-debt',
  'owner-debt',
  'debt-aging',
  'debt-by-estate',
  'fees-current',
  'fees-issued-monthly',
  'reserve-contributions',
]);
const OPERATIONS = new Set([
  'issues',
  'issues-by-estate',
  'issues-by-category',
  'issues-by-supplier',
  'issue-resolution',
  'supplier-spend',
  'suppliers',
  'supplier-invoices',
  'contracts-active',
  'contracts-expiring',
]);

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly audit: ReportAuditService,
    private readonly snapshots: ReportSnapshotService,
    private readonly financial: FinancialReportsService,
    private readonly portfolio: PortfolioReportsService,
    private readonly receipts: ReceiptReportsService,
    private readonly operations: OperationsReportsService,
    private readonly composites: CompositeReportsService,
  ) {}

  async catalog(actor: AuthenticatedUser) {
    await this.scopes.resolve(actor, { scopeMode: 'all' });
    return {
      categories: REPORT_CATEGORIES,
      reports: REPORT_CATALOG.filter((report) => report.status === 'available'),
    };
  }
  async estates(actor: AuthenticatedUser) {
    return this.scopes.listEstates(actor);
  }

  async execute(
    key: string,
    input: ReportInput,
    actor: AuthenticatedUser,
    format?: 'pdf' | 'xlsx',
    snapshotId?: string,
  ) {
    const definition = findReport(key);
    if (!definition) throw new NotFoundException('Informe no disponible.');
    const requestId = randomUUID();
    const action = format ? ('EXPORT' as const) : ('VIEW' as const);
    let scope: ReportScope | undefined;
    try {
      scope = await this.scopes.resolve(actor, input);
      validateReportInput(definition, input, scope.estateIds.length);
      await this.validateResourceFilters(input, scope);
      if (snapshotId) {
        const result = await this.snapshots.load(
          snapshotId,
          key,
          input,
          scope,
          actor.id,
        );
        if (
          result.rowCount > 50000 ||
          (format === 'pdf' && result.rowCount > 10000)
        )
          throw new UnprocessableEntityException(
            'El informe supera el tamaño permitido. Reduce el periodo o las comunidades.',
          );
        const document = format ? await this.render(result, format) : undefined;
        await this.audit.record({
          userId: actor.id,
          definition,
          input,
          scope,
          action,
          format,
          rowCount: result.rowCount,
          outcome: 'SUCCESS',
          requestId,
        });
        return { result, document, requestId };
      }
      let data: ReportData;
      if (scope.estateIds.length === 0)
        data = {
          sections: [],
          warnings: ['No hay comunidades accesibles para este ámbito.'],
        };
      else if (PORTFOLIO.has(key))
        data = await this.portfolio.run(key, input, scope);
      else if (RECEIPTS.has(key))
        data = await this.receipts.run(key, input, scope);
      else if (OPERATIONS.has(key))
        data = await this.operations.run(key, input, scope);
      else if (key === 'meeting-finance' || key === 'monthly-executive')
        data = await this.composites.run(key, input, scope);
      else data = await this.financial.run(key, input, scope);
      let result: ReportResult = {
        metadata: {
          reportKey: key,
          title: definition.title,
          generatedAt: new Date().toISOString(),
          scope: { mode: scope.mode, estates: scope.estates },
          period: {
            from: input.from,
            to: input.to,
            asOf: input.asOf,
            fiscalYear: input.fiscalYear,
            quarter: input.quarter,
            compareFrom: input.compareFrom,
            compareTo: input.compareTo,
          },
          currency: 'EUR',
          sensitivity: definition.sensitivity,
          warnings: data.warnings ?? [],
        },
        summary: data.summary ?? [],
        sections: data.sections,
        rowCount: data.sections.reduce(
          (count, section) => count + section.rows.length,
          0,
        ),
      };
      if (
        result.rowCount > 50000 ||
        (format === 'pdf' && result.rowCount > 10000)
      )
        throw new UnprocessableEntityException(
          'El informe supera el tamaño permitido. Reduce el periodo o las comunidades.',
        );
      if (key === 'meeting-finance' || key === 'monthly-executive')
        result = await this.snapshots.create(result, input, scope, actor.id);
      const document = format ? await this.render(result, format) : undefined;
      await this.audit.record({
        userId: actor.id,
        definition,
        input,
        scope,
        action,
        format,
        rowCount: result.rowCount,
        outcome: 'SUCCESS',
        requestId,
      });
      return { result, document, requestId };
    } catch (error) {
      await this.audit.record({
        userId: actor.id,
        definition,
        input,
        scope,
        action,
        format,
        outcome: error instanceof ForbiddenException ? 'DENIED' : 'FAILED',
        requestId,
      });
      throw error;
    }
  }

  private async validateResourceFilters(
    input: ReportInput,
    scope: ReportScope,
  ) {
    if (
      input.filters?.propertyId &&
      !(await this.prisma.property.findFirst({
        where: {
          id: input.filters.propertyId,
          estateId: { in: scope.estateIds },
          deletedAt: null,
        },
        select: { id: true },
      }))
    ) {
      throw new ForbiddenException(
        'La propiedad no pertenece al ámbito autorizado.',
      );
    }
    if (
      input.filters?.supplierId &&
      !(await this.prisma.supplier.findFirst({
        where: {
          id: input.filters.supplierId,
          estateId: { in: scope.estateIds },
        },
        select: { id: true },
      }))
    ) {
      throw new ForbiddenException(
        'El proveedor no pertenece al ámbito autorizado.',
      );
    }
  }

  private render(result: ReportResult, format: 'pdf' | 'xlsx') {
    const p = result.metadata.period;
    const document: TableReport = {
      title: result.metadata.title,
      fileName: `domora-${result.metadata.reportKey}-${result.metadata.generatedAt.slice(0, 10)}`,
      subtitle: [
        result.metadata.scope.estates.map((e) => e.name).join(' · '),
        ...(p.from && p.to ? [`Periodo inclusivo: ${p.from} — ${p.to}`] : []),
        ...(p.asOf ? [`Fecha de corte: ${p.asOf}`] : []),
        ...(p.fiscalYear
          ? [
              `Ejercicio: ${p.fiscalYear}${p.quarter ? ` · trimestre ${p.quarter}` : ''}`,
            ]
          : []),
        ...(p.compareFrom && p.compareTo
          ? [`Comparación: ${p.compareFrom} — ${p.compareTo}`]
          : []),
        `Generado: ${result.metadata.generatedAt}`,
        ...(result.metadata.snapshotId
          ? [
              `Versión: ${result.metadata.snapshotId}`,
              `Disponible hasta: ${result.metadata.snapshotExpiresAt}`,
            ]
          : []),
      ],
      sections: [
        ...result.summary.map((item) => ({
          title: 'Resumen',
          columns: [
            { key: 'label', header: 'Indicador' },
            {
              key: 'value',
              header: 'Valor',
              kind:
                item.format === 'money'
                  ? ('money' as const)
                  : ('text' as const),
            },
          ],
          rows: [{ label: item.label, value: item.value }],
        })),
        ...result.sections,
      ],
      notes: result.metadata.warnings,
    };
    return format === 'pdf'
      ? renderReportPdf(document)
      : renderReportXlsx(document);
  }
}
