import { ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { JournalService } from '../ledger/journal/journal.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { ManagerEconomicService } from './manager-economic.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real. «Hoy» se fija a 15-jun-2024 para que el ejercicio
 * vigente sea 2024 y los recibos de 2023 queden fuera del anillo.
 */
const prisma = createPrismaClient();
const service = new ManagerEconomicService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
  new LedgerQueryService(prisma as unknown as PrismaService),
);
const journal = new JournalService();
const TODAY = new Date('2024-06-15T10:00:00Z');

let admin: AdministratorFixture;
let other: AdministratorFixture;
let estateA: string;
let estateB: string;
let foreignEstate: string;
let user: AuthenticatedUser;

async function expense(
  estateId: string,
  date: string,
  euros: number,
  entryType?: 'regularization',
) {
  const account = await prisma.chartAccount.findFirstOrThrow({
    where: { estateId, code: '622' },
  });
  return journal.post(prisma, {
    estateId,
    date: new Date(`${date}T00:00:00Z`),
    entryType,
    sourceType: 'manual',
    concept: 'Gasto de prueba',
    lines: [
      { account: { accountId: account.id }, debit: Math.round(euros * 100) },
      { account: { role: 'cash' }, credit: Math.round(euros * 100) },
    ],
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (economico)',
  });
  other = await createAdministrator(prisma, {
    name: 'Otra gestora (economico)',
  });
  const cutoverDate = new Date(Date.UTC(2023, 0, 1));
  estateA = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate,
    estate: { name: 'Finca A — economico' },
  });
  estateB = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate,
    estate: { name: 'Finca B — economico' },
  });
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, {
    cutoverDate,
    estate: { name: 'Finca ajena — economico' },
  });
  user = roleB(admin, [estateA, estateB]);
  const pa = await createProperty(prisma, estateA);
  const pb = await createProperty(prisma, estateB);
  const pf = await createProperty(prisma, foreignEstate);

  // Finca A (sin fila de ejercicio => año natural 2024): 100 pagada + 150 pendiente en 2024; 60 pendiente de 2023 (fuera).
  await issueTestReceipt(prisma, {
    estateId: estateA,
    propertyId: pa,
    periodKey: '2024-02',
    amount: '100.00',
    status: 'Pagada',
  });
  await issueTestReceipt(prisma, {
    estateId: estateA,
    propertyId: pa,
    periodKey: '2024-03',
    amount: '150.00',
    status: 'Pendiente',
  });
  await issueTestReceipt(prisma, {
    estateId: estateA,
    propertyId: pa,
    periodKey: '2023-11',
    amount: '60.00',
    status: 'Pendiente',
  });
  await expense(estateA, '2024-03-10', 40);
  await expense(estateA, '2023-03-10', 500); // otro ejercicio
  await expense(estateA, '2024-12-31', 999, 'regularization'); // no es actividad

  // Finca B con ejercicio propio en BD: 200 devuelta (pendiente) + 50 pagada en 2024.
  await prisma.fiscalYear.create({
    data: {
      estateId: estateB,
      year: 2024,
      startDate: new Date(Date.UTC(2024, 0, 1)),
      endDate: new Date(Date.UTC(2024, 11, 31)),
    },
  });
  await issueTestReceipt(prisma, {
    estateId: estateB,
    propertyId: pb,
    periodKey: '2024-04',
    amount: '200.00',
    status: 'Devuelto',
  });
  await issueTestReceipt(prisma, {
    estateId: estateB,
    propertyId: pb,
    periodKey: '2024-05',
    amount: '50.00',
    status: 'Pagada',
  });
  await expense(estateB, '2024-05-02', 25.5);

  await issueTestReceipt(prisma, {
    estateId: foreignEstate,
    propertyId: pf,
    periodKey: '2024-02',
    amount: '999.00',
    status: 'Pendiente',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('ManagerEconomicService.summary', () => {
  it('una finca: el anillo es lo emitido en su ejercicio y cobrado + pendiente = facturado', async () => {
    const a = await service.summary(user, estateA, TODAY);
    expect(a).toMatchObject({
      estateId: estateA,
      fiscalYear: 2024,
      billed: 250,
      collected: 100,
      pending: 150,
      expenses: 40,
    });
    expect(a.collected + a.pending).toBe(a.billed);
  });

  it('el ejercicio vigente sale de su fila si existe', async () => {
    const b = await service.summary(user, estateB, TODAY);
    expect(b).toMatchObject({
      fiscalYear: 2024,
      billed: 250,
      collected: 50,
      pending: 200,
      expenses: 25.5,
    });
  });

  it('vista global: suma de las fincas del gestor, sin la ajena', async () => {
    const all = await service.summary(user, undefined, TODAY);
    expect(all).toMatchObject({
      estateId: null,
      fiscalYear: null,
      billed: 500,
      collected: 150,
      pending: 350,
      expenses: 65.5,
    });
  });

  it('tesorería y fondo de reserva coinciden con la ficha de cada finca', async () => {
    const query = new LedgerQueryService(prisma as unknown as PrismaService);
    const [a, b] = await Promise.all([
      query.estateFigures(estateA, 2024),
      query.estateFigures(estateB, 2024),
    ]);
    const all = await service.summary(user, undefined, TODAY);
    expect(all.treasury).toBe(
      Number(a.treasury.plus(b.treasury).toDecimalPlaces(2)),
    );
    expect(all.reserve).toBe(
      Number(a.reserve.plus(b.reserve).toDecimalPlaces(2)),
    );
    expect(all.expenses).toBe(
      Number(a.expenses.plus(b.expenses).toDecimalPlaces(2)),
    );
  });

  it('una finca ajena es 403; un gestor sin fincas recibe todo a 0', async () => {
    await expect(
      service.summary(user, foreignEstate, TODAY),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await service.summary(roleB(other, []), undefined, TODAY),
    ).toMatchObject({
      billed: 0,
      collected: 0,
      pending: 0,
      treasury: 0,
      reserve: 0,
      expenses: 0,
    });
  });
});
