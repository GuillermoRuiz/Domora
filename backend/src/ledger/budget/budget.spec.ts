import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { FiscalYearsService } from '../../fiscal-years/fiscal-years.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { JournalService } from '../journal/journal.service';
import { TreasuryPostingService } from '../posting/treasury-posting.service';
import { LedgerQueryService } from '../ledger-query.service';
import { BudgetService } from './budget.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Presupuesto frente a lo ejecutado (fase 8c): lo ejecutado sale del
 * diario. Portado de la antigua budget-analysis.spec.ts (libro de caja).
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const access = new EstateAccessService();
const journal = new JournalService();
const treasury = new TreasuryPostingService(journal);
const service = new BudgetService(
  db,
  access,
  new FiscalYearsService(db, access),
  new LedgerQueryService(db),
);

const YEAR = new Date().getFullYear();
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  user: AuthenticatedUser;
  account: (code: string) => Promise<string>;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D(`${YEAR - 1}-01-01`),
  });
  return {
    estateId,
    user: roleB(admin, [estateId]),
    account: async (code) =>
      (
        await prisma.chartAccount.findFirstOrThrow({
          where: { estateId, code },
        })
      ).id,
  };
}

async function spend(
  ctx: Ctx,
  date: string,
  euros: number,
  code: string,
  costCentreId?: string,
) {
  return prisma.$transaction(async (tx) =>
    treasury.quickEntry(tx, {
      estateId: ctx.estateId,
      date: D(date),
      direction: euros > 0 ? 'out' : 'in',
      amount: Math.round(Math.abs(euros) * 100),
      place: { cash: true },
      counterpartAccountId: await ctx.account(code),
      costCentreId,
      concept: 'Prueba',
    }),
  );
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (presupuesto)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Presupuesto por cuenta', () => {
  it('la categoría la pone el servidor desde la cuenta, no el cliente', async () => {
    const ctx = await freshEstate();
    const item = await service.upsertBudgetItem(
      ctx.estateId,
      {
        accountCode: '622',
        category: 'INVENTADA',
        fiscalYear: YEAR,
        budgeted: 1000,
      },
      ctx.user,
    );
    expect(item.category).toBe('Reparac. y conservac.');
  });

  it('no se escribe en un ejercicio cerrado', async () => {
    const ctx = await freshEstate();
    await prisma.fiscalYear.upsert({
      where: { estateId_year: { estateId: ctx.estateId, year: YEAR + 1 } },
      update: { status: 'Cerrado', closedAt: new Date() },
      create: {
        estateId: ctx.estateId,
        year: YEAR + 1,
        startDate: D(`${YEAR + 1}-01-01`),
        endDate: D(`${YEAR + 1}-12-31`),
        status: 'Cerrado',
        closedAt: new Date(),
      },
    });
    await expect(
      service.upsertBudgetItem(
        ctx.estateId,
        {
          accountCode: '622',
          category: 'x',
          fiscalYear: YEAR + 1,
          budgeted: 100,
        },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lo ejecutado sale del diario: gasto en cuentas de gasto, ingreso en las de ingresos, y una anulación resta', async () => {
    const ctx = await freshEstate();
    await service.upsertBudgetItem(
      ctx.estateId,
      { accountCode: '622', category: 'x', fiscalYear: YEAR, budgeted: 1000 },
      ctx.user,
    );
    await service.upsertBudgetItem(
      ctx.estateId,
      { accountCode: '752', category: 'x', fiscalYear: YEAR, budgeted: 500 },
      ctx.user,
    );
    await spend(ctx, `${YEAR}-02-01`, 300, '622');
    const mistake = await spend(ctx, `${YEAR}-02-02`, 50, '622');
    await prisma.$transaction((tx) =>
      journal.reverse(tx, mistake.id, { date: D(`${YEAR}-02-03`) }),
    );
    await spend(ctx, `${YEAR}-03-01`, -200, '752');
    await spend(ctx, `${YEAR - 1}-06-01`, 999, '622');

    const rows = await service.listBudget(ctx.estateId, YEAR, ctx.user);
    expect(rows.map((r) => [r.accountCode, r.executed.toString()])).toEqual([
      ['622', '300'],
      ['752', '200'],
    ]);
  });
});

describe('Presupuesto por centro de coste', () => {
  it('upsert crea y luego actualiza la misma fila; lo ejecutado es el gasto etiquetado del año', async () => {
    const ctx = await freshEstate();
    const centre = await prisma.costCentre.create({
      data: {
        estateId: ctx.estateId,
        administratorId: admin.administratorId,
        name: 'Jardín comunitario',
      },
    });
    const created = await service.upsertCostCentreBudget(
      ctx.estateId,
      { costCentreId: centre.id, fiscalYear: YEAR, budgeted: 500 },
      ctx.user,
    );
    const updated = await service.upsertCostCentreBudget(
      ctx.estateId,
      { costCentreId: centre.id, fiscalYear: YEAR, budgeted: 300 },
      ctx.user,
    );
    expect(updated.id).toBe(created.id);

    await spend(ctx, `${YEAR}-04-01`, 120, '622', centre.id);
    await spend(ctx, `${YEAR}-04-02`, -40, '752', centre.id); // un ingreso del centro no es gasto
    const [row] = await service.listCostCentreBudget(
      ctx.estateId,
      YEAR,
      ctx.user,
    );
    expect(row.executed.toString()).toBe('120');
    expect(row.costCentreName).toBe('Jardín comunitario');
  });
});

describe('Análisis', () => {
  it('compara con lo ejecutado del año anterior y calcula la reserva legal mínima (10 %)', async () => {
    const ctx = await freshEstate();
    await service.upsertBudgetItem(
      ctx.estateId,
      { accountCode: '622', category: 'x', fiscalYear: YEAR, budgeted: 1000 },
      ctx.user,
    );
    await spend(ctx, `${YEAR - 1}-06-01`, 400, '622');
    const analysis = await service.analysis(ctx.estateId, YEAR, ctx.user);
    expect(analysis.budget[0].executedPriorYear.toString()).toBe('400');
    expect(analysis.budget[0].executed.toString()).toBe('0');
    expect(analysis.reserveLegalMinimum?.toString()).toBe('100');
    await expect(
      service.analysis(ctx.estateId, YEAR, roleB(admin, [])),
    ).rejects.toThrow();
  });
});
