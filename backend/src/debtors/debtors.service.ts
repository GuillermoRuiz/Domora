import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ReceiptStatus } from '../prisma/client';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { legalImputationOrder } from '../ledger/posting/rules/collection.rules';
import { runPosting } from '../ledger/journal/journal-db-errors';
import { fromCents, toCents } from '../ledger/money';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { AuditService } from '../gdpr/audit.service';
import { DebtorBalancesExcelService } from './debtor-balances-excel.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateDebtorActionDto } from './dto/create-debtor-action.dto';
import type { CreatePaymentAgreementDto } from './dto/create-payment-agreement.dto';
import type { MarkInstallmentPaidDto, RemesaLineReturnDto } from './dto/misc.dto';


/** Recibos que deben algo: su `outstanding` es lo que queda por cobrar. */
const OPEN_RECEIPT_STATUSES: ReceiptStatus[] = ['Pendiente', 'Parcial', 'Devuelto'];

@Injectable()
export class DebtorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly audit: AuditService,
    private readonly balancesExcel: DebtorBalancesExcelService,
    private readonly collections: CollectionPostingService,
    private readonly propertyAccess: PropertyAccessService,
  ) {}

  /** Filtro por tenant (administratorId); rol A ve todo. */
  private tenantWhere(user: AuthenticatedUser): { administratorId?: string } {
    if (user.role === 'A') return {};
    if (!user.administratorId) {
      throw new ForbiddenException('Usuario sin gestora asociada.');
    }
    return { administratorId: user.administratorId };
  }

  // ── Morosidad ──────────────────────────────────────────────────────────

  /**
   * `Debtor` no tiene columna `name` (no hay FK viva a un usuario) — el
   * titular a mostrar es el primary contact ACTUAL de la propiedad
   * (`PropertyMembership.isPrimaryContact`), igual que en `computeBalances`.
   * Se resuelve en un único query batched, no N+1.
   */
  private async withTitular<T extends { propertyId: string | null }>(
    debtors: T[],
  ): Promise<(T & { titular: string | null })[]> {
    const propertyIds = debtors
      .map((d) => d.propertyId)
      .filter((id): id is string => !!id);
    const contacts = propertyIds.length
      ? await this.prisma.propertyMembership.findMany({
          where: {
            propertyId: { in: propertyIds },
            isPrimaryContact: true,
            revokedAt: null,
          },
          select: { propertyId: true, user: { select: { fullName: true } } },
        })
      : [];
    const titularByProperty = new Map(
      contacts.map((c) => [c.propertyId, c.user.fullName]),
    );
    return debtors.map((d) => ({
      ...d,
      titular: d.propertyId ? titularByProperty.get(d.propertyId) ?? null : null,
    }));
  }

  async listDebtors(user: AuthenticatedUser) {
    // Datos de morosidad = datos personales especialmente delicados
    // (doctrina AEPD para comunidades) — acceso auditado.
    await this.audit.logAccess(user, 'debtors', 'list');
    const debtors = await this.prisma.debtor.findMany({
      where: this.tenantWhere(user),
      include: {
        property: {
          select: { ref: true, staircase: true, floor: true, door: true },
        },
      },
      orderBy: { amount: 'desc' },
    });
    return this.withTitular(debtors);
  }

  async listDebtorsByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const debtors = await this.prisma.debtor.findMany({
      where: { estateId, ...this.tenantWhere(user) },
      include: {
        property: {
          select: { ref: true, staircase: true, floor: true, door: true },
        },
      },
      orderBy: { amount: 'desc' },
    });
    return this.withTitular(debtors);
  }

  /**
   * Saldo de TODAS las propiedades de la finca, no solo las que ya tienen
   * fila en `Debtor` — a diferencia de `listDebtors`/`listDebtorsByEstate`,
   * que muestran únicamente morosidad ya gestionada. El principal se
   * recalcula en vivo sumando `AccountingReceipt` Pendiente/Devuelto (mismo
   * criterio que `debtCertificate()`, generalizado a toda la finca en dos
   * agregados en vez de N consultas). Si además existe un `Debtor` para la
   * propiedad, se suman sus recargos (`interest`) y se exponen sus campos de
   * gestión de cobro (`step`/`monthsOverdue`/último contacto); si no existe,
   * la propiedad aparece "Al día" o con deuda sin gestión todavía.
   *
   * Devuelve el importe en POSITIVO (deuda), igual que `Debtor.amount` y
   * `debtCertificate().totalDebt` — a diferencia de `PropertiesService`, que
   * expone `balance` en negativo para cuadrar con el patrón "saldo de
   * cuenta" que ya usa la UI del propietario.
   */
  async computeBalances(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    // Mismo criterio que listDebtors: datos personales especialmente
    // delicados (doctrina AEPD para comunidades) — acceso auditado.
    await this.audit.logAccess(user, 'debtors', 'list', estateId, 'balances');

    const [
      properties,
      receiptSums,
      debtors,
      primaryContacts,
      advanceByProperty,
    ] = await Promise.all([
        this.prisma.property.findMany({
          where: { estateId, deletedAt: null },
          select: { id: true, ref: true, staircase: true, floor: true, door: true },
        }),
        // Lo pendiente de cada recibo (su partida abierta en la 430), no su
        // importe: un recibo cobrado en parte solo debe lo que falta.
        this.prisma.accountingReceipt.groupBy({
          by: ['propertyId'],
          where: {
            property: { estateId, deletedAt: null },
            status: { in: OPEN_RECEIPT_STATUSES },
          },
          _sum: { outstanding: true },
        }),
        this.prisma.debtor.findMany({ where: { estateId } }),
        this.prisma.propertyMembership.findMany({
          where: {
            property: { estateId, deletedAt: null },
            isPrimaryContact: true,
            revokedAt: null,
          },
          select: {
            propertyId: true,
            user: { select: { fullName: true, email: true, phone: true } },
          },
        }),
        // Anticipos sin aplicar (430 acreedora sin recibo): no se restan de
        // `balance` — solo se avisa. Ver doc/contabilidad/adr-partida-doble.md,
        // decisión sobre anticipos y morosidad.
        this.collections.availableAdvancesByEstate(this.prisma, estateId),
      ]);

    const principalByProperty = new Map(
      receiptSums.map((r) => [r.propertyId, r._sum.outstanding ?? new Prisma.Decimal(0)]),
    );
    const debtorByProperty = new Map(
      debtors
        .filter((d): d is typeof d & { propertyId: string } => !!d.propertyId)
        .map((d) => [d.propertyId, d]),
    );
    const contactByProperty = new Map(
      primaryContacts.map((m) => [m.propertyId, m.user]),
    );

    const rows = properties.map((p) => {
      // Ya incluye los intereses de demora liquidados (fase 10): son un
      // recibo más, con su propia partida abierta en la 430.
      const balance = principalByProperty.get(p.id) ?? new Prisma.Decimal(0);
      const debtor = debtorByProperty.get(p.id);
      const contact = contactByProperty.get(p.id);
      return {
        propertyId: p.id,
        property: {
          ref: p.ref,
          staircase: p.staircase,
          floor: p.floor,
          door: p.door,
        },
        titular: contact?.fullName ?? null,
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
        balance,
        // Anticipo sin aplicar (saldo a favor en la 430 sin recibo): se
        // muestra aparte, nunca se resta de `balance`. Aplicarlo es una
        // acción explícita (`POST advances/apply`), no algo automático.
        advance: fromCents(advanceByProperty.get(p.id) ?? 0),
        isUpToDate: balance.isZero(),
        debtorId: debtor?.id ?? null,
        monthsOverdue: debtor?.monthsOverdue ?? 0,
        step: debtor?.step ?? null,
        lastContact: debtor?.lastContact ?? null,
        reminderL1: debtor?.reminderL1 ?? false,
        reminderL2: debtor?.reminderL2 ?? false,
        reminderBf: debtor?.reminderBf ?? false,
      };
    });

    // Mayor deuda primero — mismo orden que listDebtors/listDebtorsByEstate.
    return rows.sort((a, b) => b.balance.comparedTo(a.balance));
  }

  /**
   * Saldo de UNA propiedad, en negativo cuando hay deuda (convención
   * "saldo de cuenta" que ya usa `property-detail.component.ts` del
   * propietario — a diferencia de `computeBalances`, pensado para la
   * pantalla del administrador). Sin comprobación de acceso propia: quien
   * llama (`PropertiesService.findById`) ya la hizo sobre la propiedad.
   */
  async computePropertyBalance(propertyId: string): Promise<number> {
    // Ya incluye los intereses de demora liquidados (fase 10): son un
    // recibo más, con su propia partida abierta en la 430.
    const receiptSum = await this.prisma.accountingReceipt.aggregate({
      where: { propertyId, status: { in: OPEN_RECEIPT_STATUSES } },
      _sum: { outstanding: true },
    });
    const total = receiptSum._sum.outstanding ?? new Prisma.Decimal(0);
    // -0 (en vez de 0) se formatearía como "-0,00 €" en la UI — evitarlo
    // explícitamente cuando no hay deuda real.
    return total.isZero() ? 0 : -total.toNumber();
  }

  /**
   * Anticipo sin aplicar de UNA propiedad (saldo acreedor de su 430 sin
   * recibo), en euros. Se muestra aparte de `computePropertyBalance` — no
   * se resta: aplicarlo es una acción explícita del administrador
   * (`POST advances/apply`), no algo que el saldo mostrado decida solo.
   */
  async computePropertyAdvance(propertyId: string): Promise<number> {
    const cents = await this.prisma.$transaction((tx) =>
      this.collections.availableAdvance(tx, propertyId),
    );
    return fromCents(cents).toNumber();
  }

  /** `.xlsx` de `computeBalances()` — generado al vuelo, ver `DebtorBalancesExcelService`. */
  async generateBalancesExcelFile(
    estateId: string,
    user: AuthenticatedUser,
  ): Promise<{ fileName: string; content: Buffer }> {
    const estate = await this.prisma.estate.findUnique({
      where: { id: estateId },
      select: { name: true },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }
    const rows = await this.computeBalances(estateId, user);
    // La exportación es más sensible que un simple listado en pantalla — se
    // audita aparte, con el mismo resource/action que listDebtors/computeBalances.
    await this.audit.logAccess(user, 'debtors', 'export', estateId, 'balances.xlsx');
    return this.balancesExcel.generate(rows, estate.name);
  }

  private async findDebtorOrThrow(debtorId: string, user: AuthenticatedUser) {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id: debtorId },
    });
    if (!debtor) {
      throw new NotFoundException(`Deudor ${debtorId} no encontrado.`);
    }
    this.estateAccess.assertAccess(debtor.estateId, user);
    return debtor;
  }

  async listActions(debtorId: string, user: AuthenticatedUser) {
    await this.findDebtorOrThrow(debtorId, user);
    return this.prisma.debtorAction.findMany({
      where: { debtorId },
      orderBy: { date: 'desc' },
    });
  }

  async addAction(
    debtorId: string,
    dto: CreateDebtorActionDto,
    user: AuthenticatedUser,
  ) {
    await this.findDebtorOrThrow(debtorId, user);
    return this.prisma.$transaction(async (tx) => {
      const action = await tx.debtorAction.create({
        data: {
          debtorId,
          type: dto.type,
          date: new Date(dto.date),
          note: dto.note,
          result: dto.result ?? null,
          authorUserId: user.id,
          onBehalfOfUserId: dto.onBehalfOfUserId ?? null,
        },
      });
      // A diferencia del mock (que no tocaba el deudor), aquí sí
      // actualizamos lastContact — es el dato que la tabla de morosidad
      // muestra y dejarlo desincronizado del histórico real sería un bug.
      await tx.debtor.update({
        where: { id: debtorId },
        data: { lastContact: new Date(dto.date) },
      });
      return action;
    });
  }

  // ── Acuerdos de pago ───────────────────────────────────────────────────

  async findActiveAgreement(debtorId: string, user: AuthenticatedUser) {
    await this.findDebtorOrThrow(debtorId, user);
    return this.prisma.paymentAgreement.findFirst({
      where: { debtorId, status: 'active' },
      include: { installments: { orderBy: { seq: 'asc' } } },
    });
  }

  async listInstallments(agreementId: string, user: AuthenticatedUser) {
    const agreement = await this.prisma.paymentAgreement.findFirst({
      where: { id: agreementId },
      include: { debtor: { select: { estateId: true } } },
    });
    if (!agreement) {
      throw new NotFoundException(`Acuerdo ${agreementId} no encontrado.`);
    }
    this.estateAccess.assertAccess(agreement.debtor.estateId, user);
    return this.prisma.paymentAgreementInstallment.findMany({
      where: { agreementId },
      orderBy: { seq: 'asc' },
    });
  }

  /**
   * Crea el acuerdo Y todas sus cuotas en la misma transacción (regla de
   * la Fase 7): entrada como seq 0 en la primera fecha, cuotas mensuales
   * seq 1..N, redondeo a 2 decimales con el último plazo absorbiendo la
   * diferencia. Un deudor solo puede tener un acuerdo activo.
   */
  async createAgreement(
    debtorId: string,
    dto: CreatePaymentAgreementDto,
    user: AuthenticatedUser,
  ) {
    const debtor = await this.findDebtorOrThrow(debtorId, user);
    if (!debtor.propertyId) {
      throw new ConflictException(
        'Este deudor no está vinculado a ninguna propiedad: no hay recibos a los que imputar las cuotas.',
      );
    }
    const propertyId = debtor.propertyId;

    const existing = await this.prisma.paymentAgreement.findFirst({
      where: { debtorId, status: 'active' },
    });
    if (existing) {
      throw new ConflictException(
        'Este deudor ya tiene un acuerdo de pago activo.',
      );
    }

    const downPayment = dto.downPaymentAmount ?? 0;
    if (downPayment >= dto.totalAmount) {
      throw new ConflictException(
        'La entrada no puede igualar o superar el total.',
      );
    }
    const remaining = dto.totalAmount - downPayment;
    const perInstallment =
      Math.round((remaining / dto.installmentsCount) * 100) / 100;
    const firstDue = new Date(dto.firstDueDate);

    return this.prisma.$transaction(async (tx) => {
      const agreement = await tx.paymentAgreement.create({
        data: {
          debtorId,
          totalAmount: new Prisma.Decimal(dto.totalAmount),
          downPaymentAmount: new Prisma.Decimal(downPayment),
          installmentsCount: dto.installmentsCount,
          firstDueDate: firstDue,
          status: 'active',
          signedAt: new Date(),
          createdByUserId: user.id,
        },
      });

      // Recibos que el plan salda: los que la propiedad debe al firmarlo.
      // Cada cuota pagada se imputa a ellos (ver markInstallmentPaid).
      const open = await tx.accountingReceipt.findMany({
        where: { propertyId, status: { in: OPEN_RECEIPT_STATUSES } },
        select: { id: true },
      });
      if (open.length > 0) {
        await tx.paymentAgreementReceipt.createMany({
          data: open.map((r) => ({ agreementId: agreement.id, receiptId: r.id })),
        });
      }

      if (downPayment > 0) {
        await tx.paymentAgreementInstallment.create({
          data: {
            agreementId: agreement.id,
            seq: 0,
            dueDate: firstDue,
            amount: new Prisma.Decimal(downPayment),
          },
        });
      }

      for (let i = 1; i <= dto.installmentsCount; i++) {
        const dueDate = new Date(firstDue);
        dueDate.setMonth(dueDate.getMonth() + (i - 1));
        const isLast = i === dto.installmentsCount;
        const amount = isLast
          ? Math.round(
              (remaining - perInstallment * (dto.installmentsCount - 1)) * 100,
            ) / 100
          : perInstallment;
        await tx.paymentAgreementInstallment.create({
          data: {
            agreementId: agreement.id,
            seq: i,
            dueDate,
            amount: new Prisma.Decimal(amount),
          },
        });
      }

      return tx.paymentAgreement.findUniqueOrThrow({
        where: { id: agreement.id },
        include: { installments: { orderBy: { seq: 'asc' } } },
      });
    });
  }

  /**
   * Una cuota pagada es un cobro: entra dinero y se imputa a los recibos que
   * cubre el plan, en orden legal (intereses, lo más antiguo). Si el plan ya
   * no tiene nada pendiente, el cobro queda como anticipo de la propiedad.
   */
  async markInstallmentPaid(
    installmentId: string,
    dto: MarkInstallmentPaidDto,
    user: AuthenticatedUser,
  ) {
    const installment = await this.prisma.paymentAgreementInstallment.findFirst(
      {
        where: { id: installmentId },
        include: {
          agreement: {
            include: {
              debtor: { select: { estateId: true, propertyId: true } },
              coveredReceipts: { select: { receiptId: true } },
            },
          },
        },
      },
    );
    if (!installment) {
      throw new NotFoundException(`Cuota ${installmentId} no encontrada.`);
    }
    this.estateAccess.assertAccess(installment.agreement.debtor.estateId, user);
    if (installment.paidAt) {
      throw new ConflictException('Esta cuota ya está marcada como pagada.');
    }
    if (installment.agreement.status !== 'active') {
      throw new ConflictException('El acuerdo de pago no está activo.');
    }
    const { estateId, propertyId } = installment.agreement.debtor;
    if (!propertyId) {
      throw new ConflictException('El deudor no está vinculado a ninguna propiedad.');
    }
    const covered = installment.agreement.coveredReceipts.map((c) => c.receiptId);
    const date = dto.date ? new Date(`${dto.date.slice(0, 10)}T00:00:00Z`) : new Date();

    return runPosting(this.prisma, async (tx) => {
      const open = await tx.accountingReceipt.findMany({
        where: { id: { in: covered }, status: { in: OPEN_RECEIPT_STATUSES } },
        select: { id: true, no: true, kind: true, outstanding: true, originYear: true, accrualDate: true, dueDate: true },
      });
      const receiptIds = legalImputationOrder(
        open.map((r) => ({ ...r, outstanding: toCents(r.outstanding) })),
      ).map((r) => r.id);
      const collection = await this.collections.collect(tx, {
        estateId,
        propertyId,
        date,
        amount: toCents(installment.amount),
        method: dto.method ?? 'Transferencia',
        bankAccountId: dto.bankAccountId ?? null,
        // Sin recibos pendientes en el plan, todo va a anticipo (no a otros
        // recibos que el plan no cubre).
        receiptIds: receiptIds.length > 0 ? receiptIds : undefined,
        notes: `Cuota ${installment.seq} del plan de pago`,
        createdByUserId: user.id,
      });
      const updated = await tx.paymentAgreementInstallment.update({
        where: { id: installmentId },
        data: { paidAt: new Date(), collectionId: collection.id },
      });

      const pending = await tx.paymentAgreementInstallment.count({
        where: { agreementId: installment.agreementId, paidAt: null },
      });
      if (pending === 0) {
        await tx.paymentAgreement.update({
          where: { id: installment.agreementId },
          data: { status: 'completed' },
        });
      }
      return updated;
    });
  }

  async cancelAgreement(
    agreementId: string,
    reason: string | undefined,
    user: AuthenticatedUser,
  ) {
    const agreement = await this.prisma.paymentAgreement.findFirst({
      where: { id: agreementId },
      include: { debtor: { select: { estateId: true } } },
    });
    if (!agreement) {
      throw new NotFoundException(`Acuerdo ${agreementId} no encontrado.`);
    }
    this.estateAccess.assertAccess(agreement.debtor.estateId, user);
    if (agreement.status !== 'active') {
      throw new ConflictException(
        `Solo un acuerdo activo puede cancelarse (estado: ${agreement.status}).`,
      );
    }
    return this.prisma.paymentAgreement.update({
      where: { id: agreementId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledReason: reason ?? null,
      },
    });
  }

  /**
   * Certificado de estado de deudas de una propiedad (art. 9.1.e LPH):
   * exigible en transmisiones. Deriva de recibos Pendiente/Devuelto y del
   * acuerdo de pago activo si existe — nada se persiste; el certificado
   * refleja el estado en el momento de emisión. Acceso auditado.
   */
  async debtCertificate(propertyId: string, user: AuthenticatedUser) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      include: { estate: { select: { id: true, name: true, cif: true } } },
    });
    if (!property || !property.estate) {
      // Sin finca no hay comunidad de la que certificar deuda (art. 9.1.e
      // es, por definición, deuda CON la comunidad).
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    }
    // Por PROPIEDAD, no por finca: el rol C pide su propio certificado
    // (properties/:propertyId/debt-certificate.pdf) — ver PropertyAccessService.
    await this.propertyAccess.assertAccess(property, user);

    const [pendingReceipts, debtor, interestOriginYears] = await Promise.all([
      this.prisma.accountingReceipt.findMany({
        where: { propertyId, status: { in: OPEN_RECEIPT_STATUSES } },
        include: { period: { select: { label: true, periodKey: true } } },
        orderBy: [{ originYear: 'asc' }, { accrualDate: 'asc' }],
      }),
      this.prisma.debtor.findFirst({
        where: { propertyId },
        include: {
          paymentAgreements: {
            where: { status: 'active' },
            include: { installments: { orderBy: { seq: 'asc' } } },
          },
        },
      }),
      // Fase 10: un recibo de intereses nace en el periodo en que se liquida,
      // no en el año de la deuda que liquida — el certificado (art. 9.1.e)
      // exige desglosar por el año de origen de la deuda, así que aquí se
      // toma prestado el de su(s) tramo(s) (`ReceiptInterestAccrual`).
      this.prisma.receiptInterestAccrual.findMany({
        where: { interestReceipt: { propertyId } },
        distinct: ['interestReceiptId'],
        select: {
          interestReceiptId: true,
          debtReceipt: { select: { originYear: true } },
        },
      }),
    ]);
    const originYearByInterestReceipt = new Map(
      interestOriginYears.map((a) => [
        a.interestReceiptId,
        a.debtReceipt.originYear,
      ]),
    );

    const principal = pendingReceipts
      .filter((r) => r.kind !== 'intereses_demora')
      .reduce((s, r) => s.plus(r.outstanding), new Prisma.Decimal(0));
    const interest = pendingReceipts
      .filter((r) => r.kind === 'intereses_demora')
      .reduce((s, r) => s.plus(r.outstanding), new Prisma.Decimal(0));

    // Art. 9.1.e LPH: el inmueble responde de la parte vencida del año en
    // curso y los 3 años naturales anteriores — lo de antes queda aparte,
    // informativo, sin afectar a la transmisión. Y de esa franja, la
    // cantidad de la que responde el inmueble cuenta SOLO el principal
    // (ADR D22, validado): los intereses se muestran, pero no suman a esa
    // cifra legal.
    const currentYear = new Date().getUTCFullYear();
    const cutoffYear = currentYear - 3;
    const affectedReceipts = pendingReceipts.filter(
      (r) =>
        (originYearByInterestReceipt.get(r.id) ?? r.originYear) >= cutoffYear,
    );
    const olderReceipts = pendingReceipts.filter(
      (r) =>
        (originYearByInterestReceipt.get(r.id) ?? r.originYear) < cutoffYear,
    );
    const sumOutstanding = (
      rows: typeof pendingReceipts,
      isInterest: boolean,
    ) =>
      rows
        .filter((r) => (r.kind === 'intereses_demora') === isInterest)
        .reduce((s, r) => s.plus(r.outstanding), new Prisma.Decimal(0));

    await this.audit.logAccess(user, 'debt_certificate', 'issue', propertyId);

    const mapReceipt = (r: (typeof pendingReceipts)[number]) => ({
      id: r.id,
      no: r.no,
      period: r.period.label,
      concept: r.concept,
      amount: r.amount,
      outstanding: r.outstanding,
      originYear: originYearByInterestReceipt.get(r.id) ?? r.originYear,
      isInterest: r.kind === 'intereses_demora',
      status: r.status,
      dueDate: r.dueDate,
    });

    return {
      issuedAt: new Date().toISOString(),
      issuedByUserId: user.id,
      legalBasis:
        'Art. 9.1.e LPH — certificado de estado de deudas con la comunidad',
      estate: property.estate,
      property: {
        id: property.id,
        ref: property.ref,
        staircase: property.staircase,
        floor: property.floor,
        door: property.door,
      },
      pendingReceipts: pendingReceipts.map(mapReceipt),
      principal,
      interest,
      totalDebt: principal.plus(interest),
      activeAgreement: debtor?.paymentAgreements[0] ?? null,
      isDebtFree: principal.isZero() && interest.isZero(),
      article91e: {
        currentYear,
        cutoffYear,
        receipts: affectedReceipts.map(mapReceipt),
        principal: sumOutstanding(affectedReceipts, false),
        interest: sumOutstanding(affectedReceipts, true),
      },
      priorYears: {
        receipts: olderReceipts.map(mapReceipt),
        principal: sumOutstanding(olderReceipts, false),
        interest: sumOutstanding(olderReceipts, true),
      },
    };
  }

  // ── Devoluciones de remesa (pendiente consciente de la Fase 6) ─────────

  /**
   * Registra la devolución bancaria de una línea de remesa (manual; los
   * ficheros del banco llegan en la fase 6).
   */
  async returnRemesaLine(
    lineId: string,
    dto: RemesaLineReturnDto,
    user: AuthenticatedUser,
  ) {
    const line = await this.prisma.remesaLine.findFirst({
      where: { id: lineId },
      include: { remesa: { select: { id: true, estateId: true } } },
    });
    if (!line) {
      throw new NotFoundException(`Línea de remesa ${lineId} no encontrada.`);
    }
    this.estateAccess.assertAccess(line.remesa.estateId, user);

    // Cobrada: devolución con asiento (y comisión). Sin cobrar: rechazo,
    // sin dinero de por medio. Ver CollectionPostingService.returnRemesaLine.
    return runPosting(this.prisma, (tx) =>
      this.collections.returnRemesaLine(tx, lineId, {
        date: dto.date ? new Date(`${dto.date.slice(0, 10)}T00:00:00Z`) : new Date(),
        returnCode: dto.returnCode,
        returnReason: dto.returnReason ?? null,
        feeAmount: dto.feeAmount ? toCents(dto.feeAmount) : 0,
        rechargeFee: dto.rechargeFee ?? false,
        source: 'manual',
        userId: user.id,
      }),
    );
  }
}
