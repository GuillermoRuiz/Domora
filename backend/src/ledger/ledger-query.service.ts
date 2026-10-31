import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { JournalEntryType, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { executedByAccount, executedByCostCentre } from './executed';

export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  nature: string;
  systemRole: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** debe − haber. */
  balance: Prisma.Decimal;
}

export interface BalanceQuery {
  from?: Date;
  to?: Date;
  fiscalYear?: number;
  excludeEntryTypes?: JournalEntryType[];
}

/**
 * Lecturas agregadas del diario. Es el ÚNICO sitio donde se decide qué
 * líneas cuentan para cada informe (por ejemplo, que un balance a una fecha
 * excluye los asientos de cierre y de apertura de año), para que ningún
 * informe lo decida por su cuenta.
 */
@Injectable()
export class LedgerQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Asientos que un balance a una fecha no debe sumar (se anulan entre sí). */
  static readonly BALANCE_EXCLUDED: JournalEntryType[] = [
    'closing',
    'year_opening',
  ];

  /** Bulk reporting extension of accountBalances: one parameterized query across estates.
   * Money remains Decimal until serialization. `monthly` changes grouping only.
   */
  async reportAccountBalances(
    estateIds: string[],
    query: BalanceQuery & { monthly?: boolean; accountCode?: string } = {},
  ) {
    if (!estateIds.length) return [];
    const conditions = [
      Prisma.sql`jl."estate_id" IN (${Prisma.join(estateIds.map((id) => Prisma.sql`${id}::uuid`))})`,
    ];
    if (query.from)
      conditions.push(Prisma.sql`jl."date" >= ${query.from}::date`);
    if (query.to) conditions.push(Prisma.sql`jl."date" <= ${query.to}::date`);
    if (query.fiscalYear !== undefined)
      conditions.push(Prisma.sql`jl."fiscal_year" = ${query.fiscalYear}`);
    if (query.accountCode)
      conditions.push(Prisma.sql`a."code" = ${query.accountCode}`);
    if (query.excludeEntryTypes?.length)
      conditions.push(
        Prisma.sql`jl."entry_type"::text NOT IN (${Prisma.join(query.excludeEntryTypes)})`,
      );
    const period = query.monthly
      ? Prisma.sql`to_char(jl."date", 'YYYY-MM')`
      : Prisma.sql`''::text`;
    const rows = await this.prisma.$queryRaw<
      {
        estate_id: string;
        account_id: string;
        code: string;
        name: string;
        nature: string;
        system_role: string | null;
        period: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT jl."estate_id", a."id" AS account_id, a."code", a."name", a."nature"::text AS nature,
             a."system_role"::text AS system_role, ${period} AS period,
             sum(jl."debit") AS debit, sum(jl."credit") AS credit
      FROM "journal_lines" jl JOIN "chart_accounts" a ON a."id" = jl."account_id" AND a."estate_id" = jl."estate_id"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY jl."estate_id", a."id", a."code", a."name", a."nature", a."system_role", ${period}
      ORDER BY jl."estate_id", period, a."code" LIMIT 50001
    `);
    if (rows.length > 50000)
      throw new UnprocessableEntityException(
        'El resultado supera 50.000 filas. Reduce el periodo o las comunidades.',
      );
    return rows.map((row) => ({
      estateId: row.estate_id,
      accountId: row.account_id,
      code: row.code,
      name: row.name,
      nature: row.nature,
      systemRole: row.system_role,
      period: row.period,
      debit: new Prisma.Decimal(row.debit),
      credit: new Prisma.Decimal(row.credit),
      balance: new Prisma.Decimal(row.debit).minus(row.credit),
    }));
  }

  /** Shared treasury definition for the individual accounting summary and bulk overview. */
  async treasuryBalancesForEstates(
    estateIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (!estateIds.length) return new Map();
    const rows = await this.prisma.$queryRaw<
      { estate_id: string; balance: Prisma.Decimal }[]
    >`
      SELECT jl."estate_id", sum(jl."debit" - jl."credit") AS balance
      FROM "journal_lines" jl JOIN "chart_accounts" a ON a."id" = jl."account_id"
      WHERE jl."estate_id" IN (${Prisma.join(estateIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND a."code" LIKE '57%'
        AND jl."entry_type"::text NOT IN (${Prisma.join(LedgerQueryService.BALANCE_EXCLUDED)})
      GROUP BY jl."estate_id"
    `;
    return new Map(
      rows.map((row) => [row.estate_id, new Prisma.Decimal(row.balance)]),
    );
  }

  async accountBalances(
    estateId: string,
    query: BalanceQuery = {},
  ): Promise<AccountBalanceRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`jl."estate_id" = ${estateId}::uuid`,
    ];
    if (query.from)
      conditions.push(Prisma.sql`jl."date" >= ${query.from}::date`);
    if (query.to) conditions.push(Prisma.sql`jl."date" <= ${query.to}::date`);
    if (query.fiscalYear !== undefined)
      conditions.push(Prisma.sql`jl."fiscal_year" = ${query.fiscalYear}`);
    if (query.excludeEntryTypes?.length) {
      conditions.push(
        Prisma.sql`jl."entry_type"::text NOT IN (${Prisma.join(query.excludeEntryTypes.map((t) => Prisma.sql`${t}`))})`,
      );
    }

    const rows = await this.prisma.$queryRaw<
      {
        account_id: string;
        code: string;
        name: string;
        nature: string;
        system_role: string | null;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >`
      SELECT a."id" AS account_id, a."code", a."name", a."nature"::text AS nature,
             a."system_role"::text AS system_role,
             sum(jl."debit") AS debit, sum(jl."credit") AS credit
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
       WHERE ${Prisma.join(conditions, ' AND ')}
       GROUP BY a."id", a."code", a."name", a."nature", a."system_role"
       ORDER BY a."code"
    `;
    return rows.map((r) => ({
      accountId: r.account_id,
      code: r.code,
      name: r.name,
      nature: r.nature,
      systemRole: r.system_role,
      debit: new Prisma.Decimal(r.debit),
      credit: new Prisma.Decimal(r.credit),
      balance: new Prisma.Decimal(r.debit).minus(r.credit),
    }));
  }

  /** Sumas totales de debe y haber por ejercicio (deben coincidir siempre). */
  async trialTotals(
    estateId: string,
  ): Promise<
    { fiscalYear: number; debit: Prisma.Decimal; credit: Prisma.Decimal }[]
  > {
    const rows = await this.prisma.$queryRaw<
      { fiscal_year: number; debit: Prisma.Decimal; credit: Prisma.Decimal }[]
    >`
      SELECT "fiscal_year", sum("debit") AS debit, sum("credit") AS credit
        FROM "journal_lines" WHERE "estate_id" = ${estateId}::uuid
       GROUP BY "fiscal_year" ORDER BY "fiscal_year"
    `;
    return rows.map((r) => ({
      fiscalYear: r.fiscal_year,
      debit: new Prisma.Decimal(r.debit),
      credit: new Prisma.Decimal(r.credit),
    }));
  }

  /** Ver executedByAccount en executed.ts. */
  executedByAccount(
    estateIds: string[],
    fiscalYear: number,
    accountIds?: string[],
  ) {
    return executedByAccount(this.prisma, estateIds, fiscalYear, accountIds);
  }

  /** Ver executedByCostCentre en executed.ts. */
  executedByCostCentre(
    estateIds: string[],
    fiscalYear: number,
    costCentreIds?: string[],
  ) {
    return executedByCostCentre(
      this.prisma,
      estateIds,
      fiscalYear,
      costCentreIds,
    );
  }

  /** Asientos que no son actividad del ejercicio: regularización, cierre, apertura y reparto del resultado. */
  static readonly RESULT_EXCLUDED: JournalEntryType[] = [
    'regularization',
    'closing',
    'year_opening',
    'result_allocation',
  ];

  /** Ejercicios con movimientos en el diario de la finca, de menor a mayor. */
  async fiscalYears(estateId: string): Promise<number[]> {
    return (await this.trialTotals(estateId)).map((row) => row.fiscalYear);
  }

  /**
   * Ingresos y gastos de cada mes de un ejercicio (siempre 12 filas, con 0
   * en los meses sin movimientos). Mismo criterio que `estateFigures`: solo
   * cuentas de ingreso/gasto y sin asientos de cierre o regularización.
   */
  async monthlyResult(
    estateId: string,
    fiscalYear: number,
  ): Promise<
    { month: number; income: Prisma.Decimal; expenses: Prisma.Decimal }[]
  > {
    const rows = await this.prisma.$queryRaw<
      {
        month: number;
        nature: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >`
      SELECT extract(month FROM jl."date")::int AS month, a."nature"::text AS nature,
             sum(jl."debit") AS debit, sum(jl."credit") AS credit
        FROM "journal_lines" jl
        JOIN "chart_accounts" a ON a."id" = jl."account_id"
       WHERE jl."estate_id" = ${estateId}::uuid
         AND jl."fiscal_year" = ${fiscalYear}
         AND a."nature"::text IN ('income', 'expense')
         AND jl."entry_type"::text NOT IN (${Prisma.join(LedgerQueryService.RESULT_EXCLUDED)})
       GROUP BY 1, 2
    `;
    const zero = new Prisma.Decimal(0);
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      income: zero,
      expenses: zero,
    }));
    for (const row of rows) {
      const target = months[row.month - 1];
      const debit = new Prisma.Decimal(row.debit);
      const credit = new Prisma.Decimal(row.credit);
      if (row.nature === 'income') target.income = credit.minus(debit);
      else target.expenses = debit.minus(credit);
    }
    return months;
  }

  /**
   * Cifras del resumen de la finca: dinero en bancos y caja (57x), fondo de
   * reserva (saldo acreedor de la 117), e ingresos y gastos del ejercicio.
   */
  async estateFigures(estateId: string, fiscalYear: number) {
    const treasury = await this.treasuryBalancesForEstates([estateId]);
    const balances = await this.accountBalances(estateId, {
      excludeEntryTypes: LedgerQueryService.BALANCE_EXCLUDED,
    });
    const zero = new Prisma.Decimal(0);
    const sum = (
      rows: AccountBalanceRow[],
      f: (r: AccountBalanceRow) => Prisma.Decimal,
    ) => rows.reduce((s, r) => s.plus(f(r)), zero);
    const year = await this.accountBalances(estateId, {
      fiscalYear,
      excludeEntryTypes: LedgerQueryService.RESULT_EXCLUDED,
    });
    return {
      treasury: treasury.get(estateId) ?? zero,
      reserve: sum(
        balances.filter((r) => r.systemRole === 'reserve_fund'),
        (r) => r.balance.negated(),
      ),
      income: sum(
        year.filter((r) => r.nature === 'income'),
        (r) => r.credit.minus(r.debit),
      ),
      expenses: sum(
        year.filter((r) => r.nature === 'expense'),
        (r) => r.debit.minus(r.credit),
      ),
    };
  }
}
