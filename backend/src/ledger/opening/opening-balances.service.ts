import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '../../prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runPosting } from '../journal/journal-db-errors';
import { JournalService } from '../journal/journal.service';
import type { LineDraft } from '../posting/posting.types';
import { fromCents, toCents, type Cents } from '../money';
import {
  computeOpeningTotals,
  type OpeningTotals,
} from './opening-balances.rules';
import type {
  ConfirmNoPriorBalancesDto,
  PostOpeningDto,
  SaveOpeningDraftDto,
} from './opening-balances.dto';

type Db = Prisma.TransactionClient;

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

function propertyLabel(p: {
  ref: string | null;
  staircase: string | null;
  floor: string | null;
  door: string | null;
}): string {
  return p.ref ?? [p.staircase, p.floor, p.door].filter(Boolean).join('-');
}

function euros(cents: Cents): number {
  return fromCents(cents).toNumber();
}

function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

const SET_INCLUDE = {
  bankBalances: {
    include: { bankAccount: { select: { id: true, alias: true } } },
  },
  propertyDebts: {
    include: {
      property: {
        select: {
          id: true,
          ref: true,
          staircase: true,
          floor: true,
          door: true,
        },
      },
    },
  },
  propertyAdvances: {
    include: {
      property: {
        select: {
          id: true,
          ref: true,
          staircase: true,
          floor: true,
          door: true,
        },
      },
    },
  },
  supplierInvoices: {
    include: { supplier: { select: { id: true, name: true } } },
  },
  otherBalances: true,
} satisfies Prisma.OpeningBalanceSetInclude;

type SetRow = Prisma.OpeningBalanceSetGetPayload<{
  include: typeof SET_INCLUDE;
}>;

/**
 * Saldos iniciales de la finca (fase 9 de
 * doc/contabilidad/roadmap-partida-doble.md): el asiento con el que arranca
 * la contabilidad en Domora. Un único punto de escritura, como el resto del
 * diario — nunca se edita lo contabilizado (ADR, D19): se corrige creando
 * un nuevo borrador que sustituye al anterior (`repost`).
 *
 * Ciclo de un set: Borrador (las filas hijas se editan libres con `PUT`) ->
 * Contabilizado (`post`, un único asiento `entryType='opening'` exactamente
 * en `cutoverDate`) -> si hace falta corregirlo, `PUT` sobre un set ya
 * Contabilizado abre un Borrador nuevo encadenado (`supersedesId`), y
 * `repost` lo contabiliza revirtiendo el anterior (-> Sustituido) en la
 * misma transacción.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly journal: JournalService,
  ) {}

  // ── Lectura ──────────────────────────────────────────────────────────

  async get(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const set = await this.findOrCreateDraft(estateId);
    return this.view(set);
  }

  /**
   * "El set con el que se trabaja ahora": el Borrador si lo hay (aunque
   * exista también un Contabilizado esperando a ser sustituido por él), y
   * si no, el Contabilizado. Dos consultas explícitas en vez de un
   * `findFirst` con `status IN (...)`: ese orden no es el que da Postgres
   * sin un ORDER BY, y aquí SÍ importa cuál gana cuando ambos existen.
   */
  private async findActive(db: Db, estateId: string): Promise<SetRow | null> {
    const draft = await db.openingBalanceSet.findFirst({
      where: { estateId, status: 'Borrador' },
      include: SET_INCLUDE,
    });
    if (draft) return draft;
    return db.openingBalanceSet.findFirst({
      where: { estateId, status: 'Contabilizado' },
      include: SET_INCLUDE,
    });
  }

  private async findOrCreateDraft(estateId: string): Promise<SetRow> {
    const existing = await this.findActive(this.prisma, estateId);
    if (existing) return existing;
    const created = await this.prisma.openingBalanceSet.create({
      data: { estateId },
    });
    return this.prisma.openingBalanceSet.findUniqueOrThrow({
      where: { id: created.id },
      include: SET_INCLUDE,
    });
  }

  private view(set: SetRow) {
    return {
      id: set.id,
      status: set.status,
      difference: set.difference !== null ? Number(set.difference) : null,
      differenceRole: set.differenceRole,
      differenceAccepted: set.differenceAccepted,
      postedAt: set.postedAt,
      entryId: set.entryId,
      supersedesId: set.supersedesId,
      bankBalances: set.bankBalances.map((b) => ({
        id: b.id,
        bankAccountId: b.bankAccountId,
        bankAccountAlias: b.bankAccount.alias,
        balance: Number(b.balance),
        statementBalance:
          b.statementBalance !== null ? Number(b.statementBalance) : null,
      })),
      propertyDebts: set.propertyDebts.map((d) => ({
        id: d.id,
        propertyId: d.propertyId,
        propertyLabel: propertyLabel(d.property),
        originYear: d.originYear,
        concept: d.concept,
        amount: Number(d.amount),
        dueDate: d.dueDate,
      })),
      propertyAdvances: set.propertyAdvances.map((a) => ({
        id: a.id,
        propertyId: a.propertyId,
        propertyLabel: propertyLabel(a.property),
        concept: a.concept,
        amount: Number(a.amount),
      })),
      supplierInvoices: set.supplierInvoices.map((i) => ({
        id: i.id,
        supplierId: i.supplierId,
        supplierName: i.supplier.name,
        number: i.number,
        concept: i.concept,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        amount: Number(i.amount),
        payableRole: i.payableRole,
      })),
      otherBalances: set.otherBalances.map((o) => ({
        id: o.id,
        role: o.role,
        concept: o.concept,
        side: o.side,
        amount: Number(o.amount),
      })),
    };
  }

  // ── Editar el borrador ──────────────────────────────────────────────

  /**
   * Reemplaza TODAS las filas hijas del borrador de una vez — más simple
   * que un diff fila a fila, y el frontend siempre manda el estado
   * completo del asistente. Si el set activo ya está Contabilizado, esto
   * abre un borrador nuevo que lo sustituirá al contabilizar (`repost`).
   */
  async saveDraft(
    estateId: string,
    dto: SaveOpeningDraftDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertOwnership(estateId, dto);

    const set = await runPosting(this.prisma, async (tx) => {
      let current = await this.findActive(tx, estateId);
      if (!current) {
        current = await tx.openingBalanceSet.create({
          data: { estateId },
          include: SET_INCLUDE,
        });
      } else if (current.status === 'Contabilizado') {
        // Editar un set ya contabilizado abre uno nuevo que lo sustituirá
        // al contabilizar (`repost`) — nunca se edita lo contabilizado.
        current = await tx.openingBalanceSet.create({
          data: { estateId, supersedesId: current.id },
          include: SET_INCLUDE,
        });
      }

      await tx.openingBankBalance.deleteMany({ where: { setId: current.id } });
      await tx.openingPropertyDebt.deleteMany({ where: { setId: current.id } });
      await tx.openingPropertyAdvance.deleteMany({
        where: { setId: current.id },
      });
      await tx.openingSupplierInvoice.deleteMany({
        where: { setId: current.id },
      });
      await tx.openingOtherBalance.deleteMany({ where: { setId: current.id } });

      if (dto.bankBalances.length) {
        await tx.openingBankBalance.createMany({
          data: dto.bankBalances.map((b) => ({
            setId: current.id,
            bankAccountId: b.bankAccountId,
            balance: b.balance,
          })),
        });
      }
      if (dto.propertyDebts.length) {
        await tx.openingPropertyDebt.createMany({
          data: dto.propertyDebts.map((d) => ({
            setId: current.id,
            propertyId: d.propertyId,
            originYear: d.originYear,
            concept: d.concept,
            amount: d.amount,
            dueDate: d.dueDate ? day(d.dueDate) : null,
          })),
        });
      }
      if (dto.propertyAdvances.length) {
        await tx.openingPropertyAdvance.createMany({
          data: dto.propertyAdvances.map((a) => ({
            setId: current.id,
            propertyId: a.propertyId,
            concept: a.concept,
            amount: a.amount,
          })),
        });
      }
      if (dto.supplierInvoices.length) {
        await tx.openingSupplierInvoice.createMany({
          data: dto.supplierInvoices.map((i) => ({
            setId: current.id,
            supplierId: i.supplierId,
            number: i.number,
            concept: i.concept,
            issueDate: day(i.issueDate),
            dueDate: i.dueDate ? day(i.dueDate) : null,
            amount: i.amount,
            payableRole: i.payableRole ?? 'suppliers_payable',
          })),
        });
      }
      if (dto.otherBalances.length) {
        await tx.openingOtherBalance.createMany({
          data: dto.otherBalances.map((o) => ({
            setId: current.id,
            role: o.role,
            concept: o.concept,
            side: o.side,
            amount: o.amount,
          })),
        });
      }
      // La diferencia guardada queda desactualizada en cuanto se edita: se
      // limpia aquí y se recalcula en el próximo validate()/post().
      await tx.openingBalanceSet.update({
        where: { id: current.id },
        data: {
          difference: null,
          differenceRole: null,
          differenceAccepted: false,
          differenceAcceptedByUserId: null,
        },
      });

      return this.findActive(tx, estateId) as Promise<SetRow>;
    });

    return this.view(set);
  }

  /** Que ningún ID cuele de otra finca (mismo criterio que EstateScopeGuard en el resto de la app). */
  private async assertOwnership(
    estateId: string,
    dto: SaveOpeningDraftDto,
  ): Promise<void> {
    const bankAccountIds = [
      ...new Set(dto.bankBalances.map((b) => b.bankAccountId)),
    ];
    const propertyIds = [
      ...new Set([
        ...dto.propertyDebts.map((d) => d.propertyId),
        ...dto.propertyAdvances.map((a) => a.propertyId),
      ]),
    ];
    const supplierIds = [
      ...new Set(dto.supplierInvoices.map((i) => i.supplierId)),
    ];

    const [banks, properties, suppliers] = await Promise.all([
      bankAccountIds.length
        ? this.prisma.bankAccount.findMany({
            where: { id: { in: bankAccountIds }, estateId },
            select: { id: true },
          })
        : [],
      propertyIds.length
        ? this.prisma.property.findMany({
            where: { id: { in: propertyIds }, estateId, deletedAt: null },
            select: { id: true },
          })
        : [],
      supplierIds.length
        ? this.prisma.supplier.findMany({
            where: { id: { in: supplierIds }, estateId },
            select: { id: true },
          })
        : [],
    ]);
    const missing = (ids: string[], found: { id: string }[]) =>
      ids.filter((id) => !found.some((f) => f.id === id));
    const missingBanks = missing(bankAccountIds, banks);
    const missingProperties = missing(propertyIds, properties);
    const missingSuppliers = missing(supplierIds, suppliers);
    if (
      missingBanks.length ||
      missingProperties.length ||
      missingSuppliers.length
    ) {
      throw new UnprocessableEntityException(
        'Alguna cuenta bancaria, propiedad o proveedor del borrador no pertenece a esta finca.',
      );
    }
  }

  // ── validate() ───────────────────────────────────────────────────────

  /**
   * Cálculo en vivo, sin persistir nada: totales por lado, diferencia, y
   * si el saldo de cada cuenta bancaria coincide con su último extracto
   * importado (solo informativo — no bloquea).
   */
  async validate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const set = await this.findOrCreateDraft(estateId);
    if (set.status !== 'Borrador') {
      throw new ConflictException(
        'No hay ningún borrador de saldos iniciales pendiente de contabilizar.',
      );
    }
    const totals = this.totalsOf(set);
    const bankMismatches = set.bankBalances
      .filter(
        (b) =>
          b.statementBalance !== null &&
          !fromCents(toCents(b.balance)).equals(b.statementBalance),
      )
      .map((b) => ({
        bankAccountId: b.bankAccountId,
        bankAccountAlias: b.bankAccount.alias,
        entered: Number(b.balance),
        statementBalance: Number(b.statementBalance),
      }));
    return {
      debit: euros(totals.debit),
      credit: euros(totals.credit),
      difference: euros(totals.difference),
      bankMismatches,
    };
  }

  private totalsOf(set: SetRow): OpeningTotals {
    return computeOpeningTotals({
      bankBalances: set.bankBalances.map((b) => ({
        balance: toCents(b.balance),
      })),
      propertyDebts: set.propertyDebts.map((d) => ({
        amount: toCents(d.amount),
      })),
      propertyAdvances: set.propertyAdvances.map((a) => ({
        amount: toCents(a.amount),
      })),
      supplierInvoices: set.supplierInvoices.map((i) => ({
        amount: toCents(i.amount),
      })),
      otherBalances: set.otherBalances.map((o) => ({
        side: o.side,
        amount: toCents(o.amount),
      })),
    });
  }

  // ── post() / repost() ────────────────────────────────────────────────

  /** Primera contabilización: el set activo debe ser un borrador que no sustituye a ningún otro. */
  async post(estateId: string, dto: PostOpeningDto, user: AuthenticatedUser) {
    return this.commit(estateId, dto, user, { expectSupersede: false });
  }

  /** Corrección de un set ya contabilizado: el borrador activo debe encadenar con `supersedesId`. */
  async repost(estateId: string, dto: PostOpeningDto, user: AuthenticatedUser) {
    return this.commit(estateId, dto, user, { expectSupersede: true });
  }

  private async commit(
    estateId: string,
    dto: PostOpeningDto,
    user: AuthenticatedUser,
    opts: { expectSupersede: boolean },
  ) {
    this.estateAccess.assertAccess(estateId, user);

    const result = await runPosting(
      this.prisma,
      async (tx) => {
        const set = await this.findActive(tx, estateId);
        if (!set || set.status !== 'Borrador') {
          throw new ConflictException(
            'No hay ningún borrador de saldos iniciales pendiente de contabilizar.',
          );
        }
        const supersedes = set.supersedesId
          ? await tx.openingBalanceSet.findUnique({
              where: { id: set.supersedesId },
            })
          : null;
        if (opts.expectSupersede && !supersedes) {
          throw new ConflictException(
            'Esto no es una corrección: usa "contabilizar", no "volver a contabilizar".',
          );
        }
        if (!opts.expectSupersede && supersedes) {
          throw new ConflictException(
            'Esto es una corrección de un set ya contabilizado: usa "volver a contabilizar".',
          );
        }

        const totals = this.totalsOf(set);
        // Bancos, anticipos y otros saldos no nacen de un documento propio:
        // van en un único asiento "tronco". Cada deuda y cada factura SÍ
        // exigen su propio asiento (issueEntryId/entryId son 1:1 con su
        // documento — misma garantía que un recibo o una factura del día a
        // día, DM033/DM052), así que cada una lleva su propia contrapartida
        // a `differenceRole`: la suma de todo equivale, céntimo a céntimo,
        // a la diferencia única que se muestra en pantalla (ver
        // opening-balances.rules.ts).
        const trunkDebit =
          set.bankBalances.reduce((s, b) => s + toCents(b.balance), 0) +
          set.otherBalances
            .filter((o) => o.side === 'debit')
            .reduce((s, o) => s + toCents(o.amount), 0);
        const trunkCredit =
          set.propertyAdvances.reduce((s, a) => s + toCents(a.amount), 0) +
          set.otherBalances
            .filter((o) => o.side === 'credit')
            .reduce((s, o) => s + toCents(o.amount), 0);
        const trunkDifference = trunkDebit - trunkCredit;
        const needsDifferenceRole =
          trunkDifference !== 0 ||
          set.propertyDebts.length > 0 ||
          set.supplierInvoices.length > 0;
        if (needsDifferenceRole && !dto.differenceRole) {
          throw new UnprocessableEntityException(
            totals.difference !== 0
              ? `El asiento no cuadra: hay una diferencia de ${euros(totals.difference)} €. Indica a dónde va (fondo de reserva o remanente) para aceptarla.`
              : 'Indica a dónde va la contrapartida de las deudas y facturas de apertura (fondo de reserva o remanente).',
          );
        }

        const settings = await tx.accountingSettings.findUnique({
          where: { estateId },
          select: { cutoverDate: true },
        });
        if (!settings) {
          throw new UnprocessableEntityException(
            'La finca no tiene fecha de inicio contable configurada.',
          );
        }

        if (supersedes) {
          await this.reverseAndCancel(tx, supersedes, user);
        }

        const postOpening = (concept: string, lines: LineDraft[]) => {
          return this.journal.post(tx, {
            estateId,
            date: settings.cutoverDate,
            entryType: 'opening',
            sourceType: 'opening_balance',
            sourceId: set.id,
            concept,
            createdByUserId: user.id,
            lines,
          });
        };

        // ── Tronco: bancos, anticipos, otros saldos y su propio residuo ──
        const trunkLines: LineDraft[] = [];
        for (const b of set.bankBalances) {
          trunkLines.push({
            account: { bankAccountId: b.bankAccountId },
            debit: toCents(b.balance),
            concept: 'Saldo bancario de apertura',
          });
        }
        for (const a of set.propertyAdvances) {
          trunkLines.push({
            account: { role: 'owners_receivable' },
            credit: toCents(a.amount),
            propertyId: a.propertyId,
            concept: a.concept,
          });
        }
        for (const o of set.otherBalances) {
          const cents = toCents(o.amount);
          trunkLines.push({
            account: { role: o.role },
            ...(o.side === 'debit' ? { debit: cents } : { credit: cents }),
            concept: o.concept,
          });
        }
        if (trunkDifference !== 0 && dto.differenceRole) {
          const cents = Math.abs(trunkDifference);
          trunkLines.push({
            account: { role: dto.differenceRole },
            // trunkDifference = debe - haber > 0 ⇒ sobra debe ⇒ hay que abonar.
            ...(trunkDifference > 0 ? { credit: cents } : { debit: cents }),
            concept: 'Diferencia de apertura aceptada',
          });
        }
        let mainEntryId: string | null = null;
        if (trunkLines.length >= 2) {
          const trunkEntry = await postOpening(
            'Asiento de apertura',
            trunkLines,
          );
          mainEntryId = trunkEntry.id;
        }

        // ── Una deuda de propiedad, un recibo `saldo_anterior`, su propio asiento ──
        for (const d of set.propertyDebts) {
          const period = await this.findOrCreateOriginPeriod(
            tx,
            estateId,
            d.originYear,
          );
          const no = await this.nextOpeningReceiptNo(tx, estateId, period.id);
          const receipt = await tx.accountingReceipt.create({
            data: {
              estateId,
              no,
              periodId: period.id,
              propertyId: d.propertyId,
              concept: d.concept,
              kind: 'saldo_anterior',
              amount: d.amount,
              outstanding: d.amount,
              accrualDate: settings.cutoverDate,
              originYear: d.originYear,
              dueDate: d.dueDate,
              status: 'Pendiente',
              date: settings.cutoverDate,
              method: 'Pendiente',
              manual: true,
              includeInRemesa: false,
              openingSetId: set.id,
            },
          });
          await tx.openingPropertyDebt.update({
            where: { id: d.id },
            data: { receipt: { connect: { id: receipt.id } } },
          });
          const debtCents = toCents(d.amount);
          const entry = await postOpening(`Saldo anterior · ${d.concept}`, [
            {
              account: { role: 'owners_receivable' },
              debit: debtCents,
              propertyId: d.propertyId,
              receiptId: receipt.id,
              concept: d.concept,
            },
            {
              account: { role: dto.differenceRole! },
              credit: debtCents,
              concept: 'Contrapartida de apertura',
            },
          ]);
          await tx.accountingReceipt.update({
            where: { id: receipt.id },
            data: { issueEntryId: entry.id },
          });
          mainEntryId ??= entry.id;
        }

        // ── Una factura de proveedor pendiente, su propio asiento ────────
        for (const i of set.supplierInvoices) {
          const invoiceCents = toCents(i.amount);
          const invoice = await tx.supplierInvoice.create({
            data: {
              estateId,
              supplierId: i.supplierId,
              number: i.number,
              concept: i.concept,
              issueDate: i.issueDate,
              receivedDate: i.issueDate,
              dueDate: i.dueDate,
              baseAmount: i.amount,
              vatRatePct: 0,
              vatAmount: 0,
              withholdingRatePct: 0,
              withholdingAmount: 0,
              total: i.amount,
              payable: i.amount,
              payableRole: i.payableRole,
              status: 'Registrada',
              outstanding: i.amount,
              openingSetId: set.id,
            },
          });
          await tx.openingSupplierInvoice.update({
            where: { id: i.id },
            data: { invoice: { connect: { id: invoice.id } } },
          });
          const entry = await postOpening(
            `Factura pendiente de apertura · ${i.concept}`,
            [
              {
                account: { role: dto.differenceRole! },
                debit: invoiceCents,
                concept: 'Contrapartida de apertura',
              },
              {
                account: { role: i.payableRole },
                credit: invoiceCents,
                supplierId: i.supplierId,
                supplierInvoiceId: invoice.id,
                concept: i.concept,
              },
            ],
          );
          await tx.supplierInvoice.update({
            where: { id: invoice.id },
            data: { entryId: entry.id },
          });
          mainEntryId ??= entry.id;
        }

        if (!mainEntryId) {
          throw new UnprocessableEntityException(
            'No hay ningún saldo que contabilizar: añade al menos una fila al borrador.',
          );
        }

        // El viejo se marca Sustituido ANTES de contabilizar el nuevo: el
        // índice único "a lo sumo un Contabilizado por finca" se comprueba
        // al vuelo (no es diferido, a diferencia de las garantías DM) — con
        // los dos en Contabilizado a la vez, aunque fuera solo un instante,
        // la segunda UPDATE lo rechazaría.
        if (supersedes) {
          await tx.openingBalanceSet.update({
            where: { id: supersedes.id },
            data: { status: 'Sustituido' },
          });
        }
        await tx.openingBalanceSet.update({
          where: { id: set.id },
          data: {
            status: 'Contabilizado',
            entryId: mainEntryId,
            difference: fromCents(totals.difference),
            differenceRole: needsDifferenceRole ? dto.differenceRole : null,
            differenceAccepted: needsDifferenceRole,
            differenceAcceptedByUserId: needsDifferenceRole ? user.id : null,
            postedAt: new Date(),
            postedByUserId: user.id,
          },
        });

        return this.findActive(tx, estateId) as Promise<SetRow>;
      },
      { timeoutMs: 60_000 },
    );

    return this.view(result);
  }

  /** Contraasiento del asiento superado, y anulación de sus recibos/facturas de apertura. */
  /**
   * Revierte TODOS los asientos del set superado (uno por deuda, uno por
   * factura y el tronco de bancos/anticipos/otros, ver `commit`) y anula
   * sus recibos y facturas — mismo criterio que `ReceiptPostingService.cancel`
   * y el pago de proveedor: `outstanding` a 0 y `cancelEntryId` puestos a
   * la vez que el contraasiento, porque el trigger diferido de recibos y
   * facturas (DM031/DM051) exige que "Anulado/Anulada" y "pendiente = 0"
   * lleguen juntos al confirmar.
   */
  private async reverseAndCancel(
    tx: Db,
    supersedes: { id: string },
    user: AuthenticatedUser,
  ): Promise<void> {
    const [receipts, invoices] = await Promise.all([
      tx.accountingReceipt.findMany({
        where: { openingSetId: supersedes.id },
        select: { id: true, no: true, issueEntryId: true },
      }),
      tx.supplierInvoice.findMany({
        where: { openingSetId: supersedes.id },
        select: { id: true, number: true, entryId: true },
      }),
    ]);
    const now = new Date();
    const reason = 'Saldos iniciales corregidos';
    const reverse = (entryId: string, date: Date) =>
      this.journal.reverse(tx, entryId, {
        date,
        concept: reason,
        createdByUserId: user.id,
      });

    const documentEntryIds = new Set<string>();
    for (const r of receipts) {
      if (!r.issueEntryId) continue; // no debería pasar: siempre se pone al contabilizar
      documentEntryIds.add(r.issueEntryId);
      const entry = await tx.journalEntry.findUniqueOrThrow({
        where: { id: r.issueEntryId },
        select: { date: true },
      });
      const reversal = await reverse(r.issueEntryId, entry.date);
      await tx.accountingReceipt.update({
        where: { id: r.id },
        data: {
          status: 'Anulado',
          outstanding: fromCents(0),
          cancelEntryId: reversal.id,
          cancelledAt: now,
          cancelledByUserId: user.id,
          cancelReason: reason,
        },
      });
    }
    for (const i of invoices) {
      if (!i.entryId) continue;
      documentEntryIds.add(i.entryId);
      const entry = await tx.journalEntry.findUniqueOrThrow({
        where: { id: i.entryId },
        select: { date: true },
      });
      const reversal = await reverse(i.entryId, entry.date);
      await tx.supplierInvoice.update({
        where: { id: i.id },
        data: {
          status: 'Anulada',
          outstanding: fromCents(0),
          cancelEntryId: reversal.id,
          cancelledAt: now,
          cancelledByUserId: user.id,
          cancelReason: reason,
        },
      });
    }

    // El tronco (bancos/anticipos/otros): un asiento más del mismo set, sin
    // recibo ni factura propios que anular — solo revertirlo.
    const trunkEntries = await tx.journalEntry.findMany({
      // reversesEntryId: null descarta los contraasientos que se acaban de
      // crear arriba: comparten sourceType/sourceId con el original (así
      // se sabe de qué set son), pero un contraasiento no se revierte.
      where: {
        sourceType: 'opening_balance',
        sourceId: supersedes.id,
        reversedBy: null,
        reversesEntryId: null,
      },
      select: { id: true, date: true },
    });
    for (const entry of trunkEntries) {
      if (documentEntryIds.has(entry.id)) continue;
      await reverse(entry.id, entry.date);
    }
  }

  private async findOrCreateOriginPeriod(
    tx: Db,
    estateId: string,
    originYear: number,
  ) {
    const periodKey = `${originYear}-12`;
    const existing = await tx.accountingPeriod.findUnique({
      where: { estateId_periodKey: { estateId, periodKey } },
    });
    if (existing) return existing;
    return tx.accountingPeriod.create({
      data: {
        estateId,
        periodKey,
        label: `Saldo anterior ${originYear}`,
        monthAbbrev: MONTH_LABELS[11].slice(0, 3).toUpperCase(),
      },
    });
  }

  private async nextOpeningReceiptNo(
    tx: Db,
    estateId: string,
    periodId: string,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "receipt_sequences" ("estate_id", "series", "last")
      VALUES (${estateId}::uuid, 'APERTURA', (SELECT count(*)::int + 1 FROM "receipts" WHERE "period_id" = ${periodId}::uuid))
      ON CONFLICT ("estate_id", "series")
      DO UPDATE SET "last" = "receipt_sequences"."last" + 1
      RETURNING "last"
    `;
    return `A-${rows[0].last}`;
  }

  // ── "Sin saldos previos" ─────────────────────────────────────────────

  async confirmNoPriorBalances(
    estateId: string,
    dto: ConfirmNoPriorBalancesDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const active = await this.findActive(this.prisma, estateId);
    if (active?.status === 'Contabilizado') {
      throw new ConflictException(
        'Esta finca ya tiene un asiento de apertura contabilizado: no tiene sentido confirmar que no hay saldos previos.',
      );
    }
    await this.prisma.accountingSettings.update({
      where: { estateId },
      data: {
        noPriorBalancesConfirmedAt: new Date(),
        noPriorBalancesConfirmedByUserId: user.id,
      },
    });
  }
}
