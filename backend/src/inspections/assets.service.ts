import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AssetOperationalStatus, type RegulatoryInspectionStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateAssetDto } from './dto/create-asset.dto';
import type { UpdateAssetDto } from './dto/update-asset.dto';
import type { CreateInspectionTypeDto } from './dto/create-inspection-type.dto';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';

/** Una revisión "próxima" es la que cae en los siguientes 30 días. */
export const REVIEW_SOON_DAYS = 30;
/** Horizonte del calendario de revisiones: ~6 meses. */
const UPCOMING_HORIZON_DAYS = 183;
const UPCOMING_LIMIT = 50;
const PENDING_INSPECTION_STATUSES: RegulatoryInspectionStatus[] = ['planificada', 'citada', 'vencida'];

export type InstallationDisplayStatus = AssetOperationalStatus | 'revision_proxima' | 'revision_vencida';

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Activos (elementos comunes) y catálogo de tipos de inspección. Separado
 * de `InspectionsService` porque es la parte de "alta/catálogo", no de
 * flujo de trabajo — mismo criterio de reparto que Issues frente a
 * sus proveedores/adjuntos.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.asset.findMany({
      where: { estateId },
      orderBy: { name: 'asc' },
    });
  }

  async createAsset(
    estateId: string,
    dto: CreateAssetDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    if (dto.supplierId) await this.assertSupplierInEstate(estateId, dto.supplierId);
    return this.prisma.asset.create({
      data: {
        estateId,
        name: dto.name,
        category: dto.category,
        location: dto.location ?? null,
        manufacturer: dto.manufacturer ?? null,
        serialNumber: dto.serialNumber ?? null,
        notes: dto.notes ?? null,
        operationalStatus: dto.operationalStatus ?? 'operativa',
        supplierId: dto.supplierId ?? null,
      },
    });
  }

  async updateAsset(
    estateId: string,
    assetId: string,
    dto: UpdateAssetDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, estateId }, select: { id: true } });
    if (!asset) throw new NotFoundException(`Instalación ${assetId} no encontrada en esta finca.`);
    // `name` y `category` son obligatorios: un null explícito no puede borrarlos.
    if (dto.name === null || dto.category === null) {
      throw new BadRequestException('El nombre y el tipo de la instalación no se pueden vaciar.');
    }
    if (dto.supplierId) await this.assertSupplierInEstate(estateId, dto.supplierId);
    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        name: dto.name,
        category: dto.category,
        location: dto.location,
        manufacturer: dto.manufacturer,
        serialNumber: dto.serialNumber,
        notes: dto.notes,
        operationalStatus: dto.operationalStatus,
        supplierId: dto.supplierId,
      },
    });
  }

  /**
   * Panel de Instalaciones: cada activo de la finca con su proveedor, la
   * última revisión hecha, la próxima pendiente, su estado a mostrar y sus
   * incidencias activas; más el calendario de revisiones de los próximos 6
   * meses (y las ya vencidas). Solo gestión (A/B).
   *
   * Estado a mostrar: lo declarado ("en mantenimiento", "fuera de servicio")
   * manda; si no, la próxima revisión decide: vencida, próxima (≤30 días) u
   * operativa. Nada de esto se guarda: se deriva de las inspecciones.
   */
  async listInstallations(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const [assets, inspections] = await Promise.all([
      this.prisma.asset.findMany({
        where: { estateId },
        orderBy: { name: 'asc' },
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.regulatoryInspection.findMany({
        where: { estateId },
        select: {
          id: true, assetId: true, status: true, lastDoneDate: true, nextDueDate: true, appointmentDate: true,
          inspectionType: { select: { name: true } },
        },
      }),
    ]);
    const issueCounts = await this.prisma.issue.groupBy({
      by: ['assetId'],
      where: { assetId: { in: assets.map((a) => a.id) }, deletedAt: null, status: { in: ACTIVE_ISSUE_STATUSES } },
      _count: { _all: true },
    });
    const openIssuesBy = new Map(issueCounts.map((c) => [c.assetId, c._count._all]));

    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysUntil = (d: Date) => Math.round((d.getTime() - today) / DAY_MS);

    const pending = inspections
      .filter((i) => PENDING_INSPECTION_STATUSES.includes(i.status))
      .flatMap((i) => {
        const due = i.appointmentDate ?? i.nextDueDate;
        return due ? [{ ...i, due, daysLeft: daysUntil(due) }] : [];
      });

    const items = assets.map((asset) => {
      const own = inspections.filter((i) => i.assetId === asset.id);
      const lastDone = own.reduce<Date | null>((best, i) => (i.lastDoneDate && (!best || i.lastDoneDate > best) ? i.lastDoneDate : best), null);
      const next = pending.filter((i) => i.assetId === asset.id).sort((a, b) => a.due.getTime() - b.due.getTime())[0] ?? null;
      const daysLeft = next ? next.daysLeft : null;
      let displayStatus: InstallationDisplayStatus = asset.operationalStatus;
      if (asset.operationalStatus === 'operativa' && daysLeft !== null) {
        if (daysLeft < 0) displayStatus = 'revision_vencida';
        else if (daysLeft <= REVIEW_SOON_DAYS) displayStatus = 'revision_proxima';
      }
      return {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        location: asset.location,
        manufacturer: asset.manufacturer,
        serialNumber: asset.serialNumber,
        notes: asset.notes,
        operationalStatus: asset.operationalStatus,
        displayStatus,
        supplier: asset.supplier,
        lastReviewDate: lastDone ? isoDay(lastDone) : null,
        nextReviewDate: next ? isoDay(next.due) : null,
        nextReviewDaysLeft: daysLeft,
        openIssues: openIssuesBy.get(asset.id) ?? 0,
      };
    });

    const byAsset = new Map(assets.map((a) => [a.id, a]));
    const upcoming = pending
      .filter((i) => i.daysLeft <= UPCOMING_HORIZON_DAYS)
      .sort((a, b) => a.due.getTime() - b.due.getTime())
      .slice(0, UPCOMING_LIMIT)
      .map((i) => {
        const asset = byAsset.get(i.assetId)!;
        return {
          inspectionId: i.id,
          assetId: asset.id,
          assetName: asset.name,
          category: asset.category,
          location: asset.location,
          title: i.inspectionType.name,
          dueDate: isoDay(i.due),
          daysLeft: i.daysLeft,
          overdue: i.daysLeft < 0,
          supplierName: asset.supplier?.name ?? null,
        };
      });

    return { items, upcoming };
  }

  /** El proveedor tiene que ser de esta misma finca (los proveedores no se comparten entre fincas). */
  private async assertSupplierInEstate(estateId: string, supplierId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, estateId }, select: { id: true } });
    if (!supplier) throw new BadRequestException('El proveedor indicado no pertenece a esta finca.');
  }

  /** Catálogo global (estateId NULL, sembrado por migración) + los tipos personalizados de esta finca. */
  async listInspectionTypes(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.inspectionType.findMany({
      where: { OR: [{ estateId: null }, { estateId }] },
      orderBy: { name: 'asc' },
    });
  }

  async createInspectionType(
    estateId: string,
    dto: CreateInspectionTypeDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    try {
      return await this.prisma.inspectionType.create({
        data: {
          estateId,
          code: dto.code,
          name: dto.name,
          legalBasis: dto.legalBasis ?? null,
          requiresOca: dto.requiresOca ?? false,
        },
      });
    } catch (error) {
      // `code` es único dentro de esta finca (índice parcial, ver
      // schema.prisma) — un duplicado aquí es un error de negocio real, no
      // un 500 crudo.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Ya existe un tipo de inspección con el código "${dto.code}" en esta finca.`,
        );
      }
      throw error;
    }
  }
}
