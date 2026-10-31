import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { ResourcesService } from './resources.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  purgeAdministrator,
  roleB,
  uniqueEmail,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { JournalService } from '../ledger/journal/journal.service';
import { TreasuryPostingService } from '../ledger/posting/treasury-posting.service';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 43 — igual que la tarea 20 hizo con vencimiento de contratos: en vez
 * de un sistema de notificaciones nuevo, un branch más en el feed de
 * Alertas ya existente. Contra Postgres real: el umbral 90%/100% se calcula
 * sumando los apuntes del diario en vivo, exactamente el tipo de agregado
 * que un mock de Prisma no verifica de verdad. Los asientos no se borran,
 * así que cada prueba trabaja en su propia finca y todo se purga al final.
 */
jest.setTimeout(60_000);

const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
// Este spec no toca comunicados (ver comentario de cabecera) — sin
// dependencia real de ConfigService/StorageService/MailService.
const service = new ResourcesService(
  prisma as unknown as PrismaService,
  estateAccess,
  { get: () => undefined } as any,
  {} as any,
  {} as any,
  new RagAuthorizationService(prisma as unknown as PrismaService),
);
const treasury = new TreasuryPostingService(new JournalService());

const CURRENT_YEAR = new Date().getFullYear();

let admin: AdministratorFixture;
let estateId: string;
let accountId: string;
let cUserId: string;
let bUser: AuthenticatedUser;
let cUser: AuthenticatedUser;

async function makeBudgetItem(budgeted: string, fiscalYear = CURRENT_YEAR) {
  return prisma.budgetItem.create({
    data: {
      estateId,
      accountId,
      category: 'Reparaciones',
      fiscalYear,
      budgeted,
    },
  });
}

async function makeCostCentre(name: string) {
  return prisma.costCentre.create({
    data: { estateId, administratorId: admin.administratorId, name },
  });
}

async function makeCostCentreBudget(
  costCentreId: string,
  budgeted: string,
  fiscalYear = CURRENT_YEAR,
) {
  return prisma.costCentreBudget.create({
    data: { estateId, costCentreId, fiscalYear, budgeted },
  });
}

/** Gasto real en el diario: carga la 622 (con el centro, si lo hay) y abona la caja. */
async function spend(euros: number, date: string, costCentreId?: string) {
  await prisma.$transaction((tx) =>
    treasury.quickEntry(tx, {
      estateId,
      date: new Date(`${date}T00:00:00Z`),
      direction: 'out',
      amount: Math.round(euros * 100),
      place: { cash: true },
      counterpartAccountId: accountId,
      costCentreId,
      concept: 'Gasto de prueba',
    }),
  );
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (alertas presupuesto)',
  });
  const c = await prisma.user.create({
    data: {
      email: uniqueEmail('vecino-alertas'),
      passwordHash: 'x',
      fullName: 'Vecino de prueba',
      role: 'C',
    },
  });
  cUserId = c.id;
});

beforeEach(async () => {
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(`${CURRENT_YEAR - 1}-01-01T00:00:00Z`),
  });
  accountId = (
    await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '622' },
    })
  ).id;
  bUser = roleB(admin, [estateId]);
  cUser = {
    id: cUserId,
    role: 'C',
    estateIds: [estateId],
    administratorId: null,
  };
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId, [cUserId]);
  await prisma.$disconnect();
});

describe('ResourcesService.listAlerts — partidas de presupuesto al 90%+ (rol B)', () => {
  it('una cuenta al 90% de ejecución genera alerta no urgente', async () => {
    await makeBudgetItem('1000.00');
    await spend(900, `${CURRENT_YEAR}-03-01`);

    const alerts = await service.listAlerts(bUser);
    const alert = alerts.find(
      (a) => a.sourceType === 'budget_item' && a.description.includes('900.00'),
    );
    expect(alert).toBeDefined();
    expect(alert!.type).toBe('presupuesto');
    expect(alert!.urgent).toBe(false);
  });

  it('una cuenta que supera el 100% marca urgent:true (sobregasto real)', async () => {
    await makeBudgetItem('1000.00');
    await spend(1200, `${CURRENT_YEAR}-03-01`);

    const alerts = await service.listAlerts(bUser);
    const alert = alerts.find(
      (a) =>
        a.sourceType === 'budget_item' && a.description.includes('1200.00'),
    );
    expect(alert).toBeDefined();
    expect(alert!.urgent).toBe(true);
  });

  it('por debajo del 90% no genera ninguna alerta', async () => {
    await makeBudgetItem('1000.00');
    await spend(500, `${CURRENT_YEAR}-03-01`);

    const alerts = await service.listAlerts(bUser);
    expect(
      alerts.find(
        (a) =>
          a.sourceType === 'budget_item' && a.description.includes('500.00'),
      ),
    ).toBeUndefined();
  });

  it('un centro de coste al 90%+ también genera alerta, con su nombre en el título', async () => {
    const centre = await makeCostCentre('Piscina comunitaria');
    await makeCostCentreBudget(centre.id, '500.00');
    await spend(480, `${CURRENT_YEAR}-05-01`, centre.id);

    const alerts = await service.listAlerts(bUser);
    const alert = alerts.find(
      (a) =>
        a.sourceType === 'budget_item' &&
        a.title.includes('Piscina comunitaria'),
    );
    expect(alert).toBeDefined();
    expect(alert!.urgent).toBe(false);
  });

  it('una partida de un ejercicio distinto al actual queda excluida', async () => {
    await makeBudgetItem('100.00', CURRENT_YEAR - 1);
    // Sin gasto — igual, ni debería consultarse: la query ya filtra por fiscalYear actual.
    const alerts = await service.listAlerts(bUser);
    expect(alerts.filter((a) => a.sourceType === 'budget_item')).toHaveLength(
      0,
    );
  });

  it('un ejercicio cerrado explícitamente no genera alertas aunque esté sobregastado', async () => {
    await makeBudgetItem('100.00');
    await spend(200, `${CURRENT_YEAR}-03-01`);
    await prisma.fiscalYear.upsert({
      where: { estateId_year: { estateId, year: CURRENT_YEAR } },
      update: { status: 'Cerrado', closedAt: new Date() },
      create: {
        estateId,
        year: CURRENT_YEAR,
        startDate: new Date(Date.UTC(CURRENT_YEAR, 0, 1)),
        endDate: new Date(Date.UTC(CURRENT_YEAR, 11, 31)),
        status: 'Cerrado',
        closedAt: new Date(),
      },
    });

    const alerts = await service.listAlerts(bUser);
    expect(alerts.filter((a) => a.sourceType === 'budget_item')).toHaveLength(
      0,
    );
  });

  it('un rol C jamás ve alertas de presupuesto — no gestiona presupuestos', async () => {
    await makeBudgetItem('100.00');
    await spend(150, `${CURRENT_YEAR}-03-01`);

    const alerts = await service.listAlerts(cUser);
    expect(alerts.find((a) => a.sourceType === 'budget_item')).toBeUndefined();
  });
});
