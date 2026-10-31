import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PropertyAccessService } from '../../estate-access/property-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerQueryService } from '../ledger-query.service';
import { BudgetService } from '../budget/budget.service';
import { fromCents, splitByWeights, toCents, type Cents } from '../money';
import type { TableReport } from '../../common/reports/table-report';

const ZERO = new Prisma.Decimal(0);

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(iso: string, field: string): Date {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} no es una fecha válida.`);
  }
  return d;
}

/**
 * Informes contables en pantalla, PDF y Excel (fase 12 de
 * doc/contabilidad/roadmap-partida-doble.md). Cada método devuelve datos
 * planos para la pantalla; `document*()` los convierte al `TableReport`
 * genérico que ya renderiza `common/reports/table-report.ts` (fase 7b).
 *
 * Misma regla de "balance a una fecha" que `LedgerQueryService`: sin los
 * asientos de cierre ni de apertura de año, para que un saldo no se cuente
 * dos veces entre un ejercicio y el siguiente.
 */
@Injectable()
export class LedgerReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly ledgerQuery: LedgerQueryService,
    private readonly budget: BudgetService,
    private readonly propertyAccess: PropertyAccessService,
  ) {}

  private async estateHeader(estateId: string) {
    return this.prisma.estate.findUniqueOrThrow({
      where: { id: estateId },
      select: { name: true, cif: true },
    });
  }

  // ── Sumas y saldos ───────────────────────────────────────────────────

  async trialBalance(
    estateId: string,
    fiscalYear: number,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const [estate, rows] = await Promise.all([
      this.estateHeader(estateId),
      this.ledgerQuery.accountBalances(estateId, { fiscalYear }),
    ]);
    const totalDebit = rows.reduce((s, r) => s.plus(r.debit), ZERO);
    const totalCredit = rows.reduce((s, r) => s.plus(r.credit), ZERO);
    return {
      estate,
      fiscalYear,
      rows: rows.map((r) => ({
        code: r.code,
        name: r.name,
        debit: r.debit.toNumber(),
        credit: r.credit.toNumber(),
        balance: r.balance.toNumber(),
      })),
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
    };
  }

  // ── Mayor ────────────────────────────────────────────────────────────

  async generalLedger(
    estateId: string,
    query: {
      accountCode: string;
      propertyId?: string;
      supplierId?: string;
      from?: string;
      to?: string;
    },
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const [estate, account] = await Promise.all([
      this.estateHeader(estateId),
      this.prisma.chartAccount.findFirst({
        where: { estateId, code: query.accountCode },
        select: { id: true, code: true, name: true },
      }),
    ]);
    if (!account) {
      throw new NotFoundException(
        `No existe la cuenta ${query.accountCode} en esta finca.`,
      );
    }
    const from = query.from ? parseDay(query.from, 'from') : null;
    const to = query.to ? parseDay(query.to, 'to') : null;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`jl."estate_id" = ${estateId}::uuid`,
      Prisma.sql`jl."account_id" = ${account.id}::uuid`,
    ];
    if (query.propertyId)
      conditions.push(Prisma.sql`jl."property_id" = ${query.propertyId}::uuid`);
    if (query.supplierId)
      conditions.push(Prisma.sql`jl."supplier_id" = ${query.supplierId}::uuid`);

    const openingConditions = [...conditions];
    if (from) openingConditions.push(Prisma.sql`jl."date" < ${from}::date`);
    const openingRows = from
      ? await this.prisma.$queryRaw<{ balance: Prisma.Decimal | null }[]>(
          Prisma.sql`
            SELECT sum(jl."debit" - jl."credit") AS balance
              FROM "journal_lines" jl
             WHERE ${Prisma.join(openingConditions, ' AND ')}
          `,
        )
      : [{ balance: ZERO }];
    const opening = openingRows[0]?.balance
      ? new Prisma.Decimal(openingRows[0].balance)
      : ZERO;

    if (from) conditions.push(Prisma.sql`jl."date" >= ${from}::date`);
    if (to) conditions.push(Prisma.sql`jl."date" <= ${to}::date`);

    const lines = await this.prisma.$queryRaw<
      {
        date: Date;
        number: number;
        fiscal_year: number;
        concept: string;
        source_type: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >(
      Prisma.sql`
        SELECT jl."date", je."number", je."fiscal_year",
               coalesce(jl."concept", je."concept") AS concept,
               je."source_type"::text AS source_type,
               jl."debit", jl."credit"
          FROM "journal_lines" jl
          JOIN "journal_entries" je ON je."id" = jl."entry_id"
         WHERE ${Prisma.join(conditions, ' AND ')}
         ORDER BY jl."date" ASC, je."fiscal_year" ASC, je."number" ASC, jl."line_no" ASC
      `,
    );

    let running = opening;
    const rows = lines.map((l) => {
      running = running.plus(l.debit).minus(l.credit);
      return {
        date: isoDay(l.date),
        entryNumber: `${l.fiscal_year}/${l.number}`,
        concept: l.concept,
        sourceType: l.source_type,
        debit: new Prisma.Decimal(l.debit).toNumber(),
        credit: new Prisma.Decimal(l.credit).toNumber(),
        balance: running.toNumber(),
      };
    });

    return {
      estate,
      account: { code: account.code, name: account.name },
      from: query.from ?? null,
      to: query.to ?? null,
      openingBalance: opening.toNumber(),
      closingBalance: running.toNumber(),
      rows,
    };
  }

  // ── Extracto por propiedad (rol C incluido) ──────────────────────────

  /**
   * El mayor de la 430 de UNA propiedad — lo que un propietario ve como su
   * "extracto de cuenta". A diferencia del resto de informes, accesible
   * también al rol C, pero solo de SU propia propiedad: `EstateAccessService`
   * no sirve aquí porque comprueba acceso por FINCA (rol C tiene todas las
   * fincas donde tiene alguna propiedad en `estateIds`), y eso dejaría ver
   * el extracto de un vecino con solo compartir finca. La comprobación real
   * es por `PropertyMembership`, igual que `PropertyMembershipsService.
   * assertCanManageMembers` (property-memberships.service.ts).
   */
  async propertyStatement(
    propertyId: string,
    query: { from?: string; to?: string },
    user: AuthenticatedUser,
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: {
        id: true,
        estateId: true,
        primaryUserId: true,
        ref: true,
        staircase: true,
        floor: true,
        door: true,
      },
    });
    if (!property || !property.estateId) {
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    }
    const estateId = property.estateId;
    await this.propertyAccess.assertAccess(
      { id: property.id, estateId, primaryUserId: property.primaryUserId },
      user,
    );

    const ledger = await this.generalLedger(
      estateId,
      { accountCode: '430', propertyId, from: query.from, to: query.to },
      user,
    );
    return {
      ...ledger,
      property: {
        id: property.id,
        ref:
          property.ref ??
          [property.staircase, property.floor, property.door]
            .filter(Boolean)
            .join('-'),
      },
    };
  }

  // ── Balance de situación ─────────────────────────────────────────────

  async balanceSheet(estateId: string, asOf: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const to = parseDay(asOf, 'asOf');
    const [estate, rows] = await Promise.all([
      this.estateHeader(estateId),
      this.ledgerQuery.accountBalances(estateId, {
        to,
        excludeEntryTypes: LedgerQueryService.BALANCE_EXCLUDED,
      }),
    ]);

    const owners = rows.find((r) => r.systemRole === 'owners_receivable');
    const ownersTotal = owners?.balance ?? ZERO;
    const debtRows = await this.prisma.$queryRaw<
      { balance: Prisma.Decimal | null }[]
    >(
      Prisma.sql`
        SELECT sum(jl."debit" - jl."credit") AS balance
          FROM "journal_lines" jl
          JOIN "chart_accounts" a ON a."id" = jl."account_id"
         WHERE jl."estate_id" = ${estateId}::uuid
           AND a."system_role" = 'owners_receivable'
           AND jl."receipt_id" IS NOT NULL
           AND jl."date" <= ${to}::date
      `,
    );
    // Nunca se compensa deuda con anticipo: se derivan por resta del saldo
    // agregado de la 430 para que Activo y Pasivo cuadren siempre, exista o
    // no actividad de anticipos (ver ADR, decisión sobre anticipos y
    // morosidad — el mismo criterio que DebtorsService.computeBalances).
    const ownersDebt = debtRows[0]?.balance
      ? new Prisma.Decimal(debtRows[0].balance)
      : ZERO;
    const ownersAdvance = ownersDebt.minus(ownersTotal);

    const income = rows.filter((r) => r.nature === 'income');
    const expense = rows.filter((r) => r.nature === 'expense');
    const pendingResult = income
      .reduce((s, r) => s.plus(r.balance.negated()), ZERO)
      .minus(expense.reduce((s, r) => s.plus(r.balance), ZERO));

    const asset = rows.filter(
      (r) => r.nature === 'asset' && r.systemRole !== 'owners_receivable',
    );
    const liability = rows.filter((r) => r.nature === 'liability');
    const equity = rows.filter((r) => r.nature === 'equity');

    const assetTotal = asset
      .reduce((s, r) => s.plus(r.balance), ZERO)
      .plus(ownersDebt);
    const liabilityTotal = liability
      .reduce((s, r) => s.plus(r.balance.negated()), ZERO)
      .plus(ownersAdvance);
    const equityTotal = equity
      .reduce((s, r) => s.plus(r.balance.negated()), ZERO)
      .plus(pendingResult);

    return {
      estate,
      asOf,
      asset: {
        rows: [
          ...asset.map((r) => ({
            code: r.code,
            name: r.name,
            amount: r.balance.toNumber(),
          })),
          {
            code: '430*',
            name: 'Deudores propietarios',
            amount: ownersDebt.toNumber(),
          },
        ],
        total: assetTotal.toNumber(),
      },
      liability: {
        rows: [
          ...liability.map((r) => ({
            code: r.code,
            name: r.name,
            amount: r.balance.negated().toNumber(),
          })),
          {
            code: '430*',
            name: 'Anticipos de propietarios',
            amount: ownersAdvance.toNumber(),
          },
        ],
        total: liabilityTotal.toNumber(),
      },
      equity: {
        rows: [
          ...equity.map((r) => ({
            code: r.code,
            name: r.name,
            amount: r.balance.negated().toNumber(),
          })),
          {
            code: '129*',
            name: 'Resultado pendiente de aplicar',
            amount: pendingResult.toNumber(),
          },
        ],
        total: equityTotal.toNumber(),
      },
      balanced: assetTotal
        .minus(liabilityTotal.plus(equityTotal))
        .abs()
        .lessThan('0.01'),
    };
  }

  // ── Resultados frente a presupuesto ──────────────────────────────────

  async budgetVsActual(
    estateId: string,
    fiscalYear: number,
    user: AuthenticatedUser,
  ) {
    const [estate, items] = await Promise.all([
      this.estateHeader(estateId),
      this.budget.listBudget(estateId, fiscalYear, user),
    ]);
    const rows = items.map((i) => ({
      code: i.accountCode,
      name: i.accountLabel,
      budgeted: i.budgeted.toNumber(),
      executed: i.executed.toNumber(),
      deviation: i.executed.minus(i.budgeted).toNumber(),
    }));
    return {
      estate,
      fiscalYear,
      rows,
      totalBudgeted: items
        .reduce((s, i) => s.plus(i.budgeted), new Prisma.Decimal(0))
        .toNumber(),
      totalExecuted: items
        .reduce((s, i) => s.plus(i.executed), new Prisma.Decimal(0))
        .toNumber(),
    };
  }

  // ── Liquidación por criterio de caja ─────────────────────────────────

  /**
   * Lo que ha entrado y salido de verdad del banco/caja en el periodo —
   * distinto de "resultados frente a presupuesto" (devengo, cuando se
   * emitió el recibo o se registró la factura). Alcance: cobros de recibos
   * y pagos a proveedores, que es donde de verdad hace falta el reparto
   * proporcional (un recibo o una factura pueden repartirse entre varias
   * cuentas, y un cobro o un pago puede ser solo parcial). Quedan fuera
   * nóminas, impuestos y tesorería suelta — movimientos de una sola cuenta
   * sin nada que repartir, que ya se ven completos en el Mayor del banco.
   */
  async cashSettlement(
    estateId: string,
    query: { from: string; to: string },
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const from = parseDay(query.from, 'from');
    const to = parseDay(query.to, 'to');
    const [estate, income, expense] = await Promise.all([
      this.estateHeader(estateId),
      this.cashCollected(estateId, from, to),
      this.cashPaid(estateId, from, to),
    ]);
    return {
      estate,
      from: query.from,
      to: query.to,
      income,
      expense,
      net: new Prisma.Decimal(income.total).minus(expense.total).toNumber(),
    };
  }

  /** Cobros de recibos que de verdad movieron el banco/caja, prorrateados por cuenta. */
  private async cashCollected(estateId: string, from: Date, to: Date) {
    const lines = await this.prisma.$queryRaw<
      { receipt_id: string | null; credit: Prisma.Decimal }[]
    >(
      Prisma.sql`
        SELECT jl."receipt_id", jl."credit"
          FROM "journal_lines" jl
          JOIN "chart_accounts" a ON a."id" = jl."account_id"
         WHERE jl."estate_id" = ${estateId}::uuid
           AND a."system_role" = 'owners_receivable'
           AND jl."credit" > 0
           AND jl."date" BETWEEN ${from}::date AND ${to}::date
           AND EXISTS (
             SELECT 1 FROM "journal_lines" jl2
               JOIN "chart_accounts" a2 ON a2."id" = jl2."account_id"
              WHERE jl2."entry_id" = jl."entry_id"
                AND a2."system_role" IN ('bank', 'cash')
                AND jl2."debit" > 0
           )
      `,
    );

    const byReceipt = new Map<string, Cents>();
    let advances: Cents = 0;
    for (const l of lines) {
      const cents = toCents(l.credit);
      if (!l.receipt_id) {
        advances += cents;
        continue;
      }
      byReceipt.set(l.receipt_id, (byReceipt.get(l.receipt_id) ?? 0) + cents);
    }

    const receipts = await this.prisma.accountingReceipt.findMany({
      where: { id: { in: [...byReceipt.keys()] } },
      select: {
        id: true,
        amount: true,
        lines: { select: { accountId: true, amount: true } },
      },
    });
    const accounts = await this.accountLabels(estateId);
    const byAccount = new Map<string, Cents>();
    const addTo = (accountId: string, cents: Cents) =>
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + cents);

    let priorYearsDebt: Cents = 0;
    for (const r of receipts) {
      const collectedCents = byReceipt.get(r.id) ?? 0;
      if (collectedCents === 0) continue;
      if (r.lines.length === 0) {
        // Recibos `saldo_anterior` no llevan líneas propias (su contrapartida
        // es el asiento de apertura) — no hay a qué cuenta repartir el cobro.
        priorYearsDebt += collectedCents;
        continue;
      }
      const parts = splitByWeights(
        collectedCents,
        r.lines.map((l) => l.amount),
      );
      r.lines.forEach((l, i) => addTo(l.accountId, parts[i]));
    }

    const rows = [...byAccount.entries()].map(([accountId, cents]) => ({
      code: accounts.get(accountId)?.code ?? '?',
      name: accounts.get(accountId)?.name ?? accountId,
      amount: fromCents(cents).toNumber(),
    }));
    if (priorYearsDebt > 0) {
      rows.push({
        code: '',
        name: 'Deuda de ejercicios anteriores',
        amount: fromCents(priorYearsDebt).toNumber(),
      });
    }
    if (advances > 0) {
      rows.push({
        code: '',
        name: 'Anticipos recibidos (sin aplicar)',
        amount: fromCents(advances).toNumber(),
      });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
    return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
  }

  /** Pagos a proveedores que de verdad movieron el banco/caja, prorrateados por cuenta de gasto. */
  private async cashPaid(estateId: string, from: Date, to: Date) {
    const lines = await this.prisma.$queryRaw<
      { supplier_invoice_id: string; debit: Prisma.Decimal }[]
    >(
      Prisma.sql`
        SELECT jl."supplier_invoice_id", jl."debit"
          FROM "journal_lines" jl
          JOIN "chart_accounts" a ON a."id" = jl."account_id"
         WHERE jl."estate_id" = ${estateId}::uuid
           AND a."system_role" IN ('suppliers_payable', 'creditors_payable')
           AND jl."debit" > 0
           AND jl."supplier_invoice_id" IS NOT NULL
           AND jl."date" BETWEEN ${from}::date AND ${to}::date
           AND EXISTS (
             SELECT 1 FROM "journal_lines" jl2
               JOIN "chart_accounts" a2 ON a2."id" = jl2."account_id"
              WHERE jl2."entry_id" = jl."entry_id"
                AND a2."system_role" IN ('bank', 'cash')
                AND jl2."credit" > 0
           )
      `,
    );

    const byInvoice = new Map<string, Cents>();
    for (const l of lines) {
      byInvoice.set(
        l.supplier_invoice_id,
        (byInvoice.get(l.supplier_invoice_id) ?? 0) + toCents(l.debit),
      );
    }

    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { id: { in: [...byInvoice.keys()] } },
      select: {
        id: true,
        total: true,
        lines: { select: { accountId: true, amount: true } },
      },
    });
    const accounts = await this.accountLabels(estateId);
    const byAccount = new Map<string, Cents>();
    const addTo = (accountId: string, cents: Cents) =>
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + cents);

    let priorYearsInvoices: Cents = 0;
    for (const inv of invoices) {
      const paidCents = byInvoice.get(inv.id) ?? 0;
      if (paidCents === 0) continue;
      if (inv.lines.length === 0) {
        // Facturas nacidas de un saldo inicial tampoco llevan desglose 6xx.
        priorYearsInvoices += paidCents;
        continue;
      }
      const parts = splitByWeights(
        paidCents,
        inv.lines.map((l) => l.amount),
      );
      inv.lines.forEach((l, i) => addTo(l.accountId, parts[i]));
    }

    const rows = [...byAccount.entries()].map(([accountId, cents]) => ({
      code: accounts.get(accountId)?.code ?? '?',
      name: accounts.get(accountId)?.name ?? accountId,
      amount: fromCents(cents).toNumber(),
    }));
    if (priorYearsInvoices > 0) {
      rows.push({
        code: '',
        name: 'Facturas de ejercicios anteriores',
        amount: fromCents(priorYearsInvoices).toNumber(),
      });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
    return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
  }

  private async accountLabels(
    estateId: string,
  ): Promise<Map<string, { code: string; name: string }>> {
    const accounts = await this.prisma.chartAccount.findMany({
      where: { estateId },
      select: { id: true, code: true, name: true },
    });
    return new Map(accounts.map((a) => [a.id, a]));
  }

  // ── Documentos (TableReport) ─────────────────────────────────────────

  documentTrialBalance(
    data: Awaited<ReturnType<LedgerReportsService['trialBalance']>>,
  ): TableReport {
    return {
      title: 'Sumas y saldos',
      subtitle: [data.estate.name, `Ejercicio ${data.fiscalYear}`],
      fileName: `sumas-y-saldos-${data.fiscalYear}`,
      sections: [
        {
          columns: [
            { key: 'code', header: 'Cuenta', width: 1 },
            { key: 'name', header: 'Nombre', width: 3 },
            { key: 'debit', header: 'Debe', kind: 'money', width: 1.3 },
            { key: 'credit', header: 'Haber', kind: 'money', width: 1.3 },
            { key: 'balance', header: 'Saldo', kind: 'money', width: 1.3 },
          ],
          rows: data.rows,
          totals: {
            code: '',
            name: 'Totales',
            debit: data.totalDebit,
            credit: data.totalCredit,
          },
          empty: 'Sin movimientos en este ejercicio.',
        },
      ],
    };
  }

  documentGeneralLedger(
    data: Awaited<ReturnType<LedgerReportsService['generalLedger']>>,
  ): TableReport {
    return {
      title: `Mayor — ${data.account.code} ${data.account.name}`,
      subtitle: [
        data.estate.name,
        `${data.from ?? 'inicio'} a ${data.to ?? 'hoy'}`,
        `Saldo de apertura: ${data.openingBalance.toFixed(2)} €`,
      ],
      fileName: `mayor-${data.account.code}`,
      sections: [
        {
          columns: [
            { key: 'date', header: 'Fecha', width: 1 },
            { key: 'entryNumber', header: 'Asiento', width: 1 },
            { key: 'concept', header: 'Concepto', width: 3 },
            { key: 'debit', header: 'Debe', kind: 'money', width: 1.2 },
            { key: 'credit', header: 'Haber', kind: 'money', width: 1.2 },
            { key: 'balance', header: 'Saldo', kind: 'money', width: 1.2 },
          ],
          rows: data.rows,
          totals: {
            date: '',
            entryNumber: '',
            concept: 'Saldo final',
            balance: data.closingBalance,
          },
          empty: 'Sin movimientos en el periodo.',
        },
      ],
    };
  }

  documentBalanceSheet(
    data: Awaited<ReturnType<LedgerReportsService['balanceSheet']>>,
  ): TableReport {
    const columns = [
      { key: 'code', header: 'Cuenta', width: 1 },
      { key: 'name', header: 'Nombre', width: 3 },
      { key: 'amount', header: 'Importe', kind: 'money' as const, width: 1.3 },
    ];
    return {
      title: 'Balance de situación',
      subtitle: [data.estate.name, `A fecha ${data.asOf}`],
      fileName: `balance-situacion-${data.asOf}`,
      sections: [
        {
          title: 'Activo',
          columns,
          rows: data.asset.rows,
          totals: { code: '', name: 'Total activo', amount: data.asset.total },
        },
        {
          title: 'Pasivo',
          columns,
          rows: data.liability.rows,
          totals: {
            code: '',
            name: 'Total pasivo',
            amount: data.liability.total,
          },
        },
        {
          title: 'Patrimonio neto',
          columns,
          rows: data.equity.rows,
          totals: {
            code: '',
            name: 'Total patrimonio neto',
            amount: data.equity.total,
          },
        },
      ],
      notes: data.balanced
        ? undefined
        : [
            'AVISO: el activo no cuadra con pasivo + patrimonio neto. Esto no debería pasar nunca — contacta con soporte.',
          ],
    };
  }

  documentBudgetVsActual(
    data: Awaited<ReturnType<LedgerReportsService['budgetVsActual']>>,
  ): TableReport {
    return {
      title: 'Resultados frente a presupuesto',
      subtitle: [data.estate.name, `Ejercicio ${data.fiscalYear}`],
      fileName: `presupuesto-vs-ejecutado-${data.fiscalYear}`,
      sections: [
        {
          columns: [
            { key: 'code', header: 'Cuenta', width: 1 },
            { key: 'name', header: 'Partida', width: 3 },
            {
              key: 'budgeted',
              header: 'Presupuestado',
              kind: 'money',
              width: 1.3,
            },
            { key: 'executed', header: 'Ejecutado', kind: 'money', width: 1.3 },
            {
              key: 'deviation',
              header: 'Desviación',
              kind: 'money',
              width: 1.3,
            },
          ],
          rows: data.rows,
          totals: {
            code: '',
            name: 'Totales',
            budgeted: data.totalBudgeted,
            executed: data.totalExecuted,
            deviation: new Prisma.Decimal(data.totalExecuted)
              .minus(data.totalBudgeted)
              .toNumber(),
          },
          empty: 'Sin presupuesto para este ejercicio.',
        },
      ],
    };
  }

  documentCashSettlement(
    data: Awaited<ReturnType<LedgerReportsService['cashSettlement']>>,
  ): TableReport {
    const columns = [
      { key: 'code', header: 'Cuenta', width: 1 },
      { key: 'name', header: 'Partida', width: 3 },
      { key: 'amount', header: 'Importe', kind: 'money' as const, width: 1.3 },
    ];
    return {
      title: 'Liquidación por criterio de caja',
      subtitle: [data.estate.name, `${data.from} a ${data.to}`],
      fileName: `liquidacion-caja-${data.from}-${data.to}`,
      sections: [
        {
          title: 'Cobrado',
          columns,
          rows: data.income.rows,
          totals: {
            code: '',
            name: 'Total cobrado',
            amount: data.income.total,
          },
          empty: 'Sin cobros en el periodo.',
        },
        {
          title: 'Pagado',
          columns,
          rows: data.expense.rows,
          totals: {
            code: '',
            name: 'Total pagado',
            amount: data.expense.total,
          },
          empty: 'Sin pagos en el periodo.',
        },
      ],
      notes: [
        `Resultado de caja del periodo: ${data.net.toFixed(2)} €.`,
        'Alcance: cobros de recibos y pagos a proveedores, con reparto proporcional cuando un documento se reparte entre varias cuentas. No incluye nóminas, impuestos ni tesorería suelta.',
      ],
    };
  }

  documentPropertyStatement(
    data: Awaited<ReturnType<LedgerReportsService['propertyStatement']>>,
  ): TableReport {
    return {
      title: `Extracto de cuenta — ${data.property.ref}`,
      subtitle: [
        data.estate.name,
        `${data.from ?? 'inicio'} a ${data.to ?? 'hoy'}`,
        `Saldo de apertura: ${data.openingBalance.toFixed(2)} €`,
      ],
      fileName: `extracto-${data.property.ref}`,
      sections: [
        {
          columns: [
            { key: 'date', header: 'Fecha', width: 1 },
            { key: 'entryNumber', header: 'Asiento', width: 1 },
            { key: 'concept', header: 'Concepto', width: 3 },
            { key: 'debit', header: 'Debe', kind: 'money', width: 1.2 },
            { key: 'credit', header: 'Haber', kind: 'money', width: 1.2 },
            { key: 'balance', header: 'Saldo', kind: 'money', width: 1.2 },
          ],
          rows: data.rows,
          totals: {
            date: '',
            entryNumber: '',
            concept: 'Saldo final',
            balance: data.closingBalance,
          },
          empty: 'Sin movimientos en el periodo.',
        },
      ],
      notes: [
        'Un saldo positivo es deuda pendiente; uno negativo, a favor del propietario.',
      ],
    };
  }
}
