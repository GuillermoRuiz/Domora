import { issuesOfEstate } from '../../issues/issue-estate';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_ISSUE_STATUSES } from '../../issues/issue-status.constants';
import {
  annualizedContractCost,
  contractStatus,
} from '../../suppliers/contract-rules';
import { supplierSpend } from '../../suppliers/supplier-report-query';
import type { ReportData, ReportInput, ReportScope } from '../reporting.types';
import {
  checkLimit,
  date,
  dateRange,
  day,
  endDay,
  int,
  money,
  REPORT_LIMIT,
  resolutionDurationDays,
  sum,
  table,
  text,
} from './report-rules';

@Injectable()
export class OperationsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async executiveFacts(scope: ReportScope, asOf: string, days = 30) {
    const cut = endDay(asOf);
    const [issues, contracts] = await Promise.all([
      this.prisma.issue.findMany({
        where: {
          ...issuesOfEstate(scope.estateIds),
          createdAt: { lte: cut },
        },
        select: {
          createdAt: true,
          status: true,
          deletedAt: true,
          timeline: {
            where: { toStatus: { not: null } },
            select: { date: true, fromStatus: true, toStatus: true },
            orderBy: { date: 'asc' },
          },
        },
        take: REPORT_LIMIT + 1,
      }),
      this.prisma.supplierContract.findMany({
        where: {
          estateId: { in: scope.estateIds },
          startDate: { lte: date(asOf) },
          endDate: {
            gte: date(asOf),
            lte: new Date(date(asOf).getTime() + 30 * 86400000),
          },
          OR: [{ cancelledAt: null }, { cancelledAt: { gt: cut } }],
        },
        select: { id: true },
        take: REPORT_LIMIT + 1,
      }),
    ]);
    checkLimit(issues);
    checkLimit(contracts);
    let open = 0,
      old = 0,
      unknown = 0;
    for (const issue of issues) {
      if (issue.deletedAt && issue.deletedAt <= cut) continue;
      const before = issue.timeline.filter((t) => t.date <= cut);
      const after = issue.timeline.find((t) => t.date > cut);
      const state =
        before.at(-1)?.toStatus ??
        after?.fromStatus ??
        (day(new Date()) === asOf ? issue.status : null);
      if (!state) {
        unknown++;
        continue;
      }
      if (ACTIVE_ISSUE_STATUSES.includes(state)) {
        open++;
        if (cut.getTime() - issue.createdAt.getTime() > days * 86400000) old++;
      }
    }
    return {
      openIssues: open,
      oldIssues: old,
      expiringContracts: contracts.length,
      warnings: unknown
        ? [
            `${unknown} incidencias legacy sin transición estructurada suficiente para reconstruir su estado al corte, excluidas del recuento histórico.`,
          ]
        : [],
    };
  }

  async run(
    key: string,
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const names = new Map(scope.estates.map((e) => [e.id, e.name]));
    const supplierFilter = input.filters?.supplierId;
    if (['contracts-active', 'contracts-expiring'].includes(key)) {
      const cut = date(input.asOf ?? day(new Date()));
      const end = new Date(
        cut.getTime() + (input.filters?.days ?? 30) * 86400000,
      );
      const rows = checkLimit(
        await this.prisma.supplierContract.findMany({
          where: {
            estateId: { in: scope.estateIds },
            ...(supplierFilter ? { supplierId: supplierFilter } : {}),
            startDate: { lte: cut },
            OR: [
              { cancelledAt: null },
              { cancelledAt: { gt: new Date(cut.getTime() + 86399999) } },
            ],
            ...(key === 'contracts-expiring'
              ? { endDate: { gte: cut, lte: end } }
              : {
                  AND: [{ OR: [{ endDate: null }, { endDate: { gte: cut } }] }],
                }),
          },
          select: {
            estateId: true,
            serviceType: true,
            startDate: true,
            endDate: true,
            cancelledAt: true,
            costAmount: true,
            costFrequency: true,
            currency: true,
            supplier: { select: { name: true } },
          },
          take: REPORT_LIMIT + 1,
          orderBy: { endDate: 'asc' },
        }),
      );
      const unknown = rows.filter((r) => r.costAmount === null).length;
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('supplier', 'Proveedor'),
              text('service', 'Servicio'),
              text('start', 'Inicio'),
              text('end', 'Vencimiento'),
              text('status', 'Estado al corte'),
              text('cost', 'Coste contractual'),
              text('frequency', 'Periodicidad'),
              text('currency', 'Divisa'),
              text('annual', 'Equivalente anual'),
            ],
            rows.map((r) => ({
              estate: names.get(r.estateId),
              supplier: r.supplier.name,
              service: r.serviceType,
              start: day(r.startDate),
              end: day(r.endDate),
              status: contractStatus(
                {
                  ...r,
                  cancelledAt:
                    r.cancelledAt && r.cancelledAt <= cut
                      ? r.cancelledAt
                      : null,
                },
                cut,
              ),
              cost: r.costAmount?.toNumber(),
              frequency: r.costFrequency,
              currency: r.currency,
              annual: annualizedContractCost(
                r.costAmount,
                r.costFrequency,
              )?.toNumber(),
            })),
          ),
        ],
        warnings: [
          'Sin sumar divisas ni extrapolar costes únicos/OTROS. El equivalente anual es orientativo, no gasto ejecutado. Los contratos con inicio futuro se excluyen.',
          ...(unknown
            ? [
                `${unknown} contratos sin coste registrado; no se interpreta como cero.`,
              ]
            : []),
        ],
      };
    }
    if (key === 'suppliers') {
      const rows = checkLimit(
        await this.prisma.supplier.findMany({
          where: {
            estateId: { in: scope.estateIds },
            ...(supplierFilter ? { id: supplierFilter } : {}),
          },
          select: { estateId: true, name: true, category: true, status: true },
          orderBy: { name: 'asc' },
          take: REPORT_LIMIT + 1,
        }),
      );
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('name', 'Proveedor'),
              text('category', 'Categoría'),
              text('status', 'Estado'),
            ],
            rows.map((r) => ({ ...r, estate: names.get(r.estateId) })),
          ),
        ],
      };
    }
    if (key === 'supplier-invoices') {
      const rows = checkLimit(
        await this.prisma.supplierInvoice.findMany({
          where: {
            estateId: { in: scope.estateIds },
            ...(supplierFilter ? { supplierId: supplierFilter } : {}),
            status: { not: 'Anulada' },
            issueDate: dateRange(input.from, input.to),
          },
          select: {
            estateId: true,
            number: true,
            issueDate: true,
            receivedDate: true,
            dueDate: true,
            status: true,
            total: true,
            outstanding: true,
            supplier: { select: { name: true } },
          },
          orderBy: { issueDate: 'asc' },
          take: REPORT_LIMIT + 1,
        }),
      );
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('supplier', 'Proveedor'),
              text('number', 'Factura'),
              text('issue', 'Emisión'),
              text('accrual', 'Fecha contable'),
              text('due', 'Vencimiento'),
              text('status', 'Estado actual'),
              money('total', 'Total factura'),
              money('outstanding', 'Pendiente actual'),
            ],
            rows.map((r) => ({
              estate: names.get(r.estateId),
              supplier: r.supplier.name,
              number: r.number,
              issue: day(r.issueDate),
              accrual: day(r.receivedDate),
              due: day(r.dueDate),
              status: r.status,
              total: r.total.toNumber(),
              outstanding: r.outstanding.toNumber(),
            })),
          ),
        ],
        warnings: [
          'Selección por fecha de factura inclusiva; estado y pendiente son actuales. Se excluyen facturas anuladas según su estado actual.',
        ],
      };
    }
    if (key === 'supplier-spend') {
      const basis = input.filters?.spendBasis ?? 'invoiced';
      const rows = checkLimit(
        await supplierSpend(
          this.prisma,
          scope.estateIds,
          basis,
          input.from ? date(input.from) : undefined,
          input.to ? date(input.to) : undefined,
          supplierFilter,
        ),
      );
      const suppliers = await this.prisma.supplier.findMany({
        where: {
          estateId: { in: scope.estateIds },
          id: { in: rows.map((r) => r.supplierId) },
        },
        select: { id: true, name: true },
      });
      const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
      const label = {
        invoiced: 'Facturado vigente (total con IVA)',
        accrued: 'Devengado contable (cuentas de gasto)',
        paid: 'Pagado neto de deshacer pagos',
      }[basis];
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('supplier', 'Proveedor'),
              money('amount', label),
            ],
            rows.map((r) => ({
              estate: names.get(r.estateId),
              supplier: supplierNames.get(r.supplierId),
              amount: r.amount.toNumber(),
            })),
          ),
        ],
        summary: [
          {
            label,
            value: sum(rows.map((r) => r.amount)).toNumber(),
            format: 'money',
          },
        ],
        warnings: [
          basis === 'invoiced'
            ? 'Fecha de factura; excluye anuladas según estado actual. No es un snapshot histórico del estado de facturas.'
            : basis === 'accrued'
              ? 'Asientos corrientes de facturas de proveedor y sus anulaciones, fecha contable y naturaleza gasto. Excluye otros gastos sin factura enlazada.'
              : 'Movimientos de pago a proveedores y sus deshacer por fecha contable, importe entregado neto; no incluye retenciones ingresadas por separado.',
        ],
      };
    }
    if (
      [
        'issues',
        'issues-by-estate',
        'issues-by-category',
        'issues-by-supplier',
        'issue-resolution',
      ].includes(key)
    ) {
      const assignmentMode = input.filters?.assignmentMode ?? 'current';
      const issues = checkLimit(
        await this.prisma.issue.findMany({
          where: {
            deletedAt: null,
            ...issuesOfEstate(scope.estateIds),
            createdAt: dateRange(input.from, input.to),
            ...(supplierFilter
              ? {
                  providerAssignments: {
                    some: {
                      supplierId: supplierFilter,
                      ...(assignmentMode === 'current'
                        ? { unassignedAt: null }
                        : {}),
                    },
                  },
                }
              : {}),
          },
          select: {
            id: true,
            ref: true,
            title: true,
            status: true,
            type: true,
            createdAt: true,
            resolvedAt: true,
            closedAt: true,
            estateId: true,
            timeline: {
              where: { toStatus: { not: null } },
              select: { date: true, fromStatus: true, toStatus: true },
              orderBy: { date: 'asc' },
            },
            providerAssignments: {
              where: {
                ...(assignmentMode === 'current' ? { unassignedAt: null } : {}),
                ...(supplierFilter ? { supplierId: supplierFilter } : {}),
              },
              select: {
                id: true,
                supplierId: true,
                providerNameSnapshot: true,
                assignedAt: true,
                unassignedAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: REPORT_LIMIT + 1,
        }),
      );
      const warnings = [
        'Periodo por fecha de creación de la incidencia. Estado mostrado actual; sin SLA ni coste final inferidos.',
      ];
      if (key === 'issue-resolution') {
        const rows = issues.map((i) => ({
          estate: names.get(i.estateId!),
          ref: i.ref,
          status: i.status,
          created: day(i.createdAt),
          resolved: day(i.resolvedAt),
          closed: day(i.closedAt),
          days: resolutionDurationDays(i.createdAt, i.timeline),
        }));
        const known = rows.filter((r) => r.days !== null);
        return {
          sections: [
            table(
              [
                text('estate', 'Comunidad'),
                text('ref', 'Incidencia'),
                text('status', 'Estado'),
                text('created', 'Creación'),
                text('resolved', 'Resolución'),
                text('closed', 'Cierre'),
                text('days', 'Días hasta última resolución'),
              ],
              rows,
            ),
          ],
          warnings: [
            ...warnings,
            `${rows.length - known.length} incidencias sin transición de resolución/cierre estructurada suficiente, o actualmente reabiertas; excluidas de la media. No se usa updatedAt. Duración desde creación hasta última resolución efectiva tras reaperturas.`,
          ],
          summary: known.length
            ? [
                {
                  label: 'Tiempo medio de resolución (días)',
                  value: Number(
                    (
                      known.reduce((n, r) => n + r.days!, 0) / known.length
                    ).toFixed(2),
                  ),
                  format: 'number',
                },
              ]
            : [],
        };
      }
      if (key === 'issues')
        return {
          sections: [
            table(
              [
                text('estate', 'Comunidad'),
                text('ref', 'Referencia'),
                text('title', 'Incidencia'),
                text('type', 'Categoría'),
                text('status', 'Estado'),
                text('created', 'Creación'),
              ],
              issues.map((i) => ({
                estate: names.get(i.estateId!),
                ref: i.ref,
                title: i.title,
                type: i.type,
                status: i.status,
                created: day(i.createdAt),
              })),
            ),
          ],
          warnings,
        };
      const grouped = new Map<
        string,
        { group: string; estate: string; ids: Set<string>; open: Set<string> }
      >();
      for (const issue of issues) {
        const groups =
          key === 'issues-by-estate'
            ? [
                {
                  id: issue.estateId!,
                  name: names.get(issue.estateId!)!,
                },
              ]
            : key === 'issues-by-category'
              ? [{ id: issue.type, name: issue.type }]
              : issue.providerAssignments.length
                ? issue.providerAssignments.map((a) => ({
                    id: a.supplierId ?? a.id,
                    name: a.providerNameSnapshot,
                  }))
                : [{ id: 'unassigned', name: 'Sin proveedor' }];
        for (const group of groups) {
          const id = `${issue.estateId}:${group.id}`;
          const row = grouped.get(id) ?? {
            group: group.name,
            estate: names.get(issue.estateId!)!,
            ids: new Set<string>(),
            open: new Set<string>(),
          };
          row.ids.add(issue.id);
          if (ACTIVE_ISSUE_STATUSES.includes(issue.status))
            row.open.add(issue.id);
          grouped.set(id, row);
        }
      }
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text(
                'group',
                key === 'issues-by-category'
                  ? 'Categoría'
                  : key === 'issues-by-supplier'
                    ? 'Proveedor'
                    : 'Comunidad',
              ),
              int('count', 'Incidencias'),
              int('open', 'Abiertas actualmente'),
            ],
            [...grouped.values()].map((r) => ({
              estate: r.estate,
              group: r.group,
              count: r.ids.size,
              open: r.open.size,
            })),
          ),
        ],
        warnings: [
          ...warnings,
          ...(key === 'issues-by-supplier'
            ? [
                assignmentMode === 'history'
                  ? 'Asignaciones históricas: una incidencia puede figurar en varios proveedores; no sumar filas como incidencias únicas.'
                  : 'Asignación actual, no el proveedor a una fecha pasada.',
              ]
            : []),
        ],
      };
    }
    throw new NotFoundException('Informe de operaciones desconocido.');
  }
}
