import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runPosting } from '../journal/journal-db-errors';
import { JournalService } from '../journal/journal.service';
import { LedgerQueryService } from '../ledger-query.service';
import { fromCents, toCents, type Cents } from '../money';
import type { LineDraft } from '../posting/posting.types';
import {
  closingLine,
  computeReserveAllocation,
  openingLine,
} from './year-close.rules';
import type { ApplyResultDto, ReopenFiscalYearDto } from './year-close.dto';

type Db = Prisma.TransactionClient;

const OPEN_RECEIPT_STATUSES = ['Pendiente', 'Parcial', 'Devuelto'] as const;
const OPEN_INVOICE_STATUSES = ['Registrada', 'Parcial'] as const;
/** Mismos tipos que excluye "balance a una fecha" (se anulan entre sí, LedgerQueryService.BALANCE_EXCLUDED). */
const BALANCE_SHEET_EXCLUDED = ['closing', 'year_opening'] as const;

export interface ClosePreconditionItem {
  code: string;
  message: string;
}

export interface ClosePreconditionsView {
  year: number;
  blockers: ClosePreconditionItem[];
  warnings: ClosePreconditionItem[];
  canClose: boolean;
}

interface BalanceRow {
  accountId: string;
  code: string;
  nature: string;
  systemRole: string | null;
  balanceCents: Cents;
}

/**
 * Cierre de ejercicio real (fase 11 de doc/contabilidad/roadmap-partida-doble.md):
 * regularización del resultado, dotación de reserva en el cierre (modo
 * `year_end_allocation`/`both`), cierre por dimensión de todas las cuentas
 * de balance (una línea por cada partida abierta de 430/400/410, una línea
 * agregada para el resto) y apertura espejo del año siguiente — todo en la
 * MISMA transacción, porque los triggers diferidos de recibos y facturas
 * (DM030/031/050/051) comprueban el saldo acumulado al confirmar: cerrar
 * sin reabrir en el acto dejaría a cualquier recibo o factura con un
 * pendiente que no cuadra con su contabilidad.
 */
@Injectable()
export class YearCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly journal: JournalService,
    private readonly ledgerQuery: LedgerQueryService,
  ) {}

  // ── Precondiciones ───────────────────────────────────────────────────

  async preconditions(
    estateId: string,
    year: number,
    user: AuthenticatedUser,
  ): Promise<ClosePreconditionsView> {
    this.estateAccess.assertAccess(estateId, user);
    return this.computePreconditions(estateId, year);
  }

  private async computePreconditions(
    estateId: string,
    year: number,
  ): Promise<ClosePreconditionsView> {
    const blockers: ClosePreconditionItem[] = [];
    const warnings: ClosePreconditionItem[] = [];

    const [
      fy,
      prevFy,
      openingDraft,
      generatedRemesa,
      totals,
      figures,
      legalMinimum,
    ] = await Promise.all([
      this.prisma.fiscalYear.findUnique({
        where: { estateId_year: { estateId, year } },
      }),
      this.prisma.fiscalYear.findUnique({
        where: { estateId_year: { estateId, year: year - 1 } },
      }),
      this.prisma.openingBalanceSet.findFirst({
        where: { estateId, status: 'Borrador' },
      }),
      this.prisma.remesaHistoryItem.findFirst({
        where: { estateId, status: 'Presentada' },
      }),
      this.ledgerQuery.trialTotals(estateId),
      this.ledgerQuery.estateFigures(estateId, year),
      this.legalMinimumCents(this.prisma, estateId, year),
    ]);

    if (fy?.status === 'Cerrado') {
      blockers.push({
        code: 'already_closed',
        message: `El ejercicio ${year} ya está cerrado.`,
      });
    }
    if (prevFy && prevFy.status === 'Abierto') {
      blockers.push({
        code: 'previous_year_open',
        message: `El ejercicio ${year - 1} sigue abierto: ciérralo primero.`,
      });
    }
    if (openingDraft) {
      blockers.push({
        code: 'opening_draft',
        message:
          'Hay un borrador de saldos iniciales sin contabilizar: contabilízalo o descártalo antes de cerrar.',
      });
    }
    if (generatedRemesa) {
      blockers.push({
        code: 'remesa_generated',
        message:
          'Hay una remesa presentada al banco, pendiente de cobrar o anular: resuélvela antes de cerrar.',
      });
    }
    const yearTotal = totals.find((t) => t.fiscalYear === year);
    if (yearTotal && !yearTotal.debit.equals(yearTotal.credit)) {
      blockers.push({
        code: 'unbalanced',
        message: `El ejercicio ${year} no cuadra (esto no debería pasar nunca; contacta con soporte).`,
      });
    }

    if (!fy?.approvedAt) {
      warnings.push({
        code: 'not_approved',
        message:
          'Las cuentas de este ejercicio todavía no están aprobadas en junta.',
      });
    }
    const reserveCents = toCents(figures.reserve);
    if (reserveCents < legalMinimum) {
      warnings.push({
        code: 'reserve_below_legal_minimum',
        message: `El fondo de reserva (${fromCents(reserveCents).toFixed(2)} €) está por debajo del mínimo legal (${fromCents(legalMinimum).toFixed(2)} €, art. 9.1.f LPH).`,
      });
    }

    return { year, blockers, warnings, canClose: blockers.length === 0 };
  }

  /** 10 % de la suma presupuestada del ejercicio (mismo criterio que BudgetService.analysis — art. 9.1.f LPH). */
  private async legalMinimumCents(
    db: Db | PrismaService,
    estateId: string,
    year: number,
  ): Promise<Cents> {
    const agg = await db.budgetItem.aggregate({
      where: { estateId, fiscalYear: year },
      _sum: { budgeted: true },
    });
    return agg._sum.budgeted ? toCents(agg._sum.budgeted).valueOf() * 0.1 : 0;
  }

  // ── Cierre ────────────────────────────────────────────────────────────

  async close(estateId: string, year: number, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return runPosting(
      this.prisma,
      (tx) => this.doClose(tx, estateId, year, user),
      { timeoutMs: 120_000 },
    );
  }

  private async doClose(
    tx: Db,
    estateId: string,
    year: number,
    user: AuthenticatedUser,
  ) {
    // FOR UPDATE: un segundo cierre simultáneo del mismo ejercicio espera a
    // este y luego lo ve ya cerrado.
    const rows = await tx.$queryRaw<
      { id: string; status: string; end_date: Date }[]
    >`SELECT "id", "status", "end_date" FROM "fiscal_years"
       WHERE "estate_id" = ${estateId}::uuid AND "year" = ${year} FOR UPDATE`;
    const fy = rows[0];
    if (!fy) {
      throw new NotFoundException(
        `El ejercicio ${year} no existe todavía en esta finca (nunca se contabilizó nada).`,
      );
    }
    if (fy.status === 'Cerrado') {
      throw new ConflictException(`El ejercicio ${year} ya está cerrado.`);
    }
    const prevFy = await tx.fiscalYear.findUnique({
      where: { estateId_year: { estateId, year: year - 1 } },
      select: { status: true },
    });
    if (prevFy?.status === 'Abierto') {
      throw new ConflictException(
        `El ejercicio ${year - 1} sigue abierto: ciérralo primero.`,
      );
    }
    const [openingDraft, generatedRemesa] = await Promise.all([
      tx.openingBalanceSet.findFirst({
        where: { estateId, status: 'Borrador' },
      }),
      tx.remesaHistoryItem.findFirst({
        where: { estateId, status: 'Presentada' },
      }),
    ]);
    if (openingDraft) {
      throw new UnprocessableEntityException(
        'Hay un borrador de saldos iniciales sin contabilizar: contabilízalo o descártalo antes de cerrar.',
      );
    }
    if (generatedRemesa) {
      throw new UnprocessableEntityException(
        'Hay una remesa presentada al banco, pendiente de cobrar o anular: resuélvela antes de cerrar.',
      );
    }

    const endDate = fy.end_date;
    const nextYear = year + 1;
    const nextYearStart = new Date(Date.UTC(nextYear, 0, 1));

    const post = (
      concept: string,
      lines: LineDraft[],
      date: Date,
      entryType:
        'regularization' | 'result_allocation' | 'closing' | 'year_opening',
    ) =>
      this.journal.post(tx, {
        estateId,
        date,
        entryType,
        sourceType: 'year_close',
        sourceId: fy.id,
        concept,
        createdByUserId: user.id,
        lines,
      });

    // ── 1. Regularización: 6xx/7xx del año a cero, la diferencia a la 129 ──
    const pnlRows = await this.accountBalances(tx, estateId, {
      fiscalYear: year,
      natureIn: ['income', 'expense'],
      excludeEntryTypes: [
        'regularization',
        'closing',
        'year_opening',
        'result_allocation',
      ],
    });
    const pnlLines: LineDraft[] = [];
    let pnlSum = 0; // suma de balances (debe - haber) de las 6xx/7xx del año
    for (const r of pnlRows) {
      const line = closingLine(r.accountId, r.balanceCents);
      if (line) pnlLines.push(line);
      pnlSum += r.balanceCents;
    }
    const result = -pnlSum; // positivo = beneficio
    // La contrapartida a la 129 debe dejar el asiento cuadrado: cada
    // closingLine de arriba aporta -balance a la suma (debe - haber), así
    // que el saldo necesita el signo CONTRARIO al de closingLine, es decir
    // el de openingLine — nunca closingLine de nuevo, o el asiento no cuadra.
    if (pnlSum !== 0) {
      pnlLines.push(
        pnlSum > 0
          ? { account: { role: 'result' }, debit: pnlSum }
          : { account: { role: 'result' }, credit: -pnlSum },
      );
    }
    if (pnlLines.length > 0) {
      await post(
        `Regularización del ejercicio ${year}`,
        pnlLines,
        endDate,
        'regularization',
      );
    }

    // ── 2. Dotación de reserva en el cierre (modo year_end_allocation/both) ──
    if (result > 0) {
      const fyFull = await tx.fiscalYear.findUniqueOrThrow({
        where: { id: fy.id },
        select: {
          reserveMode: true,
          reserveAllocationRule: true,
          reserveAllocationValue: true,
        },
      });
      if (
        fyFull.reserveMode === 'year_end_allocation' ||
        fyFull.reserveMode === 'both'
      ) {
        if (!fyFull.reserveAllocationRule) {
          throw new UnprocessableEntityException(
            'El fondo de reserva de este ejercicio está en modo "dotación al cierre", pero no tiene ninguna regla configurada.',
          );
        }
        const reserveBalanceRows = await this.accountBalances(tx, estateId, {
          to: endDate,
          systemRoleIn: ['reserve_fund'],
          excludeEntryTypes: [...BALANCE_SHEET_EXCLUDED],
        });
        const currentReserveCents = -reserveBalanceRows.reduce(
          (s, r) => s + r.balanceCents,
          0,
        );
        const legalMinimum = await this.legalMinimumCents(tx, estateId, year);
        const allocationCents = computeReserveAllocation({
          rule: fyFull.reserveAllocationRule,
          value: fyFull.reserveAllocationValue,
          resultCents: result,
          currentReserveCents,
          legalMinimumCents: legalMinimum,
        });
        if (allocationCents > 0) {
          await post(
            `Dotación al fondo de reserva del ejercicio ${year}`,
            [
              { account: { role: 'result' }, debit: allocationCents },
              { account: { role: 'reserve_fund' }, credit: allocationCents },
            ],
            endDate,
            'result_allocation',
          );
        }
      }
    }

    // ── 3. Cierre por dimensión: partidas abiertas de 430/400/410, y el resto agregado ──
    const closingLines: LineDraft[] = [];
    const openingLines: LineDraft[] = [];

    const [openReceipts, openInvoices] = await Promise.all([
      tx.accountingReceipt.findMany({
        where: { estateId, status: { in: [...OPEN_RECEIPT_STATUSES] } },
        select: { id: true, propertyId: true, outstanding: true },
      }),
      tx.supplierInvoice.findMany({
        where: { estateId, status: { in: [...OPEN_INVOICE_STATUSES] } },
        select: {
          id: true,
          supplierId: true,
          outstanding: true,
          payableRole: true,
        },
      }),
    ]);
    for (const r of openReceipts) {
      const cents = toCents(r.outstanding);
      if (cents === 0) continue;
      const dims = { propertyId: r.propertyId, receiptId: r.id };
      const cLine = closingLine('', cents, dims);
      const oLine = openingLine('', cents, dims);
      if (cLine)
        closingLines.push({ ...cLine, account: { role: 'owners_receivable' } });
      if (oLine)
        openingLines.push({ ...oLine, account: { role: 'owners_receivable' } });
    }
    for (const i of openInvoices) {
      // v_open de la factura es (credit - debit): lo contrario del criterio "debit - credit" del resto.
      const cents = -toCents(i.outstanding);
      if (cents === 0) continue;
      const dims = { supplierId: i.supplierId, supplierInvoiceId: i.id };
      const cLine = closingLine('', cents, dims);
      const oLine = openingLine('', cents, dims);
      if (cLine)
        closingLines.push({ ...cLine, account: { role: i.payableRole } });
      if (oLine)
        openingLines.push({ ...oLine, account: { role: i.payableRole } });
    }

    // Un anticipo (línea de la 430 sin recibo, saldo acreedor de la
    // propiedad) NO es una partida abierta de ningún recibo, así que el
    // bucle de `openReceipts` de arriba nunca lo toca — y como es de la
    // 430, `excludeSystemRoleIn` de `genericRows` más abajo lo descarta
    // también. Sin este bloque, cualquier finca con un anticipo sin
    // aplicar no podía cerrar el ejercicio: el asiento de cierre quedaba
    // descuadrado exactamente por ese importe. Se cierra y reabre por
    // propiedad, igual que un recibo, pero sin `receiptId`.
    const advanceRows = await tx.$queryRaw<
      { property_id: string; balance: Prisma.Decimal }[]
    >`
      SELECT jl."property_id", sum(jl."debit" - jl."credit") AS balance
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
       WHERE jl."estate_id" = ${estateId}::uuid
         AND a."system_role" = 'owners_receivable'
         AND jl."receipt_id" IS NULL
         AND jl."date" <= ${endDate}::date
         AND jl."entry_type"::text NOT IN (${Prisma.join(BALANCE_SHEET_EXCLUDED.map((t) => Prisma.sql`${t}`))})
       GROUP BY jl."property_id"
    `;
    for (const r of advanceRows) {
      const cents = toCents(r.balance);
      if (cents === 0) continue;
      const dims = { propertyId: r.property_id };
      const cLine = closingLine('', cents, dims);
      const oLine = openingLine('', cents, dims);
      if (cLine)
        closingLines.push({ ...cLine, account: { role: 'owners_receivable' } });
      if (oLine)
        openingLines.push({ ...oLine, account: { role: 'owners_receivable' } });
    }

    const genericRows = await this.accountBalances(tx, estateId, {
      to: endDate,
      natureNotIn: ['income', 'expense'],
      excludeSystemRoleIn: [
        'owners_receivable',
        'suppliers_payable',
        'creditors_payable',
      ],
      excludeEntryTypes: [...BALANCE_SHEET_EXCLUDED],
    });
    for (const r of genericRows) {
      const cLine = closingLine(r.accountId, r.balanceCents);
      const oLine = openingLine(r.accountId, r.balanceCents);
      if (cLine) closingLines.push(cLine);
      if (oLine) openingLines.push(oLine);
    }

    if (closingLines.length > 0) {
      await post(
        `Cierre del ejercicio ${year}`,
        closingLines,
        endDate,
        'closing',
      );
      await post(
        `Apertura del ejercicio ${nextYear}`,
        openingLines,
        nextYearStart,
        'year_opening',
      );
    }

    // ── 4. Marcar el ejercicio cerrado ───────────────────────────────────
    await tx.fiscalYear.update({
      where: { id: fy.id },
      data: {
        status: 'Cerrado',
        closedAt: new Date(),
        closedByUserId: user.id,
      },
    });
    await tx.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'fiscal_year',
        subjectId: fy.id,
        verb: 'status_changed',
        summary: `Ejercicio ${year} cerrado`,
        occurredAt: new Date(),
        estateId,
      },
    });

    return tx.fiscalYear.findUniqueOrThrow({ where: { id: fy.id } });
  }

  // ── Reapertura ────────────────────────────────────────────────────────

  async reopen(
    estateId: string,
    year: number,
    dto: ReopenFiscalYearDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    return runPosting(
      this.prisma,
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT "id", "status" FROM "fiscal_years"
           WHERE "estate_id" = ${estateId}::uuid AND "year" = ${year} FOR UPDATE`;
        const fy = rows[0];
        if (!fy) throw new NotFoundException(`El ejercicio ${year} no existe.`);
        if (fy.status !== 'Cerrado') {
          throw new ConflictException(`El ejercicio ${year} no está cerrado.`);
        }
        const nextFy = await tx.fiscalYear.findUnique({
          where: { estateId_year: { estateId, year: year + 1 } },
          select: { status: true },
        });
        if (nextFy?.status === 'Cerrado') {
          throw new ConflictException(
            `El ejercicio ${year + 1} ya está cerrado: reábrelo primero a él.`,
          );
        }

        // Se reabre ANTES de revertir: los contraasientos van fechados el
        // mismo día que el original (dentro del ejercicio N, o en la
        // apertura de N+1), y el trigger de asientos (DM015) rechaza
        // contabilizar en un ejercicio que siga marcado como Cerrado.
        await tx.fiscalYear.update({
          where: { id: fy.id },
          data: {
            status: 'Abierto',
            reopenedAt: new Date(),
            reopenReason: dto.reason,
          },
        });

        const entries = await tx.journalEntry.findMany({
          where: {
            estateId,
            sourceType: 'year_close',
            sourceId: fy.id,
            reversedBy: null,
            reversesEntryId: null,
          },
          orderBy: { date: 'desc' },
          select: { id: true, date: true },
        });
        for (const entry of entries) {
          await this.journal.reverse(tx, entry.id, {
            date: entry.date,
            concept: `Reapertura del ejercicio ${year}: ${dto.reason}`,
            createdByUserId: user.id,
          });
        }
        await tx.activityLogEntry.create({
          data: {
            actorUserId: user.id,
            subjectType: 'fiscal_year',
            subjectId: fy.id,
            verb: 'status_changed',
            summary: `Ejercicio ${year} reabierto: ${dto.reason}`,
            occurredAt: new Date(),
            estateId,
          },
        });

        return tx.fiscalYear.findUniqueOrThrow({ where: { id: fy.id } });
      },
      { timeoutMs: 120_000 },
    );
  }

  // ── Aplicación del resultado ─────────────────────────────────────────

  /**
   * Reclasifica lo que quedó en la 129 tras el cierre (y su posible
   * dotación) a remanente (120) o fondo de reserva (117) — tras la
   * aprobación en junta. Se contabiliza en el ejercicio SIGUIENTE al
   * cerrado (donde vive ahora ese saldo, vía la apertura espejo).
   * Devolución por coeficiente: fuera de alcance (roadmap, fase 11).
   */
  async applyResult(
    estateId: string,
    year: number,
    dto: ApplyResultDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    return runPosting(this.prisma, async (tx) => {
      const fy = await tx.fiscalYear.findUnique({
        where: { estateId_year: { estateId, year } },
        select: { id: true, status: true, endDate: true },
      });
      if (!fy || fy.status !== 'Cerrado') {
        throw new UnprocessableEntityException(
          `El ejercicio ${year} no está cerrado: no hay resultado que aplicar todavía.`,
        );
      }
      const resultRows = await this.accountBalances(tx, estateId, {
        to: new Date(),
        systemRoleIn: ['result'],
        excludeEntryTypes: [...BALANCE_SHEET_EXCLUDED],
      });
      const resultCents = -resultRows.reduce((s, r) => s + r.balanceCents, 0);
      if (resultCents === 0) {
        throw new UnprocessableEntityException(
          'No queda ningún resultado pendiente de aplicar.',
        );
      }
      const applyDate = new Date();
      const line =
        resultCents > 0
          ? [
              { account: { role: 'result' as const }, debit: resultCents },
              { account: { role: dto.target }, credit: resultCents },
            ]
          : [
              { account: { role: dto.target }, debit: -resultCents },
              { account: { role: 'result' as const }, credit: -resultCents },
            ];
      const entry = await this.journal.post(tx, {
        estateId,
        date: applyDate,
        entryType: 'result_allocation',
        sourceType: 'year_close',
        sourceId: fy.id,
        concept: `Aplicación del resultado del ejercicio ${year}`,
        createdByUserId: user.id,
        lines: line,
      });
      return {
        entryId: entry.id,
        appliedAmount: fromCents(resultCents).toNumber(),
        target: dto.target,
      };
    });
  }

  // ── Consultas de saldo dentro de la transacción ──────────────────────

  private async accountBalances(
    db: Db,
    estateId: string,
    opts: {
      fiscalYear?: number;
      to?: Date;
      natureIn?: string[];
      natureNotIn?: string[];
      systemRoleIn?: string[];
      excludeSystemRoleIn?: string[];
      excludeEntryTypes?: string[];
    },
  ): Promise<BalanceRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`jl."estate_id" = ${estateId}::uuid`,
    ];
    if (opts.fiscalYear !== undefined) {
      conditions.push(Prisma.sql`jl."fiscal_year" = ${opts.fiscalYear}`);
    }
    if (opts.to) conditions.push(Prisma.sql`jl."date" <= ${opts.to}::date`);
    if (opts.natureIn?.length) {
      conditions.push(
        Prisma.sql`a."nature"::text IN (${Prisma.join(opts.natureIn)})`,
      );
    }
    if (opts.natureNotIn?.length) {
      conditions.push(
        Prisma.sql`a."nature"::text NOT IN (${Prisma.join(opts.natureNotIn)})`,
      );
    }
    if (opts.systemRoleIn?.length) {
      conditions.push(
        Prisma.sql`a."system_role"::text IN (${Prisma.join(opts.systemRoleIn)})`,
      );
    }
    if (opts.excludeSystemRoleIn?.length) {
      conditions.push(
        Prisma.sql`(a."system_role" IS NULL OR a."system_role"::text NOT IN (${Prisma.join(opts.excludeSystemRoleIn)}))`,
      );
    }
    if (opts.excludeEntryTypes?.length) {
      conditions.push(
        Prisma.sql`jl."entry_type"::text NOT IN (${Prisma.join(opts.excludeEntryTypes)})`,
      );
    }

    const rows = await db.$queryRaw<
      {
        account_id: string;
        code: string;
        nature: string;
        system_role: string | null;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >(
      Prisma.sql`
        SELECT a."id" AS account_id, a."code", a."nature"::text AS nature,
               a."system_role"::text AS system_role,
               sum(jl."debit") AS debit, sum(jl."credit") AS credit
          FROM "journal_lines" jl
          JOIN "chart_accounts" a ON a."id" = jl."account_id"
         WHERE ${Prisma.join(conditions, ' AND ')}
         GROUP BY a."id", a."code", a."nature", a."system_role"
      `,
    );
    return rows.map((r) => ({
      accountId: r.account_id,
      code: r.code,
      nature: r.nature,
      systemRole: r.system_role,
      balanceCents: toCents(r.debit) - toCents(r.credit),
    }));
  }
}
