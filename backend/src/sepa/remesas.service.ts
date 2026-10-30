import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ReceiptStatus } from '../prisma/client';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { runPosting } from '../ledger/journal/journal-db-errors';
import { ensureDefaultBankAccount } from '../ledger/chart/ledger-bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { CryptoService } from './crypto.service';
import { MandatesService } from './mandates.service';
import { AuditService } from '../gdpr/audit.service';
import { SepaPain008Service, Pain008DebtorLine } from './sepa-pain008.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateRemesaDto } from './dto/create-remesa.dto';

/**
 * Recibos que se pueden domiciliar: deben algo y no están ya en una remesa
 * enviada al banco sin cobrar (se cargarían dos veces). Un recibo devuelto
 * se puede volver a presentar.
 */
const REMESABLE_STATUSES: ReceiptStatus[] = [
  'Pendiente',
  'Devuelto',
  'Parcial',
];
const notInLiveRemesa: Prisma.AccountingReceiptWhereInput = {
  remesaLines: {
    none: { status: 'Pendiente', remesa: { status: 'Presentada' } },
  },
};

@Injectable()
export class RemesasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly cryptoService: CryptoService,
    private readonly mandatesService: MandatesService,
    private readonly pain008: SepaPain008Service,
    private readonly audit: AuditService,
    private readonly collections: CollectionPostingService,
  ) {}

  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const remesas = await this.prisma.remesaHistoryItem.findMany({
      where: { estateId },
      include: {
        period: true,
        lines: { select: { status: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Contadores derivados de las líneas — nunca almacenados (§9).
    return remesas.map(({ lines, xmlContent, ...remesa }) => ({
      ...remesa,
      hasXml: xmlContent != null,
      charged: lines.filter((l) => l.status === 'Cobrado').length,
      // Un rechazo previo al cargo también es un adeudo que no se cobró.
      returned: lines.filter(
        (l) => l.status === 'Devuelto' || l.status === 'Rechazado',
      ).length,
      pending: lines.filter((l) => l.status === 'Pendiente').length,
      returnedAmount: lines
        .filter((l) => l.status === 'Devuelto' || l.status === 'Rechazado')
        .reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0)),
    }));
  }

  /**
   * Candidatos de remesa del periodo: recibos `Pendiente` con
   * `includeInRemesa` y un mandato `active` (tras refrescar el ciclo de
   * vida de 36 meses de forma síncrona). La secuencia se calcula por
   * mandato (FRST primer uso / RCUR después / OOFF puntual).
   */
  async listCandidates(
    estateId: string,
    periodKey: string,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.mandatesService.refreshLifecycleForEstate(estateId);

    const receipts = await this.prisma.accountingReceipt.findMany({
      where: {
        period: { estateId, periodKey },
        status: { in: REMESABLE_STATUSES },
        includeInRemesa: true,
        ...notInLiveRemesa,
      },
      include: {
        property: {
          select: { ref: true, staircase: true, floor: true, door: true },
        },
      },
    });

    const candidates = [];
    for (const receipt of receipts) {
      const mandate = receipt.mandateId
        ? await this.prisma.mandate.findFirst({
            where: { id: receipt.mandateId },
          })
        : await this.prisma.mandate.findFirst({
            where: { propertyId: receipt.propertyId, status: 'active' },
            orderBy: { signedAt: 'desc' },
          });
      const seq = mandate ? this.mandatesService.computeSeq(mandate) : null;
      candidates.push({
        receiptId: receipt.id,
        owner: receipt.ownerNameSnapshot,
        unit:
          receipt.property.ref ??
          [
            receipt.property.staircase,
            receipt.property.floor,
            receipt.property.door,
          ]
            .filter(Boolean)
            .join('-'),
        // Lo que queda por cobrar, no el importe original.
        amount: receipt.outstanding,
        mandateId: mandate?.id ?? null,
        mandate: !!mandate && seq !== null,
        seq,
        isNew: seq === 'FRST',
        iban: mandate
          ? this.cryptoService.maskIban(
              this.cryptoService.decrypt(mandate.debtorIban),
            )
          : null,
      });
    }
    return candidates;
  }

  /**
   * Presentación de la remesa — transacción atómica (Fase 6): congela los
   * snapshots de cada línea, genera el pain.008 con los datos DESCIFRADOS
   * leídos de la base de datos, lo persiste en `xml_content` (las
   * descargas sirven siempre ese XML exacto, nunca regenerado), consume
   * los amendments pendientes (AmdmntInd) y actualiza
   * firstUseAt/lastUseAt de los mandatos usados.
   */
  async create(
    estateId: string,
    dto: CreateRemesaDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { estateId, periodKey: dto.periodKey },
    });
    if (!period) {
      throw new NotFoundException(
        `Periodo ${dto.periodKey} no encontrado en esta finca.`,
      );
    }

    await this.mandatesService.refreshLifecycleForEstate(estateId);

    const receipts = await this.prisma.accountingReceipt.findMany({
      where: {
        periodId: period.id,
        status: { in: REMESABLE_STATUSES },
        includeInRemesa: true,
        ...notInLiveRemesa,
        ...(dto.excludeReceiptIds?.length
          ? { id: { notIn: dto.excludeReceiptIds } }
          : {}),
      },
    });

    // Resolución de mandato + amendments fuera de la transacción (solo
    // lecturas); las escrituras van todas juntas después.
    const lines: Array<{
      receipt: (typeof receipts)[number];
      mandate: import('../prisma/client').Mandate;
      seq: 'FRST' | 'RCUR' | 'OOFF' | 'FNAL';
      plainIban: string;
      amendments: { umr?: string; iban?: string; ids: string[] };
    }> = [];

    for (const receipt of receipts) {
      const mandate = receipt.mandateId
        ? await this.prisma.mandate.findFirst({
            where: { id: receipt.mandateId, status: 'active' },
          })
        : await this.prisma.mandate.findFirst({
            where: { propertyId: receipt.propertyId, status: 'active' },
            orderBy: { signedAt: 'desc' },
          });
      if (!mandate) continue; // sin mandato activo no se puede domiciliar
      const seq = this.mandatesService.computeSeq(mandate);
      if (!seq) continue;

      const pendingAmendments = await this.prisma.mandateAmendment.findMany({
        where: { mandateId: mandate.id, pendingInFirstNextRemesa: true },
      });
      const umrAmendment = pendingAmendments.find((a) => a.field === 'umr');
      const ibanAmendment = pendingAmendments.find(
        (a) => a.field === 'debtor_iban',
      );

      lines.push({
        receipt,
        mandate,
        seq,
        plainIban: this.cryptoService.decrypt(mandate.debtorIban),
        amendments: {
          umr: umrAmendment?.oldValue,
          iban: ibanAmendment
            ? this.cryptoService.decrypt(ibanAmendment.oldValue)
            : undefined,
          ids: pendingAmendments.map((a) => a.id),
        },
      });
    }

    if (lines.length === 0) {
      throw new BadRequestException(
        'No hay recibos pendientes con mandato activo para este periodo.',
      );
    }

    const remesaId = crypto.randomUUID();
    const messageId =
      dto.messageId ?? `DOMORA-${dto.periodKey}-${remesaId.slice(0, 8)}`;

    // EndToEndId: único y corto (máx. 35), porque los ficheros de devolución
    // del banco lo citan para localizar la línea. `${messageId}-${no}`
    // truncado podía repetirse entre recibos.
    const endToEndIds = lines.map(
      (_, i) => `${messageId.slice(0, 26)}-${String(i + 1).padStart(4, '0')}`,
    );
    const debtors: Pain008DebtorLine[] = lines.map((l, i) => ({
      endToEndId: endToEndIds[i],
      amount: Number(l.receipt.outstanding),
      mandateUmr: l.mandate.umr,
      mandateSignedAt: l.mandate.signedAt.toISOString().slice(0, 10),
      amendmentIndicator: l.amendments.ids.length > 0,
      seqType: l.seq,
      debtorNameSnapshot: l.receipt.ownerNameSnapshot ?? 'DESCONOCIDO',
      debtorIbanSnapshot: l.plainIban,
      debtorBicSnapshot: l.mandate.debtorBic ?? undefined,
      remittanceInfo: dto.concept,
      originalMandateUmr: l.amendments.umr,
      originalDebtorIban: l.amendments.iban,
    }));

    const request = this.pain008.buildRequest({
      estate: {
        id: estate.id,
        name: estate.name,
        creditorId: estate.creditorId,
        creditorIban: estate.creditorIban
          ? this.cryptoService.decrypt(estate.creditorIban)
          : null,
        creditorBic: estate.creditorBic,
      },
      scheme: dto.scheme,
      requiredCollectionDate: dto.chargeDate,
      messageId,
      paymentInfoId: messageId,
      debtors,
    });
    const xml = this.pain008.toXml(request);

    const totalAmount = lines.reduce(
      (s, l) => s.plus(l.receipt.outstanding),
      new Prisma.Decimal(0),
    );

    return this.prisma.$transaction(async (tx) => {
      const bankAccountId = await ensureDefaultBankAccount(tx, estateId);
      const remesa = await tx.remesaHistoryItem.create({
        data: {
          id: remesaId,
          estateId,
          periodId: period.id,
          scheme: dto.scheme,
          concept: dto.concept,
          status: 'Presentada',
          linesCount: lines.length,
          totalAmount,
          presentedAt: new Date(),
          chargeDate: new Date(dto.chargeDate),
          createdByUserId: user.id,
          xmlContent: xml,
          messageId,
          bankAccountId,
        },
      });

      const now = new Date();
      for (const [i, l] of lines.entries()) {
        await tx.remesaLine.create({
          data: {
            remesaId: remesa.id,
            receiptId: l.receipt.id,
            propertyId: l.receipt.propertyId,
            ownerUserId: l.receipt.ownerUserId,
            mandateId: l.mandate.id,
            iban: this.cryptoService.maskIban(l.plainIban),
            mandateSeq: l.seq,
            amount: l.receipt.outstanding,
            status: 'Pendiente',
            endToEndId: endToEndIds[i],
            ownerNameSnapshot: l.receipt.ownerNameSnapshot,
            ownerTaxIdSnapshot: l.receipt.ownerTaxIdSnapshot,
            ownerTaxIdCountrySnapshot: l.receipt.ownerTaxIdCountrySnapshot,
            ibanSnapshot: this.cryptoService.maskIban(l.plainIban),
          },
        });

        await tx.mandate.update({
          where: { id: l.mandate.id },
          data: {
            firstUseAt: l.mandate.firstUseAt ?? now,
            lastUseAt: now,
          },
        });

        if (l.amendments.ids.length > 0) {
          await tx.mandateAmendment.updateMany({
            where: { id: { in: l.amendments.ids } },
            data: { pendingInFirstNextRemesa: false },
          });
        }
      }

      return { ...remesa, xmlContent: undefined, hasXml: true };
    });
  }

  /**
   * El banco abonó la remesa (fecha del abono en el extracto): un asiento
   * por el total y un cobro por línea. Ver CollectionPostingService.
   */
  async collect(
    remesaId: string,
    dto: { date: string },
    user: AuthenticatedUser,
  ) {
    const remesa = await this.findOwn(remesaId, user);
    return runPosting(
      this.prisma,
      (tx) =>
        this.collections.collectRemesa(tx, remesa.id, {
          date: new Date(`${dto.date.slice(0, 10)}T00:00:00Z`),
          userId: user.id,
        }),
      { timeoutMs: 120_000 },
    );
  }

  /**
   * Anula una remesa que no se llegó a cobrar (no se envió, o el banco no la
   * procesó): sus recibos vuelven a estar libres para otra remesa. No hay
   * asiento: el dinero nunca llegó.
   */
  async cancel(remesaId: string, user: AuthenticatedUser) {
    const remesa = await this.findOwn(remesaId, user);
    if (remesa.status !== 'Presentada' && remesa.status !== 'Borrador') {
      throw new ConflictException(
        'Solo se anula una remesa que todavía no se ha cobrado.',
      );
    }
    return this.prisma.remesaHistoryItem.update({
      where: { id: remesa.id },
      data: { status: 'Anulada', cancelledAt: new Date() },
      omit: { xmlContent: true },
    });
  }

  private async findOwn(remesaId: string, user: AuthenticatedUser) {
    const remesa = await this.prisma.remesaHistoryItem.findFirst({
      where: { id: remesaId },
      select: { id: true, estateId: true, status: true },
    });
    if (!remesa) {
      throw new NotFoundException(`Remesa ${remesaId} no encontrada.`);
    }
    this.estateAccess.assertAccess(remesa.estateId, user);
    return remesa;
  }

  /** Detalle línea a línea (por deudor) de una remesa ya presentada. */
  async listLines(remesaId: string, user: AuthenticatedUser) {
    const remesa = await this.prisma.remesaHistoryItem.findFirst({
      where: { id: remesaId },
    });
    if (!remesa) {
      throw new NotFoundException(`Remesa ${remesaId} no encontrada.`);
    }
    this.estateAccess.assertAccess(remesa.estateId, user);

    const lines = await this.prisma.remesaLine.findMany({
      where: { remesaId },
      include: {
        property: {
          select: { ref: true, staircase: true, floor: true, door: true },
        },
        mandate: { select: { umr: true } },
      },
      orderBy: { ownerNameSnapshot: 'asc' },
    });

    return lines.map((l) => ({
      id: l.id,
      owner: l.ownerNameSnapshot ?? 'Desconocido',
      unit:
        l.property.ref ??
        [l.property.staircase, l.property.floor, l.property.door]
          .filter(Boolean)
          .join('-'),
      iban: l.ibanSnapshot ?? l.iban,
      mandate: l.mandate?.umr ?? '—',
      seq: l.mandateSeq,
      amount: l.amount,
      status: l.status,
      returnCode: l.returnCode,
      returnReason: l.returnReason,
      ownerUserId: l.ownerUserId,
      mandateId: l.mandateId,
      receiptId: l.receiptId,
    }));
  }

  /** Sirve el XML EXACTO persistido al presentar — nunca regenerado. */
  async getFile(remesaId: string, user: AuthenticatedUser) {
    const remesa = await this.prisma.remesaHistoryItem.findFirst({
      where: { id: remesaId },
    });
    if (!remesa) {
      throw new NotFoundException(`Remesa ${remesaId} no encontrada.`);
    }
    this.estateAccess.assertAccess(remesa.estateId, user);
    if (!remesa.xmlContent) {
      throw new NotFoundException(
        'Esta remesa no tiene fichero pain.008 persistido.',
      );
    }
    // El XML contiene IBANs en claro de todos los deudores — acceso auditado.
    await this.audit.logAccess(user, 'remesa_file', 'download', remesa.id);
    return { xml: remesa.xmlContent, filename: `remesa-${remesa.id}.xml` };
  }
}
