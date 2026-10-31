import { issuesOfEstate } from '../issues/issue-estate';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivitySubjectType, type ReceiptStatus } from '../prisma/client';
import { AccountingService } from '../accounting/accounting.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { effectiveConvocation } from '../meetings/effective-convocation';
import { PrismaService } from '../prisma/prisma.service';
import { EXPENSE_CATEGORIES, expenseCategoryFor } from './expense-categories';

const OPEN_RECEIPT_STATUSES: ReceiptStatus[] = [
  'Pendiente',
  'Parcial',
  'Devuelto',
];
const PROPERTIES_DEFAULT_LIMIT = 5;
const PROPERTIES_MAX_LIMIT = 20;
const ACTIVITY_DEFAULT_LIMIT = 8;
const ACTIVITY_MAX_LIMIT = 30;
const MILESTONE_LIMIT = 6;
const MILESTONE_HORIZON_DAYS = 365;

/**
 * Datos del panel de la finca (rol A/B). Cada método devuelve lo que una
 * sección de la pestaña Resumen necesita ya agregado, en euros como `number`,
 * para que la pantalla no tenga que sumar ni llamar a cinco endpoints.
 */
@Injectable()
export class EstateDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly estateAccess: EstateAccessService,
    private readonly ledgerQuery: LedgerQueryService,
  ) {}

  /**
   * Juntas convocadas aún vigentes (ver effectiveConvocation), de la más próxima a la más lejana, con su fecha
   * efectiva. Dos consultas acotadas en vez de traerlas todas: las que aún tienen la primera convocatoria por
   * delante y las que están entre la primera y la segunda.
   */
  private async upcomingMeetings(
    estateId: string,
    now: Date,
    limit: number,
    horizon?: Date,
  ) {
    const select = {
      id: true,
      title: true,
      type: true,
      scheduledAt1: true,
      scheduledAt2: true,
    } as const;
    const [firstCall, secondCall] = await Promise.all([
      this.prisma.meeting.findMany({
        where: {
          estateId,
          status: 'convocada',
          scheduledAt1: { gte: now, ...(horizon && { lte: horizon }) },
        },
        select,
        orderBy: { scheduledAt1: 'asc' },
        take: limit,
      }),
      this.prisma.meeting.findMany({
        where: {
          estateId,
          status: 'convocada',
          scheduledAt1: { lt: now },
          scheduledAt2: { gte: now, ...(horizon && { lte: horizon }) },
        },
        select,
        orderBy: { scheduledAt2: 'asc' },
        take: limit,
      }),
    ]);
    return [...firstCall, ...secondCall]
      .flatMap((m) => {
        const scheduledAt = effectiveConvocation(m, now);
        return scheduledAt ? [{ ...m, scheduledAt }] : [];
      })
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .slice(0, limit);
  }

  private async assertEstate(
    estateId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { id: true },
    });
    if (!estate)
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
  }

  private resolveYear(year: number | undefined): number {
    const current = new Date().getUTCFullYear();
    if (year === undefined) return current;
    if (!Number.isInteger(year) || year < 2000 || year > current + 1) {
      throw new BadRequestException(
        'El ejercicio debe ser un año entre 2000 y el próximo.',
      );
    }
    return year;
  }

  /** Indicadores de cabecera: propiedades, saldo, incidencias, cuotas pendientes y próxima junta. */
  async summary(estateId: string, user: AuthenticatedUser) {
    // Comprueba el acceso a la finca y su existencia; de paso aporta el saldo
    // de tesorería y la morosidad que ya calcula la contabilidad.
    const accounting = await this.accounting.summary(estateId, user);

    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const byEstate = { deletedAt: null, ...issuesOfEstate(estateId) };

    const [pendingByProperty, openIssues, issuesThisYear, upcomingMeetings] =
      await Promise.all([
        this.prisma.accountingReceipt.groupBy({
          by: ['propertyId'],
          where: {
            estateId,
            status: { in: OPEN_RECEIPT_STATUSES },
            outstanding: { gt: 0 },
          },
        }),
        this.prisma.issue.count({
          where: { ...byEstate, status: { in: ACTIVE_ISSUE_STATUSES } },
        }),
        this.prisma.issue.count({
          where: { ...byEstate, date: { gte: yearStart } },
        }),
        this.upcomingMeetings(estateId, now, 1),
      ]);
    const nextMeeting = upcomingMeetings[0];

    return {
      estateId,
      units: accounting.units,
      balance: accounting.balance.toNumber(),
      pendingDues: {
        amount: accounting.delinquency.toNumber(),
        properties: pendingByProperty.length,
      },
      issues: { open: openIssues, thisYear: issuesThisYear },
      nextMeeting: nextMeeting
        ? {
            id: nextMeeting.id,
            title: nextMeeting.title,
            type: nextMeeting.type,
            scheduledAt: nextMeeting.scheduledAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * Ingresos y gastos por mes de un ejercicio (gráfico "Ingresos vs. Gastos").
   * Devuelve también los ejercicios con movimientos para el selector de año.
   */
  async cashflow(estateId: string, user: AuthenticatedUser, year?: number) {
    await this.assertEstate(estateId, user);
    const fiscalYear = this.resolveYear(year);
    const [months, fiscalYears] = await Promise.all([
      this.ledgerQuery.monthlyResult(estateId, fiscalYear),
      this.ledgerQuery.fiscalYears(estateId),
    ]);
    const years = [
      ...new Set([...fiscalYears, new Date().getUTCFullYear(), fiscalYear]),
    ].sort((a, b) => a - b);
    return {
      year: fiscalYear,
      years,
      months: months.map((m) => ({
        month: m.month,
        income: m.income.toNumber(),
        expenses: m.expenses.toNumber(),
      })),
    };
  }

  /**
   * Gastos del ejercicio por categoría (donut "Distribución de gastos"):
   * suma del saldo de cada cuenta de gasto, agrupada con `expenseCategoryFor`.
   * Solo categorías con importe positivo, de mayor a menor.
   */
  async expenseBreakdown(
    estateId: string,
    user: AuthenticatedUser,
    year?: number,
  ) {
    await this.assertEstate(estateId, user);
    const fiscalYear = this.resolveYear(year);
    const rows = await this.ledgerQuery.accountBalances(estateId, {
      fiscalYear,
      excludeEntryTypes: LedgerQueryService.RESULT_EXCLUDED,
    });
    const totals = new Map<string, number>();
    for (const row of rows.filter((r) => r.nature === 'expense')) {
      const key = expenseCategoryFor(row.code);
      totals.set(key, (totals.get(key) ?? 0) + row.balance.toNumber());
    }
    const categories = EXPENSE_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      amount: Math.round((totals.get(c.key) ?? 0) * 100) / 100,
    }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    return {
      year: fiscalYear,
      total:
        Math.round(categories.reduce((sum, c) => sum + c.amount, 0) * 100) /
        100,
      categories,
    };
  }

  /**
   * Próximos hitos de la finca: juntas convocadas, inspecciones obligatorias
   * (planificadas, citadas o ya vencidas) y vencimientos de contratos de
   * proveedor, del más cercano al más lejano. Lo vencido sale marcado
   * (`overdue`) y primero. Fechas de día (`YYYY-MM-DD`) salvo las juntas,
   * que llevan hora (ISO 8601).
   */
  async milestones(estateId: string, user: AuthenticatedUser) {
    await this.assertEstate(estateId, user);
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const horizon = new Date(
      today.getTime() + MILESTONE_HORIZON_DAYS * 86_400_000,
    );

    const [meetings, inspections, contracts] = await Promise.all([
      this.upcomingMeetings(estateId, now, MILESTONE_LIMIT, horizon),
      this.prisma.regulatoryInspection.findMany({
        where: {
          estateId,
          status: { in: ['planificada', 'citada', 'vencida'] },
          OR: [
            { appointmentDate: { not: null } },
            { nextDueDate: { not: null } },
          ],
        },
        select: {
          id: true,
          appointmentDate: true,
          nextDueDate: true,
          asset: { select: { name: true } },
          inspectionType: { select: { name: true } },
        },
      }),
      this.prisma.supplierContract.findMany({
        where: {
          estateId,
          cancelledAt: null,
          endDate: { gte: today, lte: horizon },
        },
        select: {
          id: true,
          serviceType: true,
          endDate: true,
          supplier: { select: { name: true } },
        },
        orderBy: { endDate: 'asc' },
        take: MILESTONE_LIMIT,
      }),
    ]);

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const items = [
      ...meetings.map((m) => ({
        key: `meeting:${m.id}`,
        kind: 'meeting' as const,
        title: m.title,
        date: m.scheduledAt.toISOString(),
        overdue: false,
        sort: m.scheduledAt.getTime(),
      })),
      ...inspections.flatMap((i) => {
        const due = i.appointmentDate ?? i.nextDueDate;
        if (!due || due > horizon) return [];
        return [
          {
            key: `inspection:${i.id}`,
            kind: 'inspection' as const,
            title: `${i.inspectionType.name} · ${i.asset.name}`,
            date: day(due),
            overdue: due < today,
            sort: due.getTime(),
          },
        ];
      }),
      ...contracts.map((c) => ({
        key: `contract:${c.id}`,
        kind: 'contract' as const,
        title: `Vence contrato de ${c.supplier.name} (${c.serviceType})`,
        date: day(c.endDate!),
        overdue: false,
        sort: c.endDate!.getTime(),
      })),
    ];
    return {
      items: items
        .sort((a, b) => a.sort - b.sort)
        .slice(0, MILESTONE_LIMIT)
        .map(({ sort: _sort, ...item }) => item),
    };
  }

  /**
   * Actividad reciente de la finca (lo último que ha pasado en ella), del
   * más reciente al más antiguo. Incluye las entradas del registro de la
   * finca y las de sus propiedades, aunque se grabaran solo con la propiedad.
   * `subjects` limita a ciertos tipos de actividad (p. ej. altas y cambios de propiedades).
   */
  async activity(
    estateId: string,
    user: AuthenticatedUser,
    limit?: number,
    subjects?: string[],
  ) {
    await this.assertEstate(estateId, user);
    const known = Object.values(ActivitySubjectType) as string[];
    const unknown = (subjects ?? []).filter(
      (subject) => !known.includes(subject),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Tipo de actividad desconocido: ${unknown.join(', ')}.`,
      );
    }
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_MAX_LIMIT)
    ) {
      throw new BadRequestException(
        `El límite debe estar entre 1 y ${ACTIVITY_MAX_LIMIT}.`,
      );
    }
    const rows = await this.prisma.activityLogEntry.findMany({
      where: {
        OR: [{ estateId }, { property: { estateId } }],
        ...(subjects && subjects.length > 0
          ? { subjectType: { in: subjects as ActivitySubjectType[] } }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: limit ?? ACTIVITY_DEFAULT_LIMIT,
      select: {
        id: true,
        verb: true,
        subjectType: true,
        summary: true,
        occurredAt: true,
        actorUser: { select: { fullName: true } },
        property: { select: { ref: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        verb: r.verb,
        subjectType: r.subjectType,
        summary: r.summary,
        occurredAt: r.occurredAt.toISOString(),
        actorName: r.actorUser?.fullName ?? null,
        propertyRef: r.property?.ref ?? null,
      })),
    };
  }

  /**
   * Últimas propiedades dadas de alta de la finca (tabla del Resumen), con
   * titular, cuota mensual, saldo pendiente e incidencias abiertas. El
   * estado se deriva: con incidencias abiertas > con deuda > al día.
   */
  async properties(estateId: string, user: AuthenticatedUser, limit?: number) {
    await this.assertEstate(estateId, user);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > PROPERTIES_MAX_LIMIT)
    ) {
      throw new BadRequestException(
        `El límite debe estar entre 1 y ${PROPERTIES_MAX_LIMIT}.`,
      );
    }
    const where = { estateId, deletedAt: null };
    const [total, rows] = await Promise.all([
      this.prisma.property.count({ where }),
      this.prisma.property.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { ref: 'asc' }],
        take: limit ?? PROPERTIES_DEFAULT_LIMIT,
        select: {
          id: true,
          ref: true,
          type: true,
          quotaMonthly: true,
          memberships: {
            where: {
              roleType: 'Propietario',
              status: 'linked',
              revokedAt: null,
            },
            orderBy: [{ isPrimaryContact: 'desc' }, { linkedAt: 'asc' }],
            take: 1,
            select: { user: { select: { fullName: true } } },
          },
          externalOwners: {
            where: { promotedToUserId: null },
            take: 1,
            select: { fullName: true },
          },
        },
      }),
    ]);
    const statuses = await this.statusesFor(rows.map((r) => r.id));
    return {
      total,
      items: rows.map((r) => {
        const { balance, status } = statuses.get(r.id)!;
        return {
          id: r.id,
          ref: r.ref,
          type: r.type,
          titular:
            r.memberships[0]?.user.fullName ??
            r.externalOwners[0]?.fullName ??
            null,
          quotaMonthly: r.quotaMonthly.toNumber(),
          balance,
          status,
        };
      }),
    };
  }

  /**
   * Saldo pendiente, incidencias abiertas y estado de pago de TODAS las
   * propiedades de la finca (pestaña "Propiedades"), más la fecha de su
   * último cobro (no deshecho) y desde cuándo tiene titular con cuenta.
   * Mismo criterio de estado que `properties`: incidencias > deuda > al día.
   */
  async propertyStatuses(estateId: string, user: AuthenticatedUser) {
    await this.assertEstate(estateId, user);
    const rows = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    const [statuses, payments, owners] = await Promise.all([
      this.statusesFor(ids),
      this.prisma.collection.groupBy({
        by: ['propertyId'],
        where: { propertyId: { in: ids }, undoneAt: null },
        _max: { date: true },
      }),
      this.prisma.propertyMembership.groupBy({
        by: ['propertyId'],
        where: {
          propertyId: { in: ids },
          roleType: 'Propietario',
          status: 'linked',
          revokedAt: null,
        },
        _min: { linkedAt: true },
      }),
    ]);
    const day = (d: Date | null | undefined) =>
      d ? d.toISOString().slice(0, 10) : null;
    const lastPayment = new Map(
      payments.map((p) => [p.propertyId, day(p._max.date)]),
    );
    const ownerSince = new Map(
      owners.map((o) => [o.propertyId, day(o._min.linkedAt)]),
    );
    return {
      items: rows.map((r) => ({
        propertyId: r.id,
        ...statuses.get(r.id)!,
        lastPaymentDate: lastPayment.get(r.id) ?? null,
        ownerSince: ownerSince.get(r.id) ?? null,
      })),
    };
  }

  private async statusesFor(ids: string[]) {
    const balances = await this.prisma.accountingReceipt.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: ids }, status: { in: OPEN_RECEIPT_STATUSES } },
      _sum: { outstanding: true },
    });
    const balanceBy = new Map(
      balances.map((b) => [b.propertyId, b._sum.outstanding?.toNumber() ?? 0]),
    );
    return new Map(
      ids.map((id) => {
        const balance = balanceBy.get(id) ?? 0;
        const status = balance > 0 ? ('overdue' as const) : ('ok' as const);
        return [id, { balance, status }] as const;
      }),
    );
  }
}
