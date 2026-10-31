import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { runPosting } from '../ledger/journal/journal-db-errors';
import { toCents } from '../ledger/money';
import type { GenerateReceiptsDto } from './dto/generate-receipts.dto';
import type { UpdateReceiptDto } from './dto/update-receipt.dto';
import type { CreateManualReceiptDto } from './dto/create-manual-receipt.dto';
import { USER_SECRETS_OMIT } from '../common/secret-omit';
import { ownerReceiptsLink } from '../common/owner-links';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
    private readonly receiptPosting: ReceiptPostingService,
    private readonly collections: CollectionPostingService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Lecturas del diario (sin estado propio: basta con el cliente de Prisma). */
  private get ledgerQuery(): LedgerQueryService {
    return new LedgerQueryService(this.prisma);
  }

  /**
   * Proyección `AccountingEstate` (docs/data-model.md §7.1): todo derivado
   * del diario, nunca almacenado. `balance` es el dinero en bancos y caja;
   * `income`/`expenses`, los del ejercicio en curso; `reserve`, el saldo de
   * la cuenta 117; `delinquency`, lo que deben los recibos pendientes.
   */
  async summary(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }

    const currentYear = new Date().getFullYear();
    const [units, figures, delinquencyAgg, budgetAgg] = await Promise.all([
      this.prisma.property.count({ where: { estateId, deletedAt: null } }),
      this.ledgerQuery.estateFigures(estateId, currentYear),
      this.prisma.accountingReceipt.aggregate({
        where: {
          estateId,
          status: { in: ['Pendiente', 'Parcial', 'Devuelto'] },
        },
        _sum: { outstanding: true },
      }),
      this.prisma.budgetItem.aggregate({
        where: { estateId, fiscalYear: currentYear },
        _sum: { budgeted: true },
      }),
    ]);

    // Todo sale del diario (fase 8): dinero en bancos y caja, fondo de
    // reserva real (117) e ingresos y gastos del ejercicio en curso.
    const balance = figures.treasury;
    const income = figures.income;
    const expenses = figures.expenses;
    const reserve = figures.reserve;

    // Fondo de reserva mínimo legal: 10% del último presupuesto ordinario
    // (art. 9.1.f LPH). Si no hay presupuesto cargado, no se puede evaluar
    // y el mínimo queda en null (mejor no afirmar cumplimiento sin datos).
    const annualBudget = budgetAgg._sum.budgeted;
    const reserveLegalMinimum = annualBudget ? annualBudget.mul(0.1) : null;

    return {
      id: estate.id,
      administratorId: estate.administratorId,
      name: estate.name,
      type: estate.type,
      balance,
      income,
      expenses,
      reserve,
      reserveTarget: estate.reserveTarget,
      reserveLegalMinimum,
      reserveBelowLegalMinimum:
        reserveLegalMinimum !== null
          ? reserve.lessThan(reserveLegalMinimum)
          : null,
      delinquency: delinquencyAgg._sum.outstanding ?? new Prisma.Decimal(0),
      units,
      iban: estate.iban,
    };
  }

  async listPeriods(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.accountingPeriod.findMany({
      where: { estateId },
      orderBy: { periodKey: 'desc' },
    });
  }

  async listReceipts(
    estateId: string,
    user: AuthenticatedUser,
    filters: {
      periodKey?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));

    const where: Prisma.AccountingReceiptWhereInput = {
      period: {
        estateId,
        ...(filters.periodKey ? { periodKey: filters.periodKey } : {}),
      },
      ...(filters.status ? { status: filters.status as never } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.accountingReceipt.count({ where }),
      this.prisma.accountingReceipt.findMany({
        where,
        include: {
          period: true,
          property: {
            select: { ref: true, staircase: true, floor: true, door: true },
          },
        },
        orderBy: [{ period: { periodKey: 'desc' } }, { no: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /**
   * Generación masiva de recibos del periodo (doc/plan.md §4.8): un recibo
   * de cuota ordinaria por cada propiedad activa de la finca con cuota > 0.
   * Idempotente: las propiedades que ya tienen recibo en el periodo se
   * omiten. El snapshot (nombre/NIF/IBAN del titular) se congela AQUÍ, en
   * la transacción de emisión, y no se recalcula nunca después — patrón
   * FK-viva + snapshot inmutable (docs/data-model.md, Apéndice B).
   */
  async generateReceipts(
    estateId: string,
    dto: GenerateReceiptsDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }

    const [yearStr, monthStr] = dto.periodKey.split('-');
    const monthIndex = Number(monthStr) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      throw new NotFoundException(`Periodo ${dto.periodKey} inválido.`);
    }
    const label = dto.label ?? `${MONTH_LABELS[monthIndex]} ${yearStr}`;
    const monthAbbrev =
      dto.monthAbbrev ?? MONTH_LABELS[monthIndex].slice(0, 3).toUpperCase();

    const properties = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null, quotaMonthly: { gt: 0 } },
      include: {
        memberships: {
          // Solo Propietario: el deudor de la cuota es el titular, nunca un
          // inquilino/ocupante/representante vinculado a la misma unidad —
          // sin este filtro, un inquilino invitado desplazaba al propietario
          // importado (ExternalOwner) como titular del recibo.
          where: { status: 'linked', revokedAt: null, roleType: 'Propietario' },
          orderBy: [{ isPrimaryContact: 'desc' }, { linkedAt: 'asc' }],
          include: { user: { omit: USER_SECRETS_OMIT } },
        },
        externalOwners: { where: { promotedToUserId: null }, take: 1 },
      },
    });

    // Cada recibo nace con su asiento de emisión en la misma transacción:
    // si uno falla (por ejemplo, un periodo anterior a la fecha de corte),
    // no se emite ninguno. Tiempo holgado: una finca grande son cientos de
    // asientos.
    const result = await runPosting(
      this.prisma,
      async (tx) => {
        const period = await tx.accountingPeriod.upsert({
          where: { estateId_periodKey: { estateId, periodKey: dto.periodKey } },
          update: { issuedAt: new Date() },
          create: {
            estateId,
            periodKey: dto.periodKey,
            label,
            monthAbbrev,
            issuedAt: new Date(),
          },
        });

        const existing = await tx.accountingReceipt.findMany({
          where: { periodId: period.id, status: { not: 'Anulado' } },
          select: { propertyId: true },
        });
        const alreadyBilled = new Set(existing.map((r) => r.propertyId));

        const noPrefix = dto.periodKey.replace('-', '/');
        let created = 0;
        let skipped = 0;
        const notifyOwners: { ownerUserId: string; propertyId: string }[] = [];

        for (const property of properties) {
          if (alreadyBilled.has(property.id)) {
            skipped += 1;
            continue;
          }

          // Titular: la membresía linked con contacto principal primero; si
          // la unidad no tiene usuario en plataforma, el titular externo
          // aporta el snapshot y la FK viva queda en null (personas
          // jurídicas, herederos pendientes...).
          const membership = property.memberships[0] ?? null;
          const externalOwner = membership
            ? null
            : (property.externalOwners[0] ?? null);
          const ownerUser = membership?.user ?? null;

          const seq = await this.receiptPosting.nextNumber(
            tx,
            estateId,
            period.id,
            dto.periodKey,
          );
          const unitLabel =
            property.ref ??
            [property.staircase, property.floor, property.door]
              .filter(Boolean)
              .join('-');

          await this.receiptPosting.issue(tx, {
            estateId,
            periodId: period.id,
            periodKey: dto.periodKey,
            propertyId: property.id,
            no: `${noPrefix}-${String(seq).padStart(3, '0')}`,
            ownerUserId: ownerUser?.id ?? null,
            concept: `Cuota ordinaria · ${label}`,
            kind: 'cuota_ordinaria',
            amount: toCents(property.quotaMonthly),
            dueDate: new Date(Date.UTC(Number(yearStr), monthIndex, 5)),
            method: 'Pendiente',
            manual: false,
            includeInRemesa: true,
            ownerNameSnapshot:
              ownerUser?.fullName ?? externalOwner?.fullName ?? unitLabel,
            ownerTaxIdSnapshot:
              ownerUser?.taxId ?? externalOwner?.taxId ?? null,
            ownerTaxIdCountrySnapshot:
              ownerUser?.taxIdCountry ?? externalOwner?.taxIdCountry ?? null,
            ibanSnapshot: property.iban ?? null,
            createdByUserId: user.id,
          });
          created += 1;
          if (ownerUser) {
            notifyOwners.push({
              ownerUserId: ownerUser.id,
              propertyId: property.id,
            });
          }
        }

        return {
          period,
          created,
          skipped,
          totalProperties: properties.length,
          notifyOwners,
        };
      },
      { timeoutMs: 120_000 },
    );

    // Fuera de la transacción a propósito — un fallo al avisar no debe
    // deshacer recibos ya contabilizados y confirmados (notify() tampoco
    // lanza nunca, pero mejor no depender de eso para la atomicidad).
    await Promise.all(
      result.notifyOwners.map(({ ownerUserId, propertyId }) =>
        this.notifications.notify({
          userIds: [ownerUserId],
          category: 'receipt',
          title: `Nuevo recibo disponible: ${label}`,
          link: ownerReceiptsLink(propertyId),
          estateId,
          propertyId,
        }),
      ),
    );

    return result;
  }

  /**
   * Alta de UN recibo suelto (a diferencia de `generateReceipts`, que crea
   * uno por cada propiedad de la finca). Mismo patrón de upsert de periodo
   * — si `periodKey` no existe todavía para esta finca, se crea al vuelo,
   * lo que resuelve el problema de no poder elegir/definir el periodo al
   * cargar un recibo manual. `manual: true` distingue estos recibos de los
   * generados en masa (columna que ya existía en el schema sin usarse).
   */
  async createManualReceipt(
    estateId: string,
    dto: CreateManualReceiptDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, estateId, deletedAt: null },
      include: {
        memberships: {
          // Solo Propietario: el deudor de la cuota es el titular, nunca un
          // inquilino/ocupante/representante vinculado a la misma unidad —
          // sin este filtro, un inquilino invitado desplazaba al propietario
          // importado (ExternalOwner) como titular del recibo.
          where: { status: 'linked', revokedAt: null, roleType: 'Propietario' },
          orderBy: [{ isPrimaryContact: 'desc' }, { linkedAt: 'asc' }],
          include: { user: { omit: USER_SECRETS_OMIT } },
        },
        externalOwners: { where: { promotedToUserId: null }, take: 1 },
      },
    });
    if (!property) {
      throw new NotFoundException(
        `Propiedad ${dto.propertyId} no encontrada en esta finca.`,
      );
    }

    const [yearStr, monthStr] = dto.periodKey.split('-');
    const monthIndex = Number(monthStr) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      throw new BadRequestException(`Periodo ${dto.periodKey} inválido.`);
    }
    const label = dto.label ?? `${MONTH_LABELS[monthIndex]} ${yearStr}`;
    const monthAbbrev =
      dto.monthAbbrev ?? MONTH_LABELS[monthIndex].slice(0, 3).toUpperCase();

    const membership = property.memberships[0] ?? null;
    const externalOwner = membership
      ? null
      : (property.externalOwners[0] ?? null);
    const ownerUser = membership?.user ?? null;
    const unitLabel =
      property.ref ??
      [property.staircase, property.floor, property.door]
        .filter(Boolean)
        .join('-');

    return runPosting(this.prisma, async (tx) => {
      const period = await tx.accountingPeriod.upsert({
        where: { estateId_periodKey: { estateId, periodKey: dto.periodKey } },
        update: {},
        create: { estateId, periodKey: dto.periodKey, label, monthAbbrev },
      });

      const seq = await this.receiptPosting.nextNumber(
        tx,
        estateId,
        period.id,
        `${dto.periodKey}M`,
      );
      const no = `${dto.periodKey.replace('-', '/')}-M${String(seq).padStart(3, '0')}`;

      const receipt = await this.receiptPosting.issue(tx, {
        estateId,
        periodId: period.id,
        periodKey: dto.periodKey,
        propertyId: property.id,
        no,
        ownerUserId: ownerUser?.id ?? null,
        concept: dto.concept,
        kind: dto.kind,
        amount: toCents(dto.amount),
        dueDate: new Date(dto.dueDate),
        method: dto.method,
        manual: true,
        includeInRemesa: dto.includeInRemesa ?? true,
        ownerNameSnapshot:
          ownerUser?.fullName ?? externalOwner?.fullName ?? unitLabel,
        ownerTaxIdSnapshot: ownerUser?.taxId ?? externalOwner?.taxId ?? null,
        ownerTaxIdCountrySnapshot:
          ownerUser?.taxIdCountry ?? externalOwner?.taxIdCountry ?? null,
        ibanSnapshot: property.iban ?? null,
        createdByUserId: user.id,
      });
      return tx.accountingReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
        include: {
          period: true,
          property: {
            select: { ref: true, staircase: true, floor: true, door: true },
          },
        },
      });
    });
  }

  /**
   * Registro manual de cobro, devolución o anulación de un cobro. Cambiar el
   * estado CONTABILIZA (ReceiptPostingService); importe y snapshots siguen
   * siendo intocables. Transiciones:
   * - Pendiente o Devuelto → Pagada: cobro de lo pendiente (banco, o caja si
   *   es en efectivo).
   * - Pagada → Devuelto: devolución del banco (vuelve a estar pendiente).
   * - Pendiente → Devuelto: devolución de una remesa sin cobro registrado,
   *   solo cambia el estado.
   * - Pagada → Pendiente: deshace el cobro (contraasiento).
   * Para anular el recibo entero: `POST /receipts/:id/cancel`.
   */
  async updateReceipt(
    id: string,
    dto: UpdateReceiptDto,
    user: AuthenticatedUser,
  ) {
    const receipt = await this.prisma.accountingReceipt.findFirst({
      where: { id },
      select: {
        id: true,
        no: true,
        status: true,
        estateId: true,
        propertyId: true,
        outstanding: true,
      },
    });
    if (!receipt) {
      throw new NotFoundException(`Recibo ${id} no encontrado.`);
    }
    this.estateAccess.assertAccess(receipt.estateId, user);

    return runPosting(this.prisma, async (tx) => {
      const from = receipt.status;
      const to = dto.status ?? from;
      if (from === 'Anulado') {
        throw new BadRequestException('El recibo está anulado.');
      }
      const today = new Date();

      if (to !== from) {
        if (to === 'Pagada') {
          const method =
            dto.method &&
            dto.method !== 'Pendiente' &&
            dto.method !== 'Devolucion'
              ? dto.method
              : 'Transferencia';
          await this.collections.collect(tx, {
            estateId: receipt.estateId,
            propertyId: receipt.propertyId,
            date: today,
            amount: toCents(receipt.outstanding),
            method,
            receiptIds: [id],
            createdByUserId: user.id,
          });
        } else if (to === 'Devuelto') {
          const [last] = await this.collections.activeCollectionsFor(tx, id);
          if (!last) {
            // Sin cobro de por medio: el adeudo falló antes de cargarse.
            await this.receiptPosting.markReturned(tx, id, {
              returnCode: dto.returnCode,
              returnReason: dto.returnReason,
              createdByUserId: user.id,
            });
          } else {
            await this.assertSingleReceiptCollection(tx, last, id, receipt.no);
            await this.collections.returnCollection(tx, last.id, {
              date: today,
              returnCode: dto.returnCode,
              returnReason: dto.returnReason,
              userId: user.id,
            });
          }
        } else if (
          to === 'Pendiente' &&
          (from === 'Pagada' || from === 'Parcial')
        ) {
          const [last] = await this.collections.activeCollectionsFor(tx, id);
          if (!last) {
            throw new BadRequestException(
              `No se encuentra el cobro del recibo ${receipt.no}.`,
            );
          }
          await this.assertSingleReceiptCollection(tx, last, id, receipt.no);
          await this.collections.undo(tx, last.id, {
            reason: `Recibo ${receipt.no} marcado como pendiente`,
            userId: user.id,
          });
        } else if (to === 'Pendiente' && from === 'Devuelto') {
          // Devuelto sin cobro posterior: lo pendiente no cambia.
          await tx.accountingReceipt.update({
            where: { id },
            data: {
              status: 'Pendiente',
              returnCode: null,
              returnReason: null,
              date: new Date(),
            },
          });
        } else {
          throw new BadRequestException(
            `No se puede pasar un recibo de ${from} a ${to}.`,
          );
        }
      } else {
        // Sin cambio de estado: solo datos de gestión.
        await tx.accountingReceipt.update({
          where: { id },
          data: {
            ...(dto.method ? { method: dto.method } : {}),
            ...(dto.returnCode !== undefined
              ? { returnCode: dto.returnCode }
              : {}),
            ...(dto.returnReason !== undefined
              ? { returnReason: dto.returnReason }
              : {}),
          },
        });
      }
      return tx.accountingReceipt.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Desde la ficha de UN recibo solo se deshace o devuelve un cobro que era
   * solo suyo; uno que pagó varios recibos se gestiona desde sus cobros.
   */
  private async assertSingleReceiptCollection(
    tx: Prisma.TransactionClient,
    collection: Awaited<
      ReturnType<CollectionPostingService['activeCollectionsFor']>
    >[number],
    receiptId: string,
    receiptNo: string,
  ): Promise<void> {
    if (!(await this.collections.coversOnly(tx, collection, receiptId))) {
      throw new BadRequestException(
        `El cobro del recibo ${receiptNo} incluye otros recibos o un anticipo: gestiónalo desde los cobros de la propiedad.`,
      );
    }
  }

  /** Anula un recibo emitido por error (ADR, D19): contraasiento de la emisión. */
  async cancelReceipt(id: string, reason: string, user: AuthenticatedUser) {
    const receipt = await this.prisma.accountingReceipt.findFirst({
      where: { id },
      select: { estateId: true },
    });
    if (!receipt) {
      throw new NotFoundException(`Recibo ${id} no encontrado.`);
    }
    this.estateAccess.assertAccess(receipt.estateId, user);
    return runPosting(this.prisma, (tx) =>
      this.receiptPosting.cancel(tx, id, {
        reason,
        cancelledByUserId: user.id,
      }),
    );
  }

  /** Recibo + su finca, o 404 — base común de las dos operaciones de justificante. */
  private async findReceiptWithEstate(receiptId: string) {
    const receipt = await this.prisma.accountingReceipt.findFirst({
      where: { id: receiptId },
      include: { period: { select: { estateId: true } } },
    });
    if (!receipt) {
      throw new NotFoundException(`Recibo ${receiptId} no encontrado.`);
    }
    return receipt;
  }

  /** Solo el propietario del recibo (rol C) o gestión (A/B) con acceso a la finca. */
  private assertReceiptAccess(
    receipt: { ownerUserId: string | null; period: { estateId: string } },
    user: AuthenticatedUser,
  ): void {
    this.estateAccess.assertAccess(receipt.period.estateId, user);
    if (user.role === 'C' && receipt.ownerUserId !== user.id) {
      throw new ForbiddenException(
        'Solo el propietario del recibo puede acceder a su justificante de pago.',
      );
    }
  }

  async uploadPaymentProof(
    receiptId: string,
    file: UploadedMulterFile,
    user: AuthenticatedUser,
  ) {
    const receipt = await this.findReceiptWithEstate(receiptId);
    this.assertReceiptAccess(receipt, user);
    if (!file) {
      throw new NotFoundException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(
      `receipts/${receiptId}/proof`,
      file.originalname,
      file.buffer,
    );
    return this.prisma.accountingReceipt.update({
      where: { id: receiptId },
      data: {
        proofFileName: file.originalname,
        proofMimeType: file.mimetype,
        proofS3Key: s3Key,
      },
    });
  }

  async getPaymentProofContent(
    receiptId: string,
    user: AuthenticatedUser,
  ): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
    const receipt = await this.findReceiptWithEstate(receiptId);
    this.assertReceiptAccess(receipt, user);
    if (
      !receipt.proofS3Key ||
      !receipt.proofFileName ||
      !receipt.proofMimeType
    ) {
      throw new NotFoundException('Este recibo no tiene justificante adjunto.');
    }
    const content = await this.storage.get(receipt.proofS3Key);
    return {
      content,
      fileName: receipt.proofFileName,
      mimeType: receipt.proofMimeType,
    };
  }

  /** Vista del rol C: sus propios recibos (FK viva `ownerUserId`). */
  async listReceiptsForUser(userId: string, user: AuthenticatedUser) {
    if (user.role === 'C' && user.id !== userId) {
      throw new ForbiddenException(
        'Un usuario solo puede ver sus propios recibos.',
      );
    }
    const receipts = await this.prisma.accountingReceipt.findMany({
      where: { ownerUserId: userId },
      include: {
        period: true,
        property: { select: { ref: true, estateId: true } },
      },
      orderBy: { date: 'desc' },
    });
    if (user.role === 'A' || user.id === userId) {
      return receipts;
    }
    return receipts.filter((r) =>
      this.estateAccess.canAccess(r.property.estateId, user),
    );
  }
}
