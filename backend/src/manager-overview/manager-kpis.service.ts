import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveScope, shiftMonths } from './manager-scope';

/** Meses de la comparativa de las fichas (D35). */
export const COMPARISON_MONTHS = 6;

const ACTIVE_ISSUE_STATUSES = [
  'Abierta',
  'EnReparacion',
  'PendienteProveedor',
  'PendienteInformacion',
] as const;

/**
 * Variación frente a hace 6 meses (D44): `new` si antes no había nada y ahora sí
 * («nuevo», sin porcentaje); en cualquier otro caso, el porcentaje (0 si ambos son 0).
 */
export type KpiChange = { type: 'new' } | { type: 'percent'; value: number };

export interface KpiCard {
  value: number;
  previous: number;
  change: KpiChange;
}

export interface ManagerKpis {
  /** `null` = todas las fincas del gestor. */
  estateId: string | null;
  generatedAt: string;
  estates: KpiCard;
  activeIssues: KpiCard;
  /** Euros: saldo de clientes (430) = todo lo pendiente de cobro, derramas incluidas. */
  pendingDues: KpiCard;
  pendingRequests: KpiCard;
  upcomingMeetings: KpiCard;
}

export function buildChange(value: number, previous: number): KpiChange {
  if (previous === 0)
    return value === 0 ? { type: 'percent', value: 0 } : { type: 'new' };
  return {
    type: 'percent',
    value: Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10,
  };
}

const card = (value: number, previous: number): KpiCard => ({
  value,
  previous,
  change: buildChange(value, previous),
});

/**
 * Fichas KPI de la «Vista general» del gestor. Cada una se calcula "ahora" y
 * "hace 6 meses" (punto en el tiempo) sobre las mismas reglas, salvo «Próximas
 * juntas», que compara los 6 meses siguientes con los 6 anteriores (D45/D46).
 */
@Injectable()
export class ManagerKpisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EstateAccessService,
    private readonly ledgerQuery: LedgerQueryService,
  ) {}

  async kpis(
    user: AuthenticatedUser,
    estateId?: string,
    now: Date = new Date(),
  ): Promise<ManagerKpis> {
    const ids = resolveScope(this.access, user, estateId);
    const before = shiftMonths(now, -COMPARISON_MONTHS);
    const [
      estates,
      estatesPrev,
      issues,
      issuesPrev,
      dues,
      duesPrev,
      requests,
      requestsPrev,
      meetings,
    ] = await Promise.all([
      this.estatesAt(ids, now),
      this.estatesAt(ids, before),
      this.activeIssuesAt(ids, now),
      this.activeIssuesAt(ids, before),
      this.pendingDuesAt(ids, now),
      this.pendingDuesAt(ids, before),
      this.pendingRequestsAt(ids, now),
      this.pendingRequestsAt(ids, before),
      this.meetingsAround(ids, now),
    ]);
    return {
      estateId: estateId ?? null,
      generatedAt: now.toISOString(),
      estates: card(estates, estatesPrev),
      activeIssues: card(issues, issuesPrev),
      pendingDues: card(dues, duesPrev),
      pendingRequests: card(requests, requestsPrev),
      upcomingMeetings: card(meetings.next, meetings.previous),
    };
  }

  /** Fincas dadas de alta y no borradas en `at`. */
  private estatesAt(ids: string[], at: Date): Promise<number> {
    if (!ids.length) return Promise.resolve(0);
    return this.prisma.estate.count({
      where: {
        id: { in: ids },
        createdAt: { lte: at },
        OR: [{ deletedAt: null }, { deletedAt: { gt: at } }],
      },
    });
  }

  /**
   * Incidencias activas en `at`. Ahora: su estado actual. En el pasado: el estado
   * que dejó su última transición hasta esa fecha (sin transiciones = «Abierta»).
   */
  private async activeIssuesAt(ids: string[], at: Date): Promise<number> {
    if (!ids.length) return 0;
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n
      FROM "issues" i
      WHERE i."estate_id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND i."date" <= ${at}::date
        AND (i."deleted_at" IS NULL OR i."deleted_at" > ${at})
        AND COALESCE(
          (SELECT t."to_status"::text FROM "issue_timeline_entries" t
            WHERE t."issue_id" = i."id" AND t."to_status" IS NOT NULL AND t."date" <= ${at}
            ORDER BY t."date" DESC LIMIT 1),
          'Abierta') IN (${Prisma.join([...ACTIVE_ISSUE_STATUSES])})
    `);
    return Number(n);
  }

  /** Saldo pendiente de cobro en `at` (cuenta 430), en euros. */
  private async pendingDuesAt(ids: string[], at: Date): Promise<number> {
    const rows = await this.ledgerQuery.reportAccountBalances(ids, {
      to: at,
      accountCode: '430',
      excludeEntryTypes: LedgerQueryService.BALANCE_EXCLUDED,
    });
    const total = rows.reduce(
      (sum, row) => sum.plus(row.balance),
      new Prisma.Decimal(0),
    );
    return Number(total.toDecimalPlaces(2));
  }

  /** Solicitudes de adhesión enviadas y todavía sin aprobar ni rechazar en `at`. */
  private pendingRequestsAt(ids: string[], at: Date): Promise<number> {
    if (!ids.length) return Promise.resolve(0);
    return this.prisma.adhesionRequest.count({
      where: {
        estateId: { in: ids },
        submittedAt: { lte: at },
        OR: [{ resolvedAt: null }, { resolvedAt: { gt: at } }],
      },
    });
  }

  /** Convocadas en los 6 meses siguientes frente a las celebradas en los 6 anteriores. */
  private async meetingsAround(
    ids: string[],
    now: Date,
  ): Promise<{ next: number; previous: number }> {
    if (!ids.length) return { next: 0, previous: 0 };
    const [next, previous] = await Promise.all([
      this.prisma.meeting.count({
        where: {
          estateId: { in: ids },
          status: 'convocada',
          scheduledAt1: { gt: now, lte: shiftMonths(now, COMPARISON_MONTHS) },
        },
      }),
      this.prisma.meeting.count({
        where: {
          estateId: { in: ids },
          status: { in: ['celebrada', 'firmada'] },
          scheduledAt1: { gte: shiftMonths(now, -COMPARISON_MONTHS), lte: now },
        },
      }),
    ]);
    return { next, previous };
  }
}
