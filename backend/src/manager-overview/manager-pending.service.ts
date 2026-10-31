import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveScope } from './manager-scope';

export type PendingUrgency = 'urgente' | 'hoy' | 'esta_semana';
export type PendingKind =
  'receipt' | 'installation' | 'inspection' | 'contract' | 'adhesion';

/** Destino de la fila: el frontend lo traduce a la pantalla que permite gestionarla. */
export interface PendingTarget {
  section: 'cuotas' | 'instalaciones' | 'proveedores' | 'solicitudes';
  estateId: string;
  /** Propiedad, instalación, proveedor o solicitud concreta, si la hay. */
  refId: string | null;
}

export interface PendingItem {
  /** Estable entre llamadas (clave del `track`). */
  id: string;
  kind: PendingKind;
  urgency: PendingUrgency;
  title: string;
  detail: string;
  estateId: string;
  estateName: string;
  /** Fecha de referencia (vencimiento, envío…), AAAA-MM-DD. */
  date: string | null;
  /** Euros, solo para cuotas. */
  amount: number | null;
  /** Elementos de seguridad: desempatan primero. */
  safety: boolean;
  target: PendingTarget;
}

export interface PendingToday {
  /** Todos los pendientes, no solo los devueltos: es el número de la cabecera. */
  total: number;
  items: PendingItem[];
}

/** Tope de filas que viajan al cliente; `total` cuenta siempre todas. */
export const PENDING_LIMIT = 200;

const DAY_MS = 86_400_000;
const RANK: Record<PendingUrgency, number> = {
  urgente: 0,
  hoy: 1,
  esta_semana: 2,
};
/** Instalaciones cuyo fallo es un riesgo para las personas. */
const SAFETY_CATEGORIES = new Set(['Ascensor', 'PCI', 'Electricidad']);

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);
const euros = (n: number) =>
  n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

/** Cuota vencida: >60 días urgente, 31–60 hoy, 1–30 esta semana. */
export function receiptUrgency(daysOverdue: number): PendingUrgency {
  return daysOverdue > 60
    ? 'urgente'
    : daysOverdue > 30
      ? 'hoy'
      : 'esta_semana';
}
/** Inspección: vencida urgente, ≤7 días hoy, ≤30 esta semana; si no, no entra. */
export function inspectionUrgency(daysLeft: number): PendingUrgency | null {
  return daysLeft < 0
    ? 'urgente'
    : daysLeft <= 7
      ? 'hoy'
      : daysLeft <= 30
        ? 'esta_semana'
        : null;
}
/** Contrato: vencido o ≤7 días urgente, ≤14 hoy, ≤30 esta semana; si no, no entra. */
export function contractUrgency(daysLeft: number): PendingUrgency | null {
  return daysLeft <= 7
    ? 'urgente'
    : daysLeft <= 14
      ? 'hoy'
      : daysLeft <= 30
        ? 'esta_semana'
        : null;
}
/** Solicitud de alta: >7 días urgente, >2 hoy, el resto esta semana. */
export function adhesionUrgency(ageDays: number): PendingUrgency {
  return ageDays > 7 ? 'urgente' : ageDays > 2 ? 'hoy' : 'esta_semana';
}

/** Urgencia, luego seguridad primero, luego la fecha más antigua, luego el mayor importe. */
export function comparePending(a: PendingItem, b: PendingItem): number {
  return (
    RANK[a.urgency] - RANK[b.urgency] ||
    Number(b.safety) - Number(a.safety) ||
    (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31') ||
    (b.amount ?? 0) - (a.amount ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * «Pendientes de hoy» de la vista general del gestor. Las reglas son las
 * recomendadas por la investigación (D17), aplicadas a todas las inspecciones
 * (D30). La «solicitud de presupuesto» queda fuera hasta que exista (D25).
 */
@Injectable()
export class ManagerPendingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EstateAccessService,
  ) {}

  async pendingToday(
    user: AuthenticatedUser,
    estateId?: string,
    now: Date = new Date(),
  ): Promise<PendingToday> {
    const ids = resolveScope(this.access, user, estateId);
    if (!ids.length) return { total: 0, items: [] };
    const today = startOfUtcDay(now);
    const estates = await this.prisma.estate.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true },
    });
    const names = new Map(estates.map((e) => [e.id, e.name]));
    const live = [...names.keys()];

    const groups = await Promise.all([
      this.receipts(live, names, today),
      this.installations(live, names),
      this.inspections(live, names, today),
      this.contracts(live, names, today),
      this.adhesions(live, names, today),
    ]);
    const all = groups.flat().sort(comparePending);
    return { total: all.length, items: all.slice(0, PENDING_LIMIT) };
  }

  /** Una fila por propiedad con cuotas vencidas; la antigüedad es la de la más vieja. */
  private async receipts(
    ids: string[],
    names: Map<string, string>,
    today: Date,
  ): Promise<PendingItem[]> {
    const rows = await this.prisma.accountingReceipt.findMany({
      where: {
        estateId: { in: ids },
        status: { in: ['Pendiente', 'Devuelto', 'Parcial'] },
        dueDate: { lt: today },
        outstanding: { gt: 0 },
      },
      select: {
        estateId: true,
        propertyId: true,
        outstanding: true,
        dueDate: true,
        property: { select: { ref: true, floor: true, door: true } },
      },
    });
    const byProperty = new Map<
      string,
      { estateId: string; label: string; amount: number; oldest: Date }
    >();
    for (const r of rows) {
      const due = r.dueDate as Date;
      const label =
        r.property.ref ??
        [r.property.floor && `${r.property.floor}º`, r.property.door]
          .filter(Boolean)
          .join(' ');
      const acc = byProperty.get(r.propertyId);
      if (acc) {
        acc.amount += Number(r.outstanding);
        if (due < acc.oldest) acc.oldest = due;
      } else {
        byProperty.set(r.propertyId, {
          estateId: r.estateId,
          label,
          amount: Number(r.outstanding),
          oldest: due,
        });
      }
    }
    return [...byProperty.entries()].map(([propertyId, v]) => {
      const days = daysBetween(v.oldest, today);
      const amount = Math.round(v.amount * 100) / 100;
      return {
        id: `receipt:${propertyId}`,
        kind: 'receipt' as const,
        urgency: receiptUrgency(days),
        title: 'Cuotas vencidas sin cobrar',
        detail: `${names.get(v.estateId)} · ${v.label} · ${euros(amount)} · ${days} días`,
        estateId: v.estateId,
        estateName: names.get(v.estateId) as string,
        date: isoDay(v.oldest),
        amount,
        safety: false,
        target: {
          section: 'cuotas' as const,
          estateId: v.estateId,
          refId: propertyId,
        },
      };
    });
  }

  /** Instalaciones fuera de servicio: siempre urgentes. */
  private async installations(
    ids: string[],
    names: Map<string, string>,
  ): Promise<PendingItem[]> {
    const rows = await this.prisma.asset.findMany({
      where: { estateId: { in: ids }, operationalStatus: 'fuera_de_servicio' },
      select: {
        id: true,
        estateId: true,
        name: true,
        category: true,
        updatedAt: true,
      },
    });
    return rows.map((a) => ({
      id: `installation:${a.id}`,
      kind: 'installation' as const,
      urgency: 'urgente' as const,
      title: `${a.name} fuera de servicio`,
      detail: `${names.get(a.estateId)} · ${a.category}`,
      estateId: a.estateId,
      estateName: names.get(a.estateId) as string,
      date: isoDay(a.updatedAt),
      amount: null,
      safety: SAFETY_CATEGORIES.has(a.category),
      target: {
        section: 'instalaciones' as const,
        estateId: a.estateId,
        refId: a.id,
      },
    }));
  }

  private async inspections(
    ids: string[],
    names: Map<string, string>,
    today: Date,
  ): Promise<PendingItem[]> {
    const rows = await this.prisma.regulatoryInspection.findMany({
      where: {
        estateId: { in: ids },
        status: { in: ['planificada', 'citada', 'vencida'] },
        nextDueDate: { not: null },
      },
      select: {
        id: true,
        estateId: true,
        status: true,
        nextDueDate: true,
        asset: { select: { name: true, category: true } },
        inspectionType: { select: { name: true } },
      },
    });
    const items: PendingItem[] = [];
    for (const r of rows) {
      const due = r.nextDueDate as Date;
      const left = daysBetween(today, due);
      const urgency =
        r.status === 'vencida' ? 'urgente' : inspectionUrgency(left);
      if (!urgency) continue;
      items.push({
        id: `inspection:${r.id}`,
        kind: 'inspection',
        urgency,
        title:
          left < 0
            ? `${r.inspectionType.name} vencida`
            : `${r.inspectionType.name} próxima`,
        detail: `${names.get(r.estateId)} · ${r.asset.name} · ${left < 0 ? `hace ${-left} días` : left === 0 ? 'hoy' : `en ${left} días`}`,
        estateId: r.estateId,
        estateName: names.get(r.estateId) as string,
        date: isoDay(due),
        amount: null,
        safety: SAFETY_CATEGORIES.has(r.asset.category),
        target: { section: 'instalaciones', estateId: r.estateId, refId: r.id },
      });
    }
    return items;
  }

  /** Contratos que vencen en 30 días o lo hicieron en los últimos 30 (los más viejos ya no son una tarea de hoy). */
  private async contracts(
    ids: string[],
    names: Map<string, string>,
    today: Date,
  ): Promise<PendingItem[]> {
    const rows = await this.prisma.supplierContract.findMany({
      where: {
        estateId: { in: ids },
        cancelledAt: null,
        endDate: {
          gte: new Date(today.getTime() - 30 * DAY_MS),
          lte: new Date(today.getTime() + 30 * DAY_MS),
        },
      },
      select: {
        id: true,
        estateId: true,
        serviceType: true,
        endDate: true,
        supplierId: true,
        supplier: { select: { name: true } },
      },
    });
    const items: PendingItem[] = [];
    for (const c of rows) {
      const end = c.endDate as Date;
      const left = daysBetween(today, end);
      const urgency = contractUrgency(left);
      if (!urgency) continue;
      items.push({
        id: `contract:${c.id}`,
        kind: 'contract',
        urgency,
        title:
          left < 0
            ? `Contrato de ${c.serviceType} vencido`
            : `Contrato de ${c.serviceType} por vencer`,
        detail: `${names.get(c.estateId)} · ${c.supplier.name} · ${left < 0 ? `hace ${-left} días` : left === 0 ? 'hoy' : `en ${left} días`}`,
        estateId: c.estateId,
        estateName: names.get(c.estateId) as string,
        date: isoDay(end),
        amount: null,
        safety: false,
        target: {
          section: 'proveedores',
          estateId: c.estateId,
          refId: c.supplierId,
        },
      });
    }
    return items;
  }

  private async adhesions(
    ids: string[],
    names: Map<string, string>,
    today: Date,
  ): Promise<PendingItem[]> {
    const rows = await this.prisma.adhesionRequest.findMany({
      where: { estateId: { in: ids }, status: 'pending' },
      select: {
        id: true,
        estateId: true,
        submittedAt: true,
        user: { select: { fullName: true } },
      },
    });
    return rows.map((r) => ({
      id: `adhesion:${r.id}`,
      kind: 'adhesion' as const,
      urgency: adhesionUrgency(
        daysBetween(startOfUtcDay(r.submittedAt), today),
      ),
      title: 'Solicitud de alta de propietario',
      detail: `${names.get(r.estateId)} · ${r.user.fullName}`,
      estateId: r.estateId,
      estateName: names.get(r.estateId) as string,
      date: isoDay(r.submittedAt),
      amount: null,
      safety: false,
      target: {
        section: 'solicitudes' as const,
        estateId: r.estateId,
        refId: r.id,
      },
    }));
  }
}
