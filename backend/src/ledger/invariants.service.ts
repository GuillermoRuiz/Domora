import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerQueryService } from './ledger-query.service';

export type InvariantSeverity = 'error' | 'warning';

export interface InvariantIssue {
  check: string;
  severity: InvariantSeverity;
  message: string;
}

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal('0.01');

/**
 * Comprobaciones de cuadre de la contabilidad de una finca
 * (doc/contabilidad/adr-partida-doble.md, plan de implementación §Invariantes).
 *
 * Muchas ya las garantiza la base de datos; se vuelven a comprobar aquí
 * porque un fallo silencioso en una garantía sería mucho peor que un
 * informe redundante.
 *
 * `check()` son las invariantes DURAS (1-4, 6): nunca deberían dispararse en
 * ningún flujo normal, así que decenas de specs de fases anteriores las usan
 * como red de seguridad genérica (`expect(await invariants.check(estateId)).
 * toEqual([])` tras cada operación). `checkWarnings()` son avisos (5, 7, 8):
 * señales de salud para la gestora, no bugs — perfectamente normales en
 * mitad de un flujo (reserva aún no dotada, un extracto recién importado sin
 * conciliar, dinero en la 555 a la espera de aplicarse), así que viven
 * aparte para no romper esas specs con falsos positivos. `checkAll()` junta
 * las dos y es lo que expone `GET estates/:estateId/ledger/integrity`.
 *
 * Las invariantes 2 y 4 (pendiente cacheado = líneas del diario, en recibos
 * y facturas) están confirmadas IMPOSIBLES de violar hoy por cualquier vía,
 * SQL crudo incluido: los triggers diferidos DM031/DM051 (deferred constraint
 * triggers) releen la fila entera al confirmar la transacción y rechazan
 * cualquier `outstanding` que no cuadre con la partida abierta real, incluso
 * fuera de `JournalService` — no hay bypass de `domora.journal_purge` para
 * ellos, a propósito. Quedan igual como defensa en profundidad (por si un
 * día se relaja esa garantía) y como prueba, en cada spec de fase anterior
 * que llama a `check()`, de que la caché nunca se desvía en un flujo real.
 */
@Injectable()
export class InvariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
  ) {}

  async check(estateId: string): Promise<InvariantIssue[]> {
    const issues: InvariantIssue[] = [];
    issues.push(...(await this.checkTrialBalance(estateId)));
    issues.push(...(await this.checkReceiptOutstanding(estateId)));
    issues.push(...(await this.checkSupplierOutstanding(estateId)));
    issues.push(...(await this.checkPropertyAdvances(estateId)));
    issues.push(...(await this.checkNumbering(estateId)));
    return issues;
  }

  async checkWarnings(estateId: string): Promise<InvariantIssue[]> {
    const issues: InvariantIssue[] = [];
    issues.push(...(await this.checkBankReconciliation(estateId)));
    issues.push(...(await this.checkReserveMinimum(estateId)));
    issues.push(...(await this.checkSuspense(estateId)));
    return issues;
  }

  async checkAll(estateId: string): Promise<InvariantIssue[]> {
    const [errors, warnings] = await Promise.all([
      this.check(estateId),
      this.checkWarnings(estateId),
    ]);
    return [...errors, ...warnings];
  }

  /** 1. Debe = haber en cada ejercicio. */
  private async checkTrialBalance(estateId: string): Promise<InvariantIssue[]> {
    const totals = await this.ledger.trialTotals(estateId);
    return totals
      .filter((t) => !t.debit.equals(t.credit))
      .map((t) => ({
        check: 'trial_balance',
        severity: 'error' as const,
        message: `El ejercicio ${t.fiscalYear} no cuadra: debe ${t.debit.toFixed(2)} y haber ${t.credit.toFixed(2)}.`,
      }));
  }

  /**
   * 2. El pendiente de cada recibo (caché verificada por el trigger diferido
   * T8) coincide con la suma de sus líneas en la 430. Volver a comprobarlo
   * aquí, en frío y por finca entera, es la red que atrapa un T8 desactivado
   * a mano en un `journal_purge`, no un caso que deba darse nunca en uso normal.
   */
  private async checkReceiptOutstanding(
    estateId: string,
  ): Promise<InvariantIssue[]> {
    const rows = await this.prisma.$queryRaw<
      {
        receipt_no: string;
        outstanding: Prisma.Decimal;
        computed: Prisma.Decimal | null;
      }[]
    >`
      SELECT r."no" AS receipt_no, r."outstanding",
             sum(jl."debit" - jl."credit") AS computed
        FROM "receipts" r
        LEFT JOIN "journal_lines" jl ON jl."receipt_id" = r."id"
       WHERE r."estate_id" = ${estateId}::uuid
       GROUP BY r."id", r."no", r."outstanding"
      HAVING r."outstanding" <> coalesce(sum(jl."debit" - jl."credit"), 0)
    `;
    return rows.map((r) => ({
      check: 'receipt_outstanding',
      severity: 'error' as const,
      message: `El recibo ${r.receipt_no} tiene pendiente ${new Prisma.Decimal(r.outstanding).toFixed(2)} pero sus líneas en la 430 suman ${new Prisma.Decimal(r.computed ?? 0).toFixed(2)}.`,
    }));
  }

  /** 4. Lo mismo que la invariante 2, para facturas de proveedor y la 400/410. */
  private async checkSupplierOutstanding(
    estateId: string,
  ): Promise<InvariantIssue[]> {
    const rows = await this.prisma.$queryRaw<
      {
        number: string;
        outstanding: Prisma.Decimal;
        computed: Prisma.Decimal | null;
      }[]
    >`
      SELECT i."number", i."outstanding",
             sum(jl."credit" - jl."debit") AS computed
        FROM "supplier_invoices" i
        LEFT JOIN "journal_lines" jl ON jl."supplier_invoice_id" = i."id"
       WHERE i."estate_id" = ${estateId}::uuid
       GROUP BY i."id", i."number", i."outstanding"
      HAVING i."outstanding" <> coalesce(sum(jl."credit" - jl."debit"), 0)
    `;
    return rows.map((r) => ({
      check: 'supplier_outstanding',
      severity: 'error' as const,
      message: `La factura ${r.number} tiene pendiente de pago ${new Prisma.Decimal(r.outstanding).toFixed(2)} pero sus líneas en la 400/410 suman ${new Prisma.Decimal(r.computed ?? 0).toFixed(2)}.`,
    }));
  }

  /**
   * 3. Un anticipo (línea de la 430 sin recibo asociado) nunca tiene saldo
   * deudor neto por propiedad — sería un anticipo que en realidad es deuda,
   * y la deuda SIEMPRE va atada a un recibo. Si esto se dispara, alguna regla
   * de contabilización dejó una línea 430 sin `receiptId` que no debería.
   */
  private async checkPropertyAdvances(
    estateId: string,
  ): Promise<InvariantIssue[]> {
    const rows = await this.prisma.$queryRaw<
      { property_ref: string; balance: Prisma.Decimal }[]
    >`
      SELECT coalesce(p."ref", p."id"::text) AS property_ref,
             sum(jl."debit" - jl."credit") AS balance
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
        JOIN "properties" p ON p."id" = jl."property_id"
       WHERE jl."estate_id" = ${estateId}::uuid
         AND a."system_role" = 'owners_receivable'
         AND jl."receipt_id" IS NULL
       GROUP BY p."id", p."ref"
      HAVING sum(jl."debit" - jl."credit") > 0.01
    `;
    return rows.map((r) => ({
      check: 'property_advance_debtor',
      severity: 'error' as const,
      message: `La propiedad ${r.property_ref} tiene un anticipo (430 sin recibo) con saldo deudor de ${new Prisma.Decimal(r.balance).toFixed(2)} — un anticipo nunca debería deber.`,
    }));
  }

  /** 6. La numeración de cada ejercicio no tiene huecos: número de asientos = número máximo. */
  private async checkNumbering(estateId: string): Promise<InvariantIssue[]> {
    const rows = await this.prisma.$queryRaw<
      { fiscal_year: number; entries: bigint; max_number: number }[]
    >`
      SELECT "fiscal_year", count(*) AS entries, max("number") AS max_number
        FROM "journal_entries" WHERE "estate_id" = ${estateId}::uuid
       GROUP BY "fiscal_year"
    `;
    return rows
      .filter((r) => Number(r.entries) !== r.max_number)
      .map((r) => ({
        check: 'numbering',
        severity: 'error' as const,
        message: `La numeración del ejercicio ${r.fiscal_year} tiene huecos: ${Number(r.entries)} asientos y el último es el ${r.max_number}.`,
      }));
  }

  /**
   * 5. Aviso: el saldo de cada cuenta bancaria (572x) menos lo que el último
   * extracto importado todavía no tiene emparejado en el diario, debería
   * coincidir con el saldo final de ese extracto. Es una comprobación
   * aproximada (no todo apunte del diario nace de un extracto ni viceversa,
   * sobre todo con importaciones parciales), así que un desajuste avisa,
   * nunca bloquea.
   */
  private async checkBankReconciliation(
    estateId: string,
  ): Promise<InvariantIssue[]> {
    const banks = await this.prisma.bankAccount.findMany({
      where: { estateId, closedAt: null },
      select: { id: true, alias: true, chartAccountId: true },
    });
    const issues: InvariantIssue[] = [];
    for (const bank of banks) {
      const statement = await this.prisma.bankStatement.findFirst({
        where: { bankAccountId: bank.id, closingBalance: { not: null } },
        orderBy: [
          { periodTo: { sort: 'desc', nulls: 'last' } },
          { importedAt: 'desc' },
        ],
        select: { closingBalance: true },
      });
      if (!statement || statement.closingBalance === null) continue;

      const [balanceRow, unreconciled] = await Promise.all([
        this.prisma.$queryRaw<{ balance: Prisma.Decimal | null }[]>`
          SELECT sum(jl."debit" - jl."credit") AS balance
            FROM "journal_lines" jl
           WHERE jl."account_id" = ${bank.chartAccountId}::uuid
        `,
        this.prisma.bankExtractEntry.aggregate({
          where: { bankAccountId: bank.id, reconciliationGroupId: null },
          _sum: { amount: true },
        }),
      ]);
      const journalBalance = balanceRow[0]?.balance
        ? new Prisma.Decimal(balanceRow[0].balance)
        : ZERO;
      const unreconciledAmount = unreconciled._sum.amount
        ? new Prisma.Decimal(unreconciled._sum.amount)
        : ZERO;
      const expected = new Prisma.Decimal(statement.closingBalance).minus(
        unreconciledAmount,
      );
      const diff = journalBalance.minus(expected).abs();
      if (diff.greaterThan(CENT)) {
        issues.push({
          check: 'bank_reconciliation',
          severity: 'warning',
          message: `La cuenta "${bank.alias}" tiene un saldo contable de ${journalBalance.toFixed(2)} que no cuadra con el último extracto (${new Prisma.Decimal(statement.closingBalance).toFixed(2)}) menos lo pendiente de conciliar (${unreconciledAmount.toFixed(2)}) — diferencia de ${diff.toFixed(2)}.`,
        });
      }
    }
    return issues;
  }

  /** 7. Aviso: el fondo de reserva no baja del 10% del presupuesto ordinario del año en curso (art. 9.1.f LPH). */
  private async checkReserveMinimum(
    estateId: string,
  ): Promise<InvariantIssue[]> {
    const currentYear = new Date().getFullYear();
    const [figures, budgetAgg] = await Promise.all([
      this.ledger.estateFigures(estateId, currentYear),
      this.prisma.budgetItem.aggregate({
        where: { estateId, fiscalYear: currentYear },
        _sum: { budgeted: true },
      }),
    ]);
    const annualBudget = budgetAgg._sum.budgeted;
    if (!annualBudget || annualBudget.lessThanOrEqualTo(0)) return [];
    const legalMinimum = annualBudget.mul(0.1);
    if (figures.reserve.greaterThanOrEqualTo(legalMinimum)) return [];
    return [
      {
        check: 'reserve_minimum',
        severity: 'warning',
        message: `El fondo de reserva (${figures.reserve.toFixed(2)}) está por debajo del mínimo legal del 10% del presupuesto ordinario (${legalMinimum.toFixed(2)}) — art. 9.1.f LPH.`,
      },
    ];
  }

  /** 8. Aviso: dinero sin identificar (555) pendiente de aplicar. */
  private async checkSuspense(estateId: string): Promise<InvariantIssue[]> {
    const rows = await this.prisma.$queryRaw<
      { balance: Prisma.Decimal | null }[]
    >`
      SELECT sum(jl."credit" - jl."debit") AS balance
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
       WHERE jl."estate_id" = ${estateId}::uuid
         AND a."system_role" = 'suspense'
    `;
    const balance = rows[0]?.balance
      ? new Prisma.Decimal(rows[0].balance)
      : ZERO;
    if (balance.abs().lessThanOrEqualTo(CENT)) return [];
    return [
      {
        check: 'suspense_pending',
        severity: 'warning',
        message: `Hay ${balance.toFixed(2)} en la 555 (dinero sin identificar) pendiente de aplicar a un recibo o de devolver.`,
      },
    ];
  }
}
