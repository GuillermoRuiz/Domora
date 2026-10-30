import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { FiscalYearsService } from '../../fiscal-years/fiscal-years.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { LedgerQueryService } from '../ledger-query.service';
import type { UpsertBudgetItemDto } from './upsert-budget-item.dto';
import type { UpsertCostCentreBudgetDto } from './upsert-cost-centre-budget.dto';

const ZERO = new Prisma.Decimal(0);

/** Etiqueta '628 · Suministros': siempre por JOIN, nunca almacenada. */
function accountLabel(account: {
  code: string;
  shortName: string | null;
  name: string;
}): string {
  return `${account.code} · ${account.shortName ?? account.name}`;
}

/**
 * Presupuesto por cuenta y por centro de coste, y su análisis frente a lo
 * ejecutado (fase 8: lo ejecutado sale del diario, ver
 * LedgerQueryService.executedByAccount).
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly ledger: LedgerQueryService,
  ) {}

  async listBudget(
    estateId: string,
    fiscalYear: number,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const items = await this.prisma.budgetItem.findMany({
      where: { estateId, fiscalYear },
      include: { account: true },
      orderBy: { account: { code: 'asc' } },
    });
    const executed = await this.ledger.executedByAccount(
      [estateId],
      fiscalYear,
      items.map((i) => i.accountId),
    );
    return items.map((item) => ({
      ...item,
      accountCode: item.account.code,
      accountLabel: accountLabel(item.account),
      executed: executed.get(item.accountId) ?? ZERO,
    }));
  }

  /**
   * `category` no se confía al cliente: se recalcula en cada escritura desde
   * la cuenta real, para que no quede un nombre obsoleto.
   */
  async upsertBudgetItem(
    estateId: string,
    dto: UpsertBudgetItemDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.fiscalYears.assertOpenForWrites(estateId, dto.fiscalYear);
    const account = await this.prisma.chartAccount.findFirst({
      where: { code: dto.accountCode, estateId },
    });
    if (!account)
      throw new BadRequestException(
        `Cuenta contable ${dto.accountCode} no encontrada.`,
      );
    const category = account.shortName ?? account.name;
    return this.prisma.budgetItem.upsert({
      where: {
        estateId_accountId_fiscalYear: {
          estateId,
          accountId: account.id,
          fiscalYear: dto.fiscalYear,
        },
      },
      update: { category, budgeted: new Prisma.Decimal(dto.budgeted) },
      create: {
        estateId,
        accountId: account.id,
        category,
        fiscalYear: dto.fiscalYear,
        budgeted: new Prisma.Decimal(dto.budgeted),
      },
    });
  }

  async listCostCentreBudget(
    estateId: string,
    fiscalYear: number,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const items = await this.prisma.costCentreBudget.findMany({
      where: { estateId, fiscalYear },
      include: { costCentre: true },
      orderBy: { costCentre: { name: 'asc' } },
    });
    const executed = await this.ledger.executedByCostCentre(
      [estateId],
      fiscalYear,
      items.map((i) => i.costCentreId),
    );
    return items.map((item) => ({
      ...item,
      costCentreName: item.costCentre.name,
      executed: executed.get(item.costCentreId) ?? ZERO,
    }));
  }

  async upsertCostCentreBudget(
    estateId: string,
    dto: UpsertCostCentreBudgetDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.fiscalYears.assertOpenForWrites(estateId, dto.fiscalYear);
    const centre = await this.prisma.costCentre.findFirst({
      where: { id: dto.costCentreId, estateId },
    });
    if (!centre)
      throw new BadRequestException(
        `Centro de coste ${dto.costCentreId} no encontrado en esta finca.`,
      );
    return this.prisma.costCentreBudget.upsert({
      where: {
        estateId_costCentreId_fiscalYear: {
          estateId,
          costCentreId: centre.id,
          fiscalYear: dto.fiscalYear,
        },
      },
      update: { budgeted: new Prisma.Decimal(dto.budgeted) },
      create: {
        estateId,
        costCentreId: centre.id,
        fiscalYear: dto.fiscalYear,
        budgeted: new Prisma.Decimal(dto.budgeted),
      },
    });
  }

  /**
   * Presupuesto frente a lo ejecutado del año, con lo ejecutado del año
   * anterior como referencia para preparar el siguiente, y el mínimo legal
   * del fondo de reserva (art. 9.1.f LPH: 10 % del presupuesto ordinario).
   */
  async analysis(
    estateId: string,
    fiscalYear: number,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const [budget, costCentreBudget, priorByAccount, priorByCentre, budgetAgg] =
      await Promise.all([
        this.listBudget(estateId, fiscalYear, user),
        this.listCostCentreBudget(estateId, fiscalYear, user),
        this.ledger.executedByAccount([estateId], fiscalYear - 1),
        this.ledger.executedByCostCentre([estateId], fiscalYear - 1),
        this.prisma.budgetItem.aggregate({
          where: { estateId, fiscalYear },
          _sum: { budgeted: true },
        }),
      ]);
    const annualBudget = budgetAgg._sum.budgeted;
    return {
      fiscalYear,
      budget: budget.map((b) => ({
        ...b,
        executedPriorYear: priorByAccount.get(b.accountId) ?? ZERO,
      })),
      costCentreBudget: costCentreBudget.map((c) => ({
        ...c,
        executedPriorYear: priorByCentre.get(c.costCentreId) ?? ZERO,
      })),
      reserveLegalMinimum: annualBudget ? annualBudget.mul(0.1) : null,
    };
  }
}
