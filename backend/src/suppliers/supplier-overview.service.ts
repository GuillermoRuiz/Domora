import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SuppliersService, type SupplierContractStatus } from './suppliers.service';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';

/** Número de intervenciones recientes que devuelve el panel. */
const RECENT_INTERVENTIONS = 10;

export type SupplierDisplayStatus = 'activo' | 'renovar' | 'vencido' | 'baja';

export interface ContractSummary {
  id: string;
  serviceType: string;
  status: SupplierContractStatus;
  endDate: Date | null;
  daysLeft: number | null;
}

const startOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/**
 * Datos del panel de Proveedores de la finca (rol B): KPIs, una fila por
 * proveedor y las últimas intervenciones. Todo se deriva de lo que ya hay
 * (contratos, incidencias asignadas y visitas); no se guarda nada nuevo.
 */
@Injectable()
export class SupplierOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly suppliers: SuppliersService,
  ) {}

  /**
   * El contrato que resume al proveedor: primero uno vigente (el que antes
   * vence, que es el que hay que vigilar), si no el último vencido. Un
   * contrato cancelado no representa al proveedor.
   */
  private pickContract(contracts: ContractSummary[]): ContractSummary | null {
    const live = contracts
      .filter((c) => c.status === 'Activo' || c.status === 'PorVencer')
      .sort((a, b) => (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER));
    if (live.length > 0) return live[0];
    const expired = contracts
      .filter((c) => c.status === 'Vencido')
      .sort((a, b) => (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0));
    return expired[0] ?? null;
  }

  private displayStatus(supplierStatus: string, contract: ContractSummary | null): SupplierDisplayStatus {
    if (supplierStatus !== 'Activo') return 'baja';
    if (contract?.status === 'PorVencer') return 'renovar';
    if (contract?.status === 'Vencido') return 'vencido';
    return 'activo';
  }

  async getOverview(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const today = startOfTodayUtc();

    const [suppliers, contracts, openByProvider, nextVisits, recent] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { estateId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, category: true, status: true, contactName: true, phone: true, email: true },
      }),
      this.suppliers.listEstateContracts(estateId, user),
      // Incidencias activas con un proveedor asignado ahora (la asignación vigente no tiene fecha de baja).
      this.prisma.issueProviderAssignment.groupBy({
        by: ['supplierId'],
        where: {
          unassignedAt: null,
          supplier: { estateId },
          issue: { deletedAt: null, status: { in: ACTIVE_ISSUE_STATUSES } },
        },
        _count: { _all: true },
      }),
      // La visita planificada más cercana de cada proveedor, desde hoy.
      this.prisma.supplierVisit.findMany({
        where: { estateId, status: 'planificada', scheduledAt: { gte: today }, supplierId: { not: null } },
        orderBy: { scheduledAt: 'asc' },
        distinct: ['supplierId'],
        select: { id: true, supplierId: true, scheduledAt: true, purpose: true },
      }),
      this.prisma.supplierVisit.findMany({
        where: { estateId, status: 'realizada', supplierId: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: RECENT_INTERVENTIONS,
        select: {
          id: true,
          supplierId: true,
          purpose: true,
          scheduledAt: true,
          completedAt: true,
          notes: true,
          supplier: { select: { name: true, category: true } },
          asset: { select: { id: true, name: true } },
          issue: { select: { id: true, ref: true, title: true } },
        },
      }),
    ]);

    const openMap = new Map(openByProvider.map((r) => [r.supplierId, r._count._all]));
    const nextMap = new Map(nextVisits.map((v) => [v.supplierId, v]));
    const contractsBySupplier = new Map<string, ContractSummary[]>();
    for (const c of contracts) {
      const list = contractsBySupplier.get(c.supplierId) ?? [];
      list.push({ id: c.id, serviceType: c.serviceType, status: c.status, endDate: c.endDate, daysLeft: c.daysLeft });
      contractsBySupplier.set(c.supplierId, list);
    }

    const items = suppliers.map((s) => {
      const contract = this.pickContract(contractsBySupplier.get(s.id) ?? []);
      const next = nextMap.get(s.id);
      return {
        ...s,
        displayStatus: this.displayStatus(s.status, contract),
        contract,
        nextVisit: next ? { id: next.id, scheduledAt: next.scheduledAt, purpose: next.purpose } : null,
        openIssues: openMap.get(s.id) ?? 0,
      };
    });

    const liveContracts = contracts.filter((c) => c.status === 'Activo' || c.status === 'PorVencer');
    return {
      kpis: {
        totalSuppliers: suppliers.length,
        activeContracts: liveContracts.length,
        expiringContracts: liveContracts.filter((c) => c.status === 'PorVencer').length,
        openIssues: items.reduce((sum, i) => sum + i.openIssues, 0),
      },
      items,
      recentInterventions: recent.flatMap((v) => (v.supplier && v.supplierId ? [v as typeof v & { supplier: NonNullable<typeof v.supplier>; supplierId: string }] : [])).map((v) => ({
        id: v.id,
        supplierId: v.supplierId,
        supplierName: v.supplier.name,
        supplierCategory: v.supplier.category,
        purpose: v.purpose,
        scheduledAt: v.scheduledAt,
        completedAt: v.completedAt,
        notes: v.notes,
        asset: v.asset,
        issue: v.issue,
      })),
    };
  }
}
