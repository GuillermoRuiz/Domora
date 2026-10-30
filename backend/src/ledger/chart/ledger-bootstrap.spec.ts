import { EstatesService } from '../../estates/estates.service';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  createAdministrator,
  createEstate,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { COMMUNITY_CHART_TEMPLATE } from './chart-template';
import {
  createBankAccountWithSubaccount,
  ensureChartTemplate,
  ensureDefaultBankAccount,
  firstDayOfMonthUtc,
} from './ledger-bootstrap';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Arranque de la contabilidad de una finca contra Postgres real: lo que
 * importa (ON CONFLICT, cuentas heredadas, concurrencia) solo se demuestra
 * con la base de datos de verdad.
 */
jest.setTimeout(60_000);

// Veinte transacciones a la vez abren conexiones nuevas: en máquinas lentas (Windows) superan el maxWait de 2 s por defecto.
const prisma = createPrismaClient(undefined, { transactionOptions: { maxWait: 20_000 } });
let admin: AdministratorFixture;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (arranque contable)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('EstatesService.create — deja la contabilidad lista', () => {
  it('crea configuración con corte a primeros de mes, la plantilla completa y un banco por defecto', async () => {
    const service = new EstatesService(
      prisma as unknown as PrismaService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { refreshEstate: jest.fn() } as never,
    );
    const estate = await service.create(
      {
        name: 'Finca nueva',
        type: 'Edificio',
        address: 'Calle Nueva 1',
        location: 'Madrid',
      } as never,
      roleB(admin, []),
    );

    const settings = await prisma.accountingSettings.findUniqueOrThrow({
      where: { estateId: estate.id },
    });
    expect(settings.cutoverDate.toISOString()).toBe(
      firstDayOfMonthUtc(new Date()).toISOString(),
    );

    const accounts = await prisma.chartAccount.findMany({
      where: { estateId: estate.id },
    });
    for (const t of COMMUNITY_CHART_TEMPLATE) {
      const a = accounts.find((x) => x.code === t.code);
      expect(a).toBeDefined();
      expect(a!.system).toBe(true);
      expect(a!.nature).toBe(t.nature);
      expect(a!.systemRole).toBe(t.systemRole ?? null);
    }
    const receivable = accounts.find((a) => a.code === '430')!;
    expect(receivable.requiresProperty).toBe(true);
    expect(accounts.find((a) => a.code === '572')!.postable).toBe(false);
    expect(accounts.find((a) => a.code === '622')!.allowsCostCentre).toBe(true);
    expect(accounts.find((a) => a.code === '555')!.allowsCostCentre).toBe(
      false,
    );

    const banks = await prisma.bankAccount.findMany({
      where: { estateId: estate.id },
      include: { chartAccount: true },
    });
    expect(banks).toHaveLength(1);
    expect(banks[0].isDefault).toBe(true);
    expect(banks[0].chartAccount.code).toBe('5720001');
    expect(banks[0].chartAccount.systemRole).toBe('bank');
    expect(banks[0].chartAccount.level).toBe(2);
  });
});

describe('ensureChartTemplate', () => {
  it('es idempotente: ejecutarla dos veces no duplica ni modifica nada', async () => {
    const estateId = await createEstate(prisma, admin.administratorId);
    await ensureChartTemplate(prisma, estateId);
    const first = await prisma.chartAccount.findMany({
      where: { estateId },
      orderBy: { code: 'asc' },
    });
    await ensureChartTemplate(prisma, estateId);
    const second = await prisma.chartAccount.findMany({
      where: { estateId },
      orderBy: { code: 'asc' },
    });
    expect(second).toEqual(first);
    expect(first).toHaveLength(COMMUNITY_CHART_TEMPLATE.length);
  });

  it('convierte en cuenta de sistema una cuenta heredada con el mismo código, sin duplicarla', async () => {
    const estateId = await createEstate(prisma, admin.administratorId);
    const legacy = await prisma.chartAccount.create({
      data: {
        estateId,
        administratorId: admin.administratorId,
        code: '700',
        name: 'Cuotas de comunidad',
        nature: 'income',
      },
    });
    await ensureChartTemplate(prisma, estateId);
    const after = await prisma.chartAccount.findMany({
      where: { estateId, code: '700' },
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(legacy.id);
    expect(after[0].system).toBe(true);
    expect(after[0].systemRole).toBe('income_ordinary');
    // El nombre que le dio la gestora se respeta.
    expect(after[0].name).toBe('Cuotas de comunidad');
  });
});

describe('Cuentas bancarias', () => {
  it('dos altas simultáneas del banco por defecto dejan una sola cuenta', async () => {
    const estateId = await createEstate(prisma, admin.administratorId);
    await ensureChartTemplate(prisma, estateId);
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) => ensureDefaultBankAccount(tx, estateId)),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.bankAccount.count({ where: { estateId } })).toBe(1);
  });

  it('cada banco nuevo recibe la siguiente subcuenta 572 libre, también en paralelo', async () => {
    const estateId = await createEstate(prisma, admin.administratorId);
    await Promise.all(
      ['Banco A', 'Banco B', 'Banco C'].map((alias) =>
        prisma.$transaction((tx) =>
          createBankAccountWithSubaccount(tx, estateId, { alias }),
        ),
      ),
    );
    const codes = (
      await prisma.bankAccount.findMany({
        where: { estateId },
        include: { chartAccount: true },
      })
    )
      .map((b) => b.chartAccount.code)
      .sort();
    expect(codes).toEqual(['5720001', '5720002', '5720003']);
  });
});
