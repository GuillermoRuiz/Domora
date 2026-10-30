import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveScope } from './manager-scope';

export type MilestoneKind = 'meeting' | 'inspection' | 'contract';

export interface MilestoneItem {
  /** Estable entre llamadas (clave del `track`). */
  id: string;
  kind: MilestoneKind;
  title: string;
  estateId: string;
  estateName: string;
  /** Junta: instante ISO; revisión y contrato: AAAA-MM-DD. */
  date: string;
  target: { section: 'juntas' | 'instalaciones' | 'proveedores'; estateId: string; refId: string };
}

export interface MilestonesResult {
  items: MilestoneItem[];
}

/** Ventana de «Próximos hitos» (D11): los 30 días siguientes, sin «Ver todas». */
export const MILESTONE_DAYS = 30;
/** Tope de filas que viajan al cliente (la ventana de 30 días ya acota casi todo). */
export const MILESTONE_LIMIT = 100;

const DAY_MS = 86_400_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * «Próximos hitos» de la vista general: juntas convocadas, revisiones planificadas
 * (la cita si la hay, si no el próximo vencimiento) y vencimientos de contratos de
 * proveedor, todo dentro de los próximos 30 días. Lo ya vencido NO es un hito:
 * va a «Pendientes de hoy». La renovación de seguros queda para el plan «Datos
 * generales» (D27).
 */
@Injectable()
export class ManagerMilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EstateAccessService,
  ) {}

  async milestones(user: AuthenticatedUser, estateId?: string, now: Date = new Date()): Promise<MilestonesResult> {
    const ids = resolveScope(this.access, user, estateId);
    if (!ids.length) return { items: [] };
    const today = startOfUtcDay(now);
    const horizon = new Date(today.getTime() + (MILESTONE_DAYS + 1) * DAY_MS - 1);
    const estates = await this.prisma.estate.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true } });
    const names = new Map(estates.map((e) => [e.id, e.name]));
    const live = [...names.keys()];
    const nameOf = (id: string) => names.get(id) as string;

    const [meetings, inspections, contracts] = await Promise.all([
      this.prisma.meeting.findMany({
        where: { estateId: { in: live }, status: 'convocada', scheduledAt1: { gte: now, lte: horizon } },
        select: { id: true, estateId: true, title: true, scheduledAt1: true },
      }),
      this.prisma.regulatoryInspection.findMany({
        where: {
          estateId: { in: live },
          status: { in: ['planificada', 'citada'] },
          OR: [{ appointmentDate: { not: null } }, { nextDueDate: { not: null } }],
        },
        select: {
          id: true, estateId: true, appointmentDate: true, nextDueDate: true,
          asset: { select: { name: true } }, inspectionType: { select: { name: true } },
        },
      }),
      this.prisma.supplierContract.findMany({
        where: { estateId: { in: live }, cancelledAt: null, endDate: { gte: today, lte: horizon } },
        select: { id: true, estateId: true, serviceType: true, endDate: true, supplier: { select: { name: true } } },
      }),
    ]);

    const rows: Array<MilestoneItem & { sort: number }> = [
      ...meetings.map((m) => ({
        id: `meeting:${m.id}`,
        kind: 'meeting' as const,
        title: m.title,
        estateId: m.estateId,
        estateName: nameOf(m.estateId),
        date: m.scheduledAt1.toISOString(),
        target: { section: 'juntas' as const, estateId: m.estateId, refId: m.id },
        sort: m.scheduledAt1.getTime(),
      })),
      ...inspections.flatMap((i) => {
        const due = i.appointmentDate ?? i.nextDueDate;
        if (!due || due < today || due > horizon) return [];
        return [{
          id: `inspection:${i.id}`,
          kind: 'inspection' as const,
          title: `${i.inspectionType.name} · ${i.asset.name}`,
          estateId: i.estateId,
          estateName: nameOf(i.estateId),
          date: isoDay(due),
          target: { section: 'instalaciones' as const, estateId: i.estateId, refId: i.id },
          sort: due.getTime(),
        }];
      }),
      ...contracts.map((c) => ({
        id: `contract:${c.id}`,
        kind: 'contract' as const,
        title: `Vence el contrato de ${c.supplier.name} (${c.serviceType})`,
        estateId: c.estateId,
        estateName: nameOf(c.estateId),
        date: isoDay(c.endDate as Date),
        target: { section: 'proveedores' as const, estateId: c.estateId, refId: c.id },
        sort: (c.endDate as Date).getTime(),
      })),
    ];
    return {
      items: rows
        .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
        .slice(0, MILESTONE_LIMIT)
        .map(({ sort: _sort, ...item }) => item),
    };
  }
}
