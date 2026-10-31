import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReceiptKind } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { queryReceiptDebtAt } from '../../debtors/receipt-debt-query';

import type { ReportData, ReportInput, ReportScope } from '../reporting.types';
import {
  agingBucket,
  checkLimit,
  date,
  dateRange,
  day,
  int,
  money,
  ownerIdentity,
  REPORT_LIMIT,
  sum,
  table,
  text,
} from './report-rules';

@Injectable()
export class ReceiptReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Shared by all debt views and the deterministic composed snapshots. */
  async debtAt(
    input: ReportInput,
    scope: ReportScope,
    includeIdentity = false,
  ) {
    const cut = date(input.asOf ?? input.to ?? day(new Date()));
    const balances = await queryReceiptDebtAt(
      this.prisma,
      scope.estateIds,
      cut,
      input.filters?.propertyId,
    );
    checkLimit([...balances]);
    const receipts = checkLimit(
      await this.prisma.accountingReceipt.findMany({
        where: {
          estateId: { in: scope.estateIds },
          accrualDate: { lte: cut },
          ...(input.filters?.receiptKind
            ? { kind: input.filters.receiptKind as ReceiptKind }
            : {}),
          ...(input.filters?.propertyId
            ? { propertyId: input.filters.propertyId }
            : {}),
        },
        select: {
          id: true,
          estateId: true,
          propertyId: true,
          no: true,
          amount: true,
          dueDate: true,
          ownerUserId: includeIdentity,
          ownerNameSnapshot: includeIdentity,
          ownerTaxIdSnapshot: includeIdentity,
          ownerTaxIdCountrySnapshot: includeIdentity,
          property: { select: { ref: true } },
        },
        take: REPORT_LIMIT + 1,
        orderBy: { no: 'asc' },
      }),
    );
    let untraced = 0;
    const rows = receipts.flatMap((r) => {
      const balance = balances.get(r.id);
      if (balance === undefined) {
        untraced++;
        return [];
      }
      return balance.gt(0)
        ? [{ ...r, balance, bucket: agingBucket(r.dueDate, cut, balance)! }]
        : [];
    });
    return {
      rows,
      cut,
      warnings: [
        `Deuda reconstruida desde partidas 430 a ${day(cut)} (fecha contable inclusiva), excluidos cierre y reapertura anual. No se usa el pendiente actual para cortes históricos. Anticipos no imputados se mantienen separados de la deuda.`,
        ...(untraced
          ? [
              `${untraced} recibos sin partida 430 trazable a la fecha de corte excluidos; el resultado no cubre deuda sin trazabilidad contable.`,
            ]
          : []),
      ],
    };
  }

  async run(
    key: string,
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const names = new Map(scope.estates.map((e) => [e.id, e.name]));
    if (key === 'fees-current') {
      const rows = checkLimit(
        await this.prisma.property.findMany({
          where: {
            estateId: { in: scope.estateIds },
            deletedAt: null,
            ...(input.filters?.propertyId
              ? { id: input.filters.propertyId }
              : {}),
          },
          select: {
            estateId: true,
            ref: true,
            id: true,
            quotaMonthly: true,
            status: true,
          },
          take: REPORT_LIMIT + 1,
          orderBy: { ref: 'asc' },
        }),
      );
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('property', 'Propiedad'),
              text('status', 'Estado'),
              money('monthly', 'Cuota mensual actual'),
            ],
            rows.map((r) => ({
              estate: names.get(r.estateId!),
              property: r.ref ?? r.id,
              status: r.status,
              monthly: r.quotaMonthly.toNumber(),
            })),
          ),
        ],
        warnings: [
          'Configuración actual de Property.quotaMonthly. No representa las cuotas de ejercicios pasados ni un plan de emisión.',
        ],
      };
    }
    if (key === 'reserve-contributions') {
      const groups = await this.prisma.receiptLine.groupBy({
        by: ['receiptId'],
        where: {
          receipt: {
            estateId: { in: scope.estateIds },
            accrualDate: dateRange(input.from, input.to),
            ...(input.filters?.propertyId
              ? { propertyId: input.filters.propertyId }
              : {}),
          },
          account: { systemRole: 'reserve_fund' },
        },
        _sum: { amount: true },
      });
      checkLimit(groups);
      const receipts = checkLimit(
        await this.prisma.accountingReceipt.findMany({
          where: {
            estateId: { in: scope.estateIds },
            id: { in: groups.map((g) => g.receiptId) },
            ...(input.to
              ? {
                  OR: [
                    { cancelledAt: null },
                    { cancelEntry: { date: { gt: date(input.to) } } },
                  ],
                }
              : { cancelledAt: null }),
          },
          select: {
            id: true,
            estateId: true,
            propertyId: true,
            property: { select: { ref: true } },
          },
          take: REPORT_LIMIT + 1,
        }),
      );
      const contributions = new Map(
        groups.map((g) => [
          g.receiptId,
          new Prisma.Decimal(g._sum.amount ?? 0),
        ]),
      );
      const rows = new Map<
        string,
        { estate: string; property: string; amount: Prisma.Decimal }
      >();
      for (const r of receipts) {
        const row = rows.get(r.propertyId) ?? {
          estate: names.get(r.estateId)!,
          property: r.property.ref ?? r.propertyId,
          amount: new Prisma.Decimal(0),
        };
        row.amount = row.amount.plus(contributions.get(r.id) ?? 0);
        rows.set(r.propertyId, row);
      }
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('property', 'Propiedad'),
              money('amount', 'Aportaciones emitidas'),
            ],
            [...rows.values()].map((r) => ({
              ...r,
              amount: r.amount.toNumber(),
            })),
          ),
        ],
        warnings: [
          'Aportaciones emitidas vinculadas al desglose contable de recibos no anulados a la fecha final. No son cobros efectivos ni saldo individual: no se atribuyen usos del fondo o dotaciones por cierre a cada propiedad. Periodo por fecha contable de devengo.',
        ],
      };
    }
    if (['receipts', 'receipts-by-kind', 'fees-issued-monthly'].includes(key)) {
      const issued = key === 'fees-issued-monthly';
      const kind = input.filters?.receiptKind as ReceiptKind | undefined;
      const where: Prisma.AccountingReceiptWhereInput = {
        estateId: { in: scope.estateIds },
        ...(input.filters?.propertyId
          ? { propertyId: input.filters.propertyId }
          : {}),
        ...(kind ? { kind } : {}),
        ...(issued
          ? { issuedAt: dateRange(input.from, input.to) }
          : { accrualDate: dateRange(input.from, input.to) }),
      };
      const rows = checkLimit(
        await this.prisma.accountingReceipt.findMany({
          where,
          select: {
            id: true,
            no: true,
            estateId: true,
            propertyId: true,
            kind: true,
            amount: true,
            outstanding: true,
            status: true,
            issuedAt: true,
            accrualDate: true,
            dueDate: true,
            cancelledAt: true,
            property: { select: { ref: true } },
          },
          take: REPORT_LIMIT + 1,
          orderBy: { accrualDate: 'asc' },
        }),
      );
      if (issued || key === 'receipts-by-kind') {
        const grouped = new Map<
          string,
          {
            estate: string;
            period: string;
            kind: string;
            amount: Prisma.Decimal;
            cancelled: Prisma.Decimal;
            count: number;
          }
        >();
        for (const r of rows) {
          if (issued && !r.issuedAt) continue;
          const period = issued ? r.issuedAt!.toISOString().slice(0, 7) : '';
          const id = `${r.estateId}:${period}:${r.kind}`;
          const group = grouped.get(id) ?? {
            estate: names.get(r.estateId)!,
            period,
            kind: r.kind,
            amount: new Prisma.Decimal(0),
            cancelled: new Prisma.Decimal(0),
            count: 0,
          };
          group.amount = group.amount.plus(r.amount);
          if (r.cancelledAt) group.cancelled = group.cancelled.plus(r.amount);
          group.count++;
          grouped.set(id, group);
        }
        const unknown = issued
          ? await this.prisma.accountingReceipt.count({
              where: {
                estateId: { in: scope.estateIds },
                issuedAt: null,
                ...(input.filters?.propertyId
                  ? { propertyId: input.filters.propertyId }
                  : {}),
                ...(kind ? { kind } : {}),
              },
            })
          : 0;
        return {
          sections: [
            table(
              [
                text('estate', 'Comunidad'),
                ...(issued ? [text('period', 'Mes de emisión real')] : []),
                text('kind', 'Tipo'),
                int('count', 'Recibos'),
                money('amount', 'Emitido bruto'),
                money('cancelled', 'Anulado actualmente'),
              ],
              [...grouped.values()].map((r) => ({
                ...r,
                amount: r.amount.toNumber(),
                cancelled: r.cancelled.toNumber(),
              })),
            ),
          ],
          warnings: [
            issued
              ? 'Mes real de emisión (issuedAt), no devengo. Importes brutos emitidos; anulaciones actuales en columna separada.'
              : 'Periodo por devengo contable; importes brutos y anulaciones actuales separados.',
            ...(unknown
              ? [
                  `${unknown} recibos legacy sin issuedAt excluidos del reparto mensual; no se conoce su fecha real de emisión y no se reconstruye desde la cuota actual.`,
                ]
              : []),
          ],
        };
      }
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('property', 'Propiedad'),
              text('no', 'Recibo'),
              text('kind', 'Tipo'),
              text('issued', 'Emisión real'),
              text('accrual', 'Devengo'),
              text('due', 'Vencimiento'),
              text('status', 'Estado actual'),
              money('amount', 'Importe'),
              money('outstanding', 'Pendiente actual'),
            ],
            rows.map((r) => ({
              estate: names.get(r.estateId),
              property: r.property.ref ?? r.propertyId,
              no: r.no,
              kind: r.kind,
              issued: day(r.issuedAt),
              accrual: day(r.accrualDate),
              due: day(r.dueDate),
              status: r.status,
              amount: r.amount.toNumber(),
              outstanding: r.outstanding.toNumber(),
            })),
          ),
        ],
        warnings: [
          'Selección por devengo contable inclusivo; estado y pendiente son actuales. Emisión vacía significa fecha desconocida en datos legacy.',
        ],
      };
    }
    const debt = await this.debtAt(input, scope, key === 'owner-debt');
    const total = sum(debt.rows.map((r) => r.balance));
    const summary = [
      {
        label: 'Pendiente a fecha de corte',
        value: total.toNumber(),
        format: 'money' as const,
      },
      {
        label: 'Vencido',
        value: sum(
          debt.rows
            .filter((r) => !['notDue', 'unknown'].includes(r.bucket))
            .map((r) => r.balance),
        ).toNumber(),
        format: 'money' as const,
      },
    ];
    if (['receipts-pending', 'property-debt'].includes(key))
      return {
        summary,
        warnings: debt.warnings,
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('property', 'Propiedad'),
              text('receipt', 'Recibo'),
              text('due', 'Vencimiento'),
              text('state', 'Situación'),
              money('amount', 'Pendiente al corte'),
            ],
            debt.rows.map((r) => ({
              estate: names.get(r.estateId),
              property: r.property.ref ?? r.propertyId,
              receipt: r.no,
              due: day(r.dueDate),
              state:
                r.bucket === 'notDue'
                  ? 'No vencido'
                  : r.bucket === 'unknown'
                    ? 'Vencimiento desconocido'
                    : 'Vencido',
              amount: r.balance.toNumber(),
            })),
          ),
        ],
      };
    if (
      ['debtors', 'debt-by-estate', 'debt-aging', 'owner-debt'].includes(key)
    ) {
      const groups = new Map<
        string,
        {
          estate: string;
          name: string;
          properties: Set<string>;
          buckets: Map<string, Prisma.Decimal>;
          total: Prisma.Decimal;
        }
      >();
      for (const r of debt.rows) {
        const id =
          key === 'owner-debt'
            ? ownerIdentity({
                id: r.id,
                userId: r.ownerUserId,
                taxCountry: r.ownerTaxIdCountrySnapshot,
                taxId: r.ownerTaxIdSnapshot,
              })
            : key === 'debtors'
              ? r.propertyId
              : r.estateId;
        const row = groups.get(id) ?? {
          estate: names.get(r.estateId)!,
          name:
            key === 'owner-debt'
              ? (r.ownerNameSnapshot ?? 'Titular no identificado')
              : (r.property.ref ?? r.propertyId),
          properties: new Set<string>(),
          buckets: new Map<string, Prisma.Decimal>(),
          total: new Prisma.Decimal(0),
        };
        row.properties.add(
          `${names.get(r.estateId)} · ${r.property.ref ?? r.propertyId}`,
        );
        row.total = row.total.plus(r.balance);
        row.buckets.set(
          r.bucket,
          (row.buckets.get(r.bucket) ?? new Prisma.Decimal(0)).plus(r.balance),
        );
        groups.set(id, row);
      }
      const labels = [
        ['notDue', 'No vencido'],
        ['under30', '1–29 días'],
        ['30to60', '30–60 días'],
        ['61to90', '61–90 días'],
        ['over90', 'Más de 90 días'],
        ['unknown', 'Sin vencimiento'],
      ];
      return {
        summary,
        warnings: [
          ...debt.warnings,
          'Los tramos son disjuntos; un recibo vence después de su día de vencimiento. Sin fecha de vencimiento se muestra aparte.',
          ...(key === 'owner-debt'
            ? [
                'Identidad del titular de emisión: User.id o identificación fiscal española validada del snapshot. Nunca se atribuye deuda al propietario actual. Sin identidad verificable, recibos separados.',
              ]
            : []),
        ],
        sections: [
          table(
            [
              ...(key === 'owner-debt'
                ? [
                    text('name', 'Titular de emisión'),
                    text('properties', 'Propiedades'),
                  ]
                : [
                    text('estate', 'Comunidad'),
                    ...(key === 'debtors' ? [text('name', 'Propiedad')] : []),
                  ]),
              ...labels.map(([id, label]) => money(id, label)),
              money('total', 'Pendiente'),
            ],
            [...groups.values()].map((g) => ({
              estate: g.estate,
              name: g.name,
              properties: [...g.properties].join('; '),
              total: g.total.toNumber(),
              ...Object.fromEntries(
                labels.map(([id]) => [
                  id,
                  (g.buckets.get(id) ?? new Prisma.Decimal(0)).toNumber(),
                ]),
              ),
            })),
          ),
        ],
      };
    }
    throw new NotFoundException('Informe de cobros desconocido.');
  }
}
