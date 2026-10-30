import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';
import type { CreateSupplierContractDto } from './dto/create-supplier-contract.dto';
import type { RenewSupplierContractDto } from './dto/renew-supplier-contract.dto';
import type {
  CancelSupplierContractDto,
  UpdateSupplierContractDto,
} from './dto/update-supplier-contract.dto';
import type { SupplierContract, SupplierDocumentType } from '../prisma/client';
import { annualizedContractCost, contractStatus, type SupplierContractStatus } from './contract-rules';
import { dateOrNull } from '../common/date-or-null';
export type { SupplierContractStatus } from './contract-rules';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}


/** Umbral compartido con el feed de alertas (`ResourcesService`) — un contrato entra en "Por vencer" 30 días antes de `endDate`. */
export const CONTRACT_EXPIRING_SOON_DAYS = 30;

/** Categorías que por defecto quedan fuera del 347 (art. 33.5 RGAT). */
const EXCLUDED_347_CATEGORIES = ['Suministros', 'Seguros'];

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
  ) {}

  // ── Suppliers ────────────────────────────────────────────────────────────

  /**
   * Los campos de display (lastInvoice/lastAmount/ytdSpend/pendingInvoices)
   * se derivan de las facturas (no anuladas) — nunca se almacenan. Los
   * proveedores son por finca (Apéndice H) — no se comparten entre fincas
   * de la misma gestora.
   */
  async listSuppliers(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const suppliers = await this.prisma.supplier.findMany({
      where: { estateId },
      orderBy: { name: 'asc' },
    });

    if (suppliers.length === 0) return [];

    // Antes esto era un bucle con 3 consultas por proveedor: 30 proveedores
    // eran 90 consultas secuenciales. Ahora son 3 agregados sobre el
    // conjunto completo, independientemente del número de proveedores.
    const supplierIds = suppliers.map((s) => s.id);
    const yearStart = new Date(Date.UTC(new Date().getFullYear(), 0, 1));

    const [ytdBySupplier, pendingBySupplier, recentInvoices, expiringByContract, expiringByDocument] =
      await Promise.all([
        this.prisma.supplierInvoice.groupBy({
          by: ['supplierId'],
          where: { supplierId: { in: supplierIds }, status: { not: 'Anulada' }, issueDate: { gte: yearStart } },
          _sum: { total: true },
        }),
        this.prisma.supplierInvoice.groupBy({
          by: ['supplierId'],
          where: { supplierId: { in: supplierIds }, status: { in: ['Registrada', 'Parcial'] } },
          _count: { _all: true },
        }),
        this.prisma.supplierInvoice.findMany({
          where: { supplierId: { in: supplierIds }, status: { not: 'Anulada' } },
          orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
          distinct: ['supplierId'],
          select: { supplierId: true, issueDate: true, total: true },
        }),
        this.prisma.supplierContract.findMany({
          where: {
            supplierId: { in: supplierIds },
            cancelledAt: null,
            endDate: { not: null, lte: this.expiryThreshold() },
          },
          select: { supplierId: true },
        }),
        this.prisma.supplierDocument.findMany({
          where: {
            supplierId: { in: supplierIds },
            expiresAt: { not: null, lte: this.expiryThreshold() },
          },
          select: { supplierId: true },
        }),
      ]);

    const ytdMap = new Map(ytdBySupplier.map((r) => [r.supplierId, r._sum.total]));
    const pendingMap = new Map(pendingBySupplier.map((r) => [r.supplierId, r._count._all]));
    const lastInvoiceMap = new Map(recentInvoices.map((i) => [i.supplierId, { date: i.issueDate, amount: i.total }]));
    const expiringSet = new Set([
      ...expiringByContract.map((c) => c.supplierId),
      ...expiringByDocument.map((d) => d.supplierId),
    ]);

    return suppliers.map((supplier) => {
      const last = lastInvoiceMap.get(supplier.id);
      return {
        ...supplier,
        lastInvoice: last?.date ?? null,
        lastAmount: last ? last.amount : null,
        ytdSpend: ytdMap.get(supplier.id) ?? new Prisma.Decimal(0),
        pendingInvoices: pendingMap.get(supplier.id) ?? 0,
        hasExpiringSoon: expiringSet.has(supplier.id),
      };
    });
  }

  /** Valida que el proveedor pertenezca a la finca del path antes de leer/escribir nada suyo. */
  private async assertSupplierInEstate(estateId: string, supplierId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { estateId: true },
    });
    if (!supplier || supplier.estateId !== estateId) {
      throw new NotFoundException('Proveedor no encontrado en esta finca.');
    }
  }

  async createSupplier(estateId: string, dto: CreateSupplierDto, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    if (!user.administratorId) {
      throw new ForbiddenException('Usuario sin gestora asociada.');
    }
    const supplier = await this.prisma.supplier.create({
      data: {
        ...dto,
        // Sugerencia del art. 33.5 del RGAT: suministros y seguros no van al 347.
        excludedFrom347: dto.excludedFrom347 ?? EXCLUDED_347_CATEGORIES.includes(dto.category),
        estateId,
        administratorId: user.administratorId,
      },
    });
    return {
      ...supplier,
      lastInvoice: null,
      lastAmount: null,
      ytdSpend: new Prisma.Decimal(0),
      pendingInvoices: 0,
      hasExpiringSoon: false,
    };
  }

  async updateSupplier(
    estateId: string,
    supplierId: string,
    dto: UpdateSupplierDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id: supplierId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.taxIdCountry !== undefined && { taxIdCountry: dto.taxIdCountry }),
          ...(dto.taxId !== undefined && { taxId: dto.taxId }),
          ...(dto.vatNumber !== undefined && { vatNumber: dto.vatNumber }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.contactName !== undefined && { contactName: dto.contactName }),
          ...(dto.iban !== undefined && { iban: dto.iban }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.excludedFrom347 !== undefined && { excludedFrom347: dto.excludedFrom347 }),
        },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'supplier',
          subjectId: supplierId,
          verb: 'updated',
          summary: `Proveedor "${updated.name}" actualizado`,
          occurredAt: new Date(),
          estateId,
          propertyId: null,
        },
      });
      return updated;
    });
  }

  // ── Supplier invoices ────────────────────────────────────────────────────

  /** Valida que la factura pertenezca al proveedor Y este a la finca del path. */
  private async assertInvoiceInSupplier(
    estateId: string,
    supplierId: string,
    invoiceId: string,
  ): Promise<void> {
    await this.assertSupplierInEstate(estateId, supplierId);
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: { supplierId: true },
    });
    if (!invoice || invoice.supplierId !== supplierId) {
      throw new NotFoundException('Factura no encontrada para este proveedor.');
    }
  }

  /** Adjunto siempre privado a gestión (rol A/B) — proveedores/facturas nunca son visibles para rol C. */
  async uploadInvoiceFile(
    estateId: string,
    supplierId: string,
    invoiceId: string,
    file: UploadedMulterFile,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertInvoiceInSupplier(estateId, supplierId, invoiceId);
    if (!file) {
      throw new NotFoundException('No se recibió ningún fichero (campo "file").');
    }
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(`supplier-invoices/${invoiceId}`, file.originalname, file.buffer);
    return this.prisma.supplierInvoice.update({
      where: { id: invoiceId },
      data: { fileName: file.originalname, mimeType: file.mimetype, s3Key },
    });
  }

  async getInvoiceFileContent(
    estateId: string,
    supplierId: string,
    invoiceId: string,
    user: AuthenticatedUser,
  ): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertInvoiceInSupplier(estateId, supplierId, invoiceId);
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: { s3Key: true, fileName: true, mimeType: true },
    });
    if (!invoice?.s3Key || !invoice.fileName || !invoice.mimeType) {
      throw new NotFoundException('Esta factura no tiene fichero adjunto.');
    }
    const content = await this.storage.get(invoice.s3Key);
    return { content, fileName: invoice.fileName, mimeType: invoice.mimeType };
  }

  // ── Supplier contracts ───────────────────────────────────────────────────

  private expiryThreshold(): Date {
    return new Date(Date.now() + CONTRACT_EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Sin campo `status` persistido — se deriva SIEMPRE comparando `endDate`
   * con hoy (ver comentario del modelo en schema.prisma). Mismo motivo que
   * ya corrigió la tarea 12: un campo materializado necesita alguien que lo
   * sincronice, y nadie lo hacía para `Debtor.amount`.
   */
  deriveContractStatus(contract: {
    startDate?: Date;
    endDate: Date | null;
    cancelledAt: Date | null;
  }): SupplierContractStatus {
    return contractStatus(contract);
  }

  private withStatus<T extends SupplierContract>(contract: T): T & { status: SupplierContractStatus } {
    return { ...contract, status: this.deriveContractStatus(contract) };
  }

  async listSupplierContracts(estateId: string, supplierId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    const contracts = await this.prisma.supplierContract.findMany({
      where: { supplierId },
      orderBy: { startDate: 'desc' },
    });
    return contracts.map((c) => this.withStatus(c));
  }

  /**
   * Todos los contratos de la finca con su proveedor, estado derivado y días
   * hasta el vencimiento (negativo si ya venció, null si no tienen fin), coste anual y mensual
   * calculados (null si no se pueden anualizar) y nº de documentos.
   * Orden: los que vencen antes primero (vencidos arriba), luego los
   * indefinidos y por último los cancelados.
   */
  async listEstateContracts(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const contracts = await this.prisma.supplierContract.findMany({
      where: { estateId },
      include: {
        supplier: { select: { id: true, name: true, category: true } },
        _count: { select: { documents: true } },
      },
    });
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const rows = contracts.map(({ _count, ...c }) => {
      // Coste anualizado con la regla única del backend; null si no se puede (puntual, «otro» o sin importe).
      const annualCost = annualizedContractCost(c.costAmount, c.costFrequency);
      return {
      ...this.withStatus(c),
      daysLeft: c.endDate ? Math.round((c.endDate.getTime() - today) / 86_400_000) : null,
        annualCost,
        monthlyCost: annualCost ? annualCost.div(12).toDecimalPlaces(2) : null,
        documentCount: _count.documents,
      };
    });
    const rank = (c: (typeof rows)[number]) => (c.status === 'Cancelado' ? 2 : c.daysLeft === null ? 1 : 0);
    return rows.sort((a, b) => rank(a) - rank(b) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  }

  async createSupplierContract(
    estateId: string,
    supplierId: string,
    dto: CreateSupplierContractDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    const contract = await this.prisma.supplierContract.create({
      data: {
        supplierId,
        estateId,
        serviceType: dto.serviceType,
        contractNumber: dto.contractNumber?.trim() || null,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        renewalType: dto.renewalType,
        costAmount: dto.costAmount == null ? null : new Prisma.Decimal(dto.costAmount),
        costFrequency: dto.costFrequency ?? null,
        currency: dto.currency ?? 'EUR',
        reviewFrequency: dto.reviewFrequency,
        notes: dto.notes,
      },
    });
    return this.withStatus(contract);
  }

  private async assertContractInSupplier(supplierId: string, contractId: string): Promise<void> {
    const contract = await this.prisma.supplierContract.findUnique({
      where: { id: contractId },
      select: { supplierId: true },
    });
    if (!contract || contract.supplierId !== supplierId) {
      throw new NotFoundException('Contrato no encontrado para este proveedor.');
    }
  }

  async updateSupplierContract(
    estateId: string,
    supplierId: string,
    contractId: string,
    dto: UpdateSupplierContractDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    await this.assertContractInSupplier(supplierId, contractId);
    const contract = await this.prisma.supplierContract.update({
      where: { id: contractId },
      data: {
        ...(dto.serviceType !== undefined && { serviceType: dto.serviceType }),
        ...(dto.contractNumber !== undefined && { contractNumber: dto.contractNumber?.trim() || null }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: dateOrNull(dto.endDate) }),
        ...(dto.renewalType !== undefined && { renewalType: dto.renewalType }),
        ...(dto.reviewFrequency !== undefined && { reviewFrequency: dto.reviewFrequency }),
        ...(dto.costAmount !== undefined && { costAmount: dto.costAmount === null ? null : new Prisma.Decimal(dto.costAmount) }),
        ...(dto.costFrequency !== undefined && { costFrequency: dto.costFrequency }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    return this.withStatus(contract);
  }

  async cancelSupplierContract(
    estateId: string,
    supplierId: string,
    contractId: string,
    dto: CancelSupplierContractDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    await this.assertContractInSupplier(supplierId, contractId);
    const contract = await this.prisma.supplierContract.update({
      where: { id: contractId },
      data: { cancelledAt: new Date(), cancelledReason: dto.cancelledReason ?? null },
    });
    return this.withStatus(contract);
  }

  /**
   * Renueva un contrato: amplía su vencimiento y deja constancia en el histórico (vencimiento anterior,
   * nuevo e importe vigente). No se renueva un contrato cancelado ni uno sin fecha de fin (no hay
   * nada que renovar), y el nuevo vencimiento debe ser posterior al actual y a hoy.
   */
  async renewSupplierContract(
    estateId: string,
    supplierId: string,
    contractId: string,
    dto: RenewSupplierContractDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    await this.assertContractInSupplier(supplierId, contractId);
    const current = await this.prisma.supplierContract.findUniqueOrThrow({ where: { id: contractId } });
    if (current.cancelledAt) throw new BadRequestException('Un contrato cancelado no se puede renovar.');
    if (!current.endDate) throw new BadRequestException('El contrato no tiene fecha de fin: no hay nada que renovar.');

    const newEnd = dateOrNull(dto.newEndDate) as Date;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (newEnd.getTime() <= current.endDate.getTime()) {
      throw new BadRequestException('El nuevo vencimiento debe ser posterior al vencimiento actual.');
    }
    if (newEnd.getTime() <= today.getTime()) {
      throw new BadRequestException('El nuevo vencimiento debe ser posterior a hoy.');
    }

    return this.prisma.$transaction(async (tx) => {
      // La condición va en el propio UPDATE: si otro gestor renueva o cancela el contrato entre la lectura y
      // la escritura, no se pisa ni se renueva un contrato cancelado, ni el histórico guarda un vencimiento obsoleto.
      const { count } = await tx.supplierContract.updateMany({
        where: { id: contractId, cancelledAt: null, endDate: current.endDate },
        data: {
          endDate: newEnd,
          ...(dto.costAmount !== undefined && { costAmount: dto.costAmount === null ? null : new Prisma.Decimal(dto.costAmount) }),
          ...(dto.costFrequency !== undefined && { costFrequency: dto.costFrequency }),
        },
      });
      if (count === 0) {
        throw new ConflictException('El contrato ha cambiado mientras se renovaba: recárgalo e inténtalo de nuevo.');
      }
      const contract = await tx.supplierContract.findUniqueOrThrow({ where: { id: contractId } });
      const renewal = await tx.supplierContractRenewal.create({
        data: {
          contractId,
          estateId,
          renewedAt: today,
          previousEndDate: current.endDate,
          newEndDate: newEnd,
          costAmount: contract.costAmount,
          costFrequency: contract.costFrequency,
          currency: contract.currency,
          kind: 'manual',
          notes: dto.notes ?? null,
          renewedByUserId: user.id,
        },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'supplier',
          subjectId: supplierId,
          verb: 'updated',
          summary: `Contrato de "${contract.serviceType}" renovado hasta el ${newEnd.toISOString().slice(0, 10).split('-').reverse().join('/')}`,
          occurredAt: now,
          estateId,
          propertyId: null,
        },
      });
      return { contract: this.withStatus(contract), renewal };
    });
  }

  /**
   * Últimas renovaciones de los contratos de la finca (la más reciente primero) con su contrato y
   * proveedor, y el importe anualizado cuando se puede calcular.
   */
  async listEstateRenewals(estateId: string, user: AuthenticatedUser, limit = 100) {
    this.estateAccess.assertAccess(estateId, user);
    const take = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
    const rows = await this.prisma.supplierContractRenewal.findMany({
      where: { estateId },
      orderBy: [{ renewedAt: 'desc' }, { createdAt: 'desc' }],
      take,
      include: {
        contract: { select: { id: true, serviceType: true, supplier: { select: { id: true, name: true, category: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      serviceType: r.contract.serviceType,
      supplier: r.contract.supplier,
      renewedAt: r.renewedAt,
      previousEndDate: r.previousEndDate,
      newEndDate: r.newEndDate,
      costAmount: r.costAmount,
      costFrequency: r.costFrequency,
      currency: r.currency,
      annualCost: annualizedContractCost(r.costAmount, r.costFrequency),
      kind: r.kind,
      notes: r.notes,
    }));
  }

  // ── Supplier documents ───────────────────────────────────────────────────

  async listSupplierDocuments(estateId: string, supplierId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    return this.prisma.supplierDocument.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadSupplierDocument(
    estateId: string,
    supplierId: string,
    opts: { title: string; documentType: SupplierDocumentType; expiresAt?: string; contractId?: string },
    file: UploadedMulterFile,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    if (opts.contractId) {
      await this.assertContractInSupplier(supplierId, opts.contractId);
    }
    if (!file) {
      throw new NotFoundException('No se recibió ningún fichero (campo "file").');
    }
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(`supplier-documents/${supplierId}`, file.originalname, file.buffer);
    return this.prisma.supplierDocument.create({
      data: {
        supplierId,
        contractId: opts.contractId ?? null,
        documentType: opts.documentType,
        title: opts.title?.trim() || file.originalname,
        fileName: file.originalname,
        mimeType: file.mimetype,
        s3Key,
        expiresAt: opts.expiresAt ? new Date(opts.expiresAt) : null,
      },
    });
  }

  private async assertDocumentInSupplier(
    supplierId: string,
    docId: string,
  ): Promise<{ s3Key: string; fileName: string; mimeType: string }> {
    const doc = await this.prisma.supplierDocument.findUnique({
      where: { id: docId },
      select: { supplierId: true, s3Key: true, fileName: true, mimeType: true },
    });
    if (!doc || doc.supplierId !== supplierId) {
      throw new NotFoundException('Documento no encontrado para este proveedor.');
    }
    return doc;
  }

  async getSupplierDocumentFileContent(
    estateId: string,
    supplierId: string,
    docId: string,
    user: AuthenticatedUser,
  ): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    const doc = await this.assertDocumentInSupplier(supplierId, docId);
    const content = await this.storage.get(doc.s3Key);
    return { content, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async deleteSupplierDocument(
    estateId: string,
    supplierId: string,
    docId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    const doc = await this.assertDocumentInSupplier(supplierId, docId);
    await this.prisma.supplierDocument.delete({ where: { id: docId } });
    await this.storage.delete(doc.s3Key);
  }

  // ── Desempeño (incidencias asignadas) ────────────────────────────────────

  /**
   * Cuenta INCIDENCIAS distintas, no filas de asignación — un mismo issue
   * puede tener varias filas en IssueProviderAssignment a lo largo del
   * tiempo (reasignaciones), y contarlas todas inflaría el número. No se
   * calcula "tiempo medio de resolución": Issue no tiene un campo
   * resolvedAt real, y derivarlo del timeline sería una métrica que
   * aparenta precisión sin tenerla.
   */
  async getSupplierPerformance(estateId: string, supplierId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertSupplierInEstate(estateId, supplierId);
    const assignments = await this.prisma.issueProviderAssignment.findMany({
      where: { supplierId },
      distinct: ['issueId'],
      select: { issue: { select: { status: true } } },
    });
    const RESOLVED_STATUSES = new Set(['Resuelta', 'Cerrada']);
    const resolvedIssues = assignments.filter((a) => RESOLVED_STATUSES.has(a.issue.status)).length;
    return {
      totalIssuesAssigned: assignments.length,
      resolvedIssues,
      openIssues: assignments.length - resolvedIssues,
    };
  }
}
