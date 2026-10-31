import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { currentFiscalYears, resolveScope } from './manager-scope';

export type PerformanceStatus = 'al_dia' | 'con_incidencias';

export interface PerformanceRow {
  /** Posición en el ranking completo de las fincas del gestor (1 = la que más factura). */
  rank: number;
  estateId: string;
  name: string;
  color: string | null;
  /** Euros emitidos en el ejercicio vigente (con derramas, sin anulados). */
  billed: number;
  /** Propiedades con un recibo devuelto o un impago ya vencido (D21). */
  incidents: number;
  status: PerformanceStatus;
}

export interface PerformanceRanking {
  /** Las 10 que más facturan. */
  items: PerformanceRow[];
  /** La finca elegida si no está entre las 10, con la posición que ocupa (D33). */
  selected: PerformanceRow | null;
  /** Fincas totales del gestor (para «Ver todas»). */
  total: number;
}

export const RANKING_SIZE = 10;

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * «Rendimiento por comunidad». El orden es SIEMPRE el de todas las fincas del gestor por
 * volumen facturado del ejercicio (de momento es el único criterio, D14); elegir una finca
 * no cambia el ranking, solo la señala o la añade como fila extra si no entra en el Top 10.
 */
@Injectable()
export class ManagerPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EstateAccessService,
  ) {}

  async ranking(
    user: AuthenticatedUser,
    selectedEstateId?: string,
    now: Date = new Date(),
  ): Promise<PerformanceRanking> {
    // Validar la finca elegida (403 si es ajena) y trabajar siempre sobre todas las del gestor.
    if (selectedEstateId) resolveScope(this.access, user, selectedEstateId);
    const today = startOfUtcDay(now);
    const estates = await this.prisma.estate.findMany({
      where: { id: { in: user.estateIds }, deletedAt: null },
      select: { id: true, name: true, color: true },
    });
    if (!estates.length) return { items: [], selected: null, total: 0 };
    const ids = estates.map((e) => e.id);

    const [billed, incidents] = await Promise.all([
      this.billedByEstate(ids, today),
      this.incidentsByEstate(ids, today),
    ]);
    const rows = estates
      .map((e) => ({
        estateId: e.id,
        name: e.name,
        color: e.color,
        billed: billed.get(e.id) ?? 0,
        incidents: incidents.get(e.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.billed - a.billed ||
          a.name.localeCompare(b.name, 'es') ||
          a.estateId.localeCompare(b.estateId),
      )
      .map((r, i): PerformanceRow => ({
        ...r,
        rank: i + 1,
        status: r.incidents === 0 ? 'al_dia' : 'con_incidencias',
      }));

    const items = rows.slice(0, RANKING_SIZE);
    const selected =
      selectedEstateId && !items.some((r) => r.estateId === selectedEstateId)
        ? (rows.find((r) => r.estateId === selectedEstateId) ?? null)
        : null;
    return { items, selected, total: rows.length };
  }

  /** Euros emitidos por finca dentro de su ejercicio vigente. */
  private async billedByEstate(
    ids: string[],
    today: Date,
  ): Promise<Map<string, number>> {
    const years = await currentFiscalYears(this.prisma, ids, today);
    const groups = new Map<string, { start: Date; end: Date; ids: string[] }>();
    for (const y of years) {
      const key = `${y.start.toISOString()}|${y.end.toISOString()}`;
      const group = groups.get(key) ?? { start: y.start, end: y.end, ids: [] };
      group.ids.push(y.estateId);
      groups.set(key, group);
    }
    const result = new Map<string, number>();
    const parts = await Promise.all(
      [...groups.values()].map((g) =>
        this.prisma.accountingReceipt.groupBy({
          by: ['estateId'],
          where: {
            estateId: { in: g.ids },
            accrualDate: { gte: g.start, lte: g.end },
            status: { not: 'Anulado' },
          },
          _sum: { amount: true },
        }),
      ),
    );
    for (const part of parts)
      for (const row of part)
        result.set(
          row.estateId,
          Math.round(Number(row._sum.amount ?? 0) * 100) / 100,
        );
    return result;
  }

  /** Propiedades distintas con un recibo devuelto o un impago ya vencido, por finca. */
  private async incidentsByEstate(
    ids: string[],
    today: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.accountingReceipt.groupBy({
      by: ['estateId', 'propertyId'],
      where: {
        estateId: { in: ids },
        outstanding: { gt: 0 },
        OR: [
          { status: 'Devuelto' },
          { status: { in: ['Pendiente', 'Parcial'] }, dueDate: { lt: today } },
        ],
      },
    });
    const result = new Map<string, number>();
    for (const r of rows)
      result.set(r.estateId, (result.get(r.estateId) ?? 0) + 1);
    return result;
  }
}
