import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { AccountingService } from '../accounting/accounting.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { JournalService } from '../ledger/journal/journal.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  createSupplier,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { EstateDashboardService } from './estate-dashboard.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: lo que importa son las agregaciones
 * (propiedades distintas con deuda, incidencias activas del año, la junta
 * convocada más cercana) y que una gestora no vea fincas ajenas.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
const journal = new JournalService();
const posting = new ReceiptPostingService(journal);
const accounting = new AccountingService(
  prisma as unknown as PrismaService,
  estateAccess,
  undefined as never,
  posting,
  new CollectionPostingService(journal, posting),
  { notify: jest.fn() } as unknown as NotificationsService,
);
const service = new EstateDashboardService(
  prisma as unknown as PrismaService,
  accounting,
  estateAccess,
  new LedgerQueryService(prisma as unknown as PrismaService),
);

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estateId: string;
let user: AuthenticatedUser;
let issueCounter = 0;

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

function makeIssue(
  propertyId: string,
  opts: {
    status: 'Abierta' | 'EnReparacion' | 'Resuelta';
    date?: Date;
    deleted?: boolean;
  },
) {
  issueCounter += 1;
  return prisma.issue.create({
    data: {
      ref: `DSH-${Date.now()}-${issueCounter}`,
      estateId,
      type: 'Fuga',
      title: 'Incidencia de prueba',
      description: 'x',
      status: opts.status,
      priority: 'Normal',
      source: 'Comunidad',
      date: opts.date ?? new Date(),
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
}

function makeMeeting(opts: {
  title: string;
  at: Date;
  status?: 'convocada' | 'celebrada' | 'cancelada';
  type?: 'ordinaria' | 'extraordinaria';
}) {
  return prisma.meeting.create({
    data: {
      estateId,
      title: opts.title,
      type: opts.type ?? 'ordinaria',
      status: opts.status ?? 'convocada',
      scheduledAt1: opts.at,
      scheduledAt2: new Date(opts.at.getTime() + 30 * 60_000),
      agenda: [],
      convokedBy: 'presidente',
      signerRole: 'administrador',
      createdByUserId: admin.userId,
    },
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (dashboard)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (dashboard)',
  });
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2099, 0, 1)),
    estate: { name: 'Finca de prueba — dashboard' },
  });
  user = roleB(admin, [estateId]);
});

afterAll(async () => {
  const estateIds = (
    await prisma.estate.findMany({
      where: {
        administratorId: {
          in: [admin.administratorId, otherAdmin.administratorId],
        },
      },
      select: { id: true },
    })
  ).map((e) => e.id);
  await prisma.issue.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.activityLogEntry.deleteMany({
    where: {
      OR: [
        { estateId: { in: estateIds } },
        { property: { estateId: { in: estateIds } } },
      ],
    },
  });
  await prisma.supplierContract.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.regulatoryInspection.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.inspectionType.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.asset.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.meeting.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.issue.deleteMany({ where: { estateId } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
});

describe('EstateDashboardService.summary', () => {
  it('una finca vacía devuelve ceros y sin próxima junta (no rompe)', async () => {
    const out = await service.summary(estateId, user);
    expect(out).toEqual({
      estateId,
      units: 0,
      balance: 0,
      pendingDues: { amount: 0, properties: 0 },
      issues: { open: 0, thisYear: 0 },
      nextMeeting: null,
    });
  });

  describe('con datos', () => {
    let p1: string;
    let p2: string;

    beforeAll(async () => {
      p1 = await createProperty(prisma, estateId, { ref: 'D1' });
      p2 = await createProperty(prisma, estateId, { ref: 'D2' });
      await createProperty(prisma, estateId, { ref: 'D3' }); // al día

      // Deuda: p1 debe 2 recibos, p2 uno devuelto; uno cobrado no cuenta.
      await issueTestReceipt(prisma, {
        estateId,
        propertyId: p1,
        periodKey: '2099-01',
        amount: '100.00',
        status: 'Pendiente',
      });
      await issueTestReceipt(prisma, {
        estateId,
        propertyId: p1,
        periodKey: '2099-02',
        amount: '50.00',
        status: 'Pendiente',
      });
      await issueTestReceipt(prisma, {
        estateId,
        propertyId: p2,
        periodKey: '2099-03',
        amount: '80.50',
        status: 'Devuelto',
      });
      await issueTestReceipt(prisma, {
        estateId,
        propertyId: p2,
        periodKey: '2099-04',
        amount: '999.00',
        status: 'Pagada',
      });

      // Incidencias: 2 activas este año, 1 resuelta este año, 1 activa del año pasado, 1 borrada.
      await makeIssue(p1, { status: 'Abierta' });
      await makeIssue(p2, { status: 'EnReparacion' });
      await makeIssue(p1, { status: 'Resuelta' });
      await makeIssue(p2, {
        status: 'Abierta',
        date: new Date(Date.UTC(new Date().getUTCFullYear() - 1, 5, 1)),
      });
      await makeIssue(p1, { status: 'Abierta', deleted: true });

      // Juntas: la próxima convocada es la de +10 días; pasadas, canceladas y celebradas no cuentan.
      await makeMeeting({ title: 'Pasada', at: inDays(-5) });
      await makeMeeting({
        title: 'Cancelada cercana',
        at: inDays(2),
        status: 'cancelada',
      });
      await makeMeeting({
        title: 'Celebrada',
        at: inDays(3),
        status: 'celebrada',
      });
      await makeMeeting({
        title: 'Lejana',
        at: inDays(60),
        type: 'extraordinaria',
      });
      await makeMeeting({ title: 'Próxima', at: inDays(10) });
    });

    it('cuenta las propiedades y suma la deuda de recibos pendientes y devueltos, no la de los cobrados', async () => {
      const out = await service.summary(estateId, user);
      expect(out.units).toBe(3);
      expect(out.pendingDues.amount).toBeCloseTo(230.5, 2);
      expect(out.pendingDues.properties).toBe(2); // p1 y p2, cada una una sola vez
    });

    it('el saldo es el dinero en bancos del diario (los cobros lo suben)', async () => {
      const out = await service.summary(estateId, user);
      expect(out.balance).toBeCloseTo(999, 2); // solo el recibo cobrado de 999 €
    });

    it('incidencias: abiertas = activas sin borrar; este año = todas las del año sin borrar', async () => {
      const out = await service.summary(estateId, user);
      expect(out.issues).toEqual({ open: 3, thisYear: 3 });
    });

    it('próxima junta = la convocada más cercana en el futuro', async () => {
      const out = await service.summary(estateId, user);
      expect(out.nextMeeting).toMatchObject({
        title: 'Próxima',
        type: 'ordinaria',
      });
      expect(new Date(out.nextMeeting!.scheduledAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  it('una gestora no puede ver el resumen de la finca de otra', async () => {
    const intruder = roleB(otherAdmin, []);
    await expect(service.summary(estateId, intruder)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('EstateDashboardService.cashflow', () => {
  let cashEstateId: string;
  let cashUser: AuthenticatedUser;
  let propertyId: string;
  let expenseAccountId: string;

  const postExpense = (
    date: string,
    euros: number,
    entryType?: 'regularization',
  ) =>
    journal.post(prisma, {
      estateId: cashEstateId,
      date: new Date(`${date}T00:00:00Z`),
      entryType,
      sourceType: 'manual',
      concept: 'Gasto de prueba',
      lines: [
        {
          account: { accountId: expenseAccountId },
          debit: Math.round(euros * 100),
        },
        { account: { role: 'cash' }, credit: Math.round(euros * 100) },
      ],
    });

  beforeAll(async () => {
    cashEstateId = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: new Date(Date.UTC(2023, 0, 1)),
      estate: { name: 'Finca de prueba — cashflow' },
    });
    cashUser = roleB(admin, [cashEstateId]);
    propertyId = await createProperty(prisma, cashEstateId, { ref: 'C1' });
    expenseAccountId = (
      await prisma.chartAccount.findFirstOrThrow({
        where: { estateId: cashEstateId, code: '622' },
      })
    ).id;

    // Ingresos (cuotas emitidas): marzo 150 €, mayo 80 € de 2024; 60 € de 2023.
    await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId,
      periodKey: '2024-03',
      amount: '100.00',
      status: 'Pendiente',
    });
    await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId,
      periodKey: '2024-03',
      amount: '50.00',
      status: 'Pendiente',
    });
    await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId,
      periodKey: '2024-05',
      amount: '80.00',
      status: 'Pendiente',
    });
    await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId,
      periodKey: '2023-11',
      amount: '60.00',
      status: 'Pendiente',
    });
    // Gastos: marzo 40 €, abril 25,50 € de 2024; una regularización que NO es actividad.
    await postExpense('2024-03-10', 40);
    await postExpense('2024-04-02', 25.5);
    await postExpense('2024-12-31', 999, 'regularization');
  });

  it('siempre devuelve 12 meses y agrupa ingresos y gastos en el mes de su asiento', async () => {
    const out = await service.cashflow(cashEstateId, cashUser, 2024);
    expect(out.year).toBe(2024);
    expect(out.months).toHaveLength(12);
    expect(out.months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const by = (m: number) => out.months[m - 1];
    expect(by(3)).toEqual({ month: 3, income: 150, expenses: 40 });
    expect(by(4)).toEqual({ month: 4, income: 0, expenses: 25.5 });
    expect(by(5)).toEqual({ month: 5, income: 80, expenses: 0 });
    expect(by(1)).toEqual({ month: 1, income: 0, expenses: 0 });
  });

  it('no suma asientos de regularización ni de otros ejercicios', async () => {
    const out = await service.cashflow(cashEstateId, cashUser, 2024);
    expect(out.months[11].expenses).toBe(0); // la regularización de 999 € de diciembre no cuenta
    const total = out.months.reduce((s, m) => s + m.income, 0);
    expect(total).toBe(230); // los 60 € de 2023 quedan fuera
    const previous = await service.cashflow(cashEstateId, cashUser, 2023);
    expect(previous.months[10].income).toBe(60);
  });

  it('lista los ejercicios con movimientos para el selector, incluido el actual', async () => {
    const out = await service.cashflow(cashEstateId, cashUser, 2024);
    expect(out.years).toEqual(
      expect.arrayContaining([2023, 2024, new Date().getUTCFullYear()]),
    );
    expect([...out.years].sort((a, b) => a - b)).toEqual(out.years);
  });

  it('sin year usa el año en curso', async () => {
    const out = await service.cashflow(cashEstateId, cashUser);
    expect(out.year).toBe(new Date().getUTCFullYear());
  });

  it('rechaza un ejercicio absurdo', async () => {
    await expect(
      service.cashflow(cashEstateId, cashUser, 1999),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.cashflow(cashEstateId, cashUser, 2500),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una gestora no puede ver los gráficos de la finca de otra', async () => {
    await expect(
      service.cashflow(cashEstateId, roleB(otherAdmin, []), 2024),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('EstateDashboardService.expenseBreakdown', () => {
  let estate: string;
  let breakdownUser: AuthenticatedUser;

  async function expense(
    code: string,
    date: string,
    euros: number,
    entryType?: 'regularization',
  ) {
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId: estate, code },
    });
    return journal.post(prisma, {
      estateId: estate,
      date: new Date(`${date}T00:00:00Z`),
      entryType,
      sourceType: 'manual',
      concept: `Gasto ${code}`,
      lines: [
        { account: { accountId: account.id }, debit: Math.round(euros * 100) },
        { account: { role: 'cash' }, credit: Math.round(euros * 100) },
      ],
    });
  }

  beforeAll(async () => {
    estate = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: new Date(Date.UTC(2023, 0, 1)),
      estate: { name: 'Finca de prueba — reparto de gastos' },
    });
    breakdownUser = roleB(admin, [estate]);
    await expense('622', '2024-02-10', 300); // mantenimiento
    await expense('622', '2024-06-10', 100.5);
    await expense('628', '2024-03-01', 250); // suministros
    await expense('640', '2024-04-01', 1000); // personal
    await expense('642', '2024-04-02', 320); // personal (Seguridad Social)
    await expense('625', '2024-05-01', 150); // seguros
    await expense('678', '2024-07-01', 40); // gasto excepcional -> otros
    await expense('622', '2024-12-31', 999, 'regularization'); // no es actividad
    await expense('628', '2023-09-01', 77); // otro ejercicio
  });

  it('agrupa las cuentas de gasto por categoría, de mayor a menor, y suma el total', async () => {
    const out = await service.expenseBreakdown(estate, breakdownUser, 2024);
    expect(out.year).toBe(2024);
    expect(out.categories).toEqual([
      { key: 'staff', label: 'Personal', amount: 1320 },
      { key: 'maintenance', label: 'Mantenimiento', amount: 400.5 },
      { key: 'supplies', label: 'Suministros', amount: 250 },
      { key: 'insurance', label: 'Seguros', amount: 150 },
      { key: 'other', label: 'Otros', amount: 40 },
    ]);
    expect(out.total).toBe(2160.5);
  });

  it('no incluye la regularización ni los gastos de otros ejercicios, y omite categorías vacías', async () => {
    const out = await service.expenseBreakdown(estate, breakdownUser, 2024);
    expect(out.categories.find((c) => c.key === 'services')).toBeUndefined();
    expect(out.categories.find((c) => c.key === 'maintenance')!.amount).toBe(
      400.5,
    ); // sin los 999 de regularización
    const previous = await service.expenseBreakdown(
      estate,
      breakdownUser,
      2023,
    );
    expect(previous.categories).toEqual([
      { key: 'supplies', label: 'Suministros', amount: 77 },
    ]);
  });

  it('un ejercicio sin gastos devuelve total 0 y ninguna categoría', async () => {
    expect(await service.expenseBreakdown(estate, breakdownUser, 2022)).toEqual(
      { year: 2022, total: 0, categories: [] },
    );
  });

  it('valida el ejercicio y el acceso a la finca', async () => {
    await expect(
      service.expenseBreakdown(estate, breakdownUser, 1999),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.expenseBreakdown(estate, roleB(otherAdmin, []), 2024),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('EstateDashboardService.milestones', () => {
  let estate: string;
  let milestonesUser: AuthenticatedUser;
  const dayOffset = (n: number) => {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n),
    );
  };
  const iso = (n: number) => dayOffset(n).toISOString().slice(0, 10);

  async function meeting(
    title: string,
    at: Date,
    status: 'convocada' | 'cancelada' | 'celebrada' = 'convocada',
  ) {
    return prisma.meeting.create({
      data: {
        estateId: estate,
        title,
        type: 'ordinaria',
        status,
        scheduledAt1: at,
        scheduledAt2: new Date(at.getTime() + 30 * 60_000),
        agenda: [],
        convokedBy: 'presidente',
        signerRole: 'administrador',
        createdByUserId: admin.userId,
      },
    });
  }

  beforeAll(async () => {
    estate = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: new Date(Date.UTC(2023, 0, 1)),
      estate: { name: 'Finca de prueba — hitos' },
    });
    milestonesUser = roleB(admin, [estate]);

    await meeting('Junta ordinaria', dayOffset(20));
    await meeting('Junta cancelada', dayOffset(3), 'cancelada');
    await meeting('Junta ya celebrada', dayOffset(4), 'celebrada');
    await meeting('Junta pasada sin celebrar', dayOffset(-10));
    await meeting('Junta lejana', dayOffset(500));

    const asset = await prisma.asset.create({
      data: {
        estateId: estate,
        name: 'Ascensor portal 1',
        category: 'Ascensores',
      },
    });
    const type = await prisma.inspectionType.create({
      data: {
        estateId: estate,
        code: 'ascensor',
        name: 'Inspección de ascensor',
      },
    });
    const inspection = (
      status: 'planificada' | 'citada' | 'vencida' | 'realizada',
      due: Date | null,
      appointment: Date | null = null,
    ) =>
      prisma.regulatoryInspection.create({
        data: {
          estateId: estate,
          assetId: asset.id,
          inspectionTypeId: type.id,
          status,
          nextDueDate: due,
          appointmentDate: appointment,
          createdByUserId: admin.userId,
        },
      });
    await inspection('planificada', dayOffset(40));
    await inspection('citada', dayOffset(90), dayOffset(15)); // la cita manda sobre el vencimiento
    await inspection('vencida', dayOffset(-30));
    await inspection('realizada', dayOffset(5)); // ya hecha: no es un hito
    await inspection('planificada', null); // sin fecha: no es un hito

    const supplier = await createSupplier(
      prisma,
      estate,
      admin.administratorId,
      { name: 'Seguros Credimar S.L.' },
    );
    const contract = (end: Date | null, cancelled = false) =>
      prisma.supplierContract.create({
        data: {
          supplierId: supplier,
          estateId: estate,
          serviceType: 'Seguro del edificio',
          startDate: dayOffset(-300),
          endDate: end,
          renewalType: 'manual',
          cancelledAt: cancelled ? new Date() : null,
        },
      });
    await contract(dayOffset(60));
    await contract(dayOffset(10), true); // cancelado: no cuenta
    await contract(null); // sin vencimiento
    await contract(dayOffset(-5)); // ya vencido: no es "próximo"
  });

  it('une juntas, inspecciones y vencimientos de contrato, de lo vencido a lo más lejano', async () => {
    const { items } = await service.milestones(estate, milestonesUser);
    expect(items.map((i) => [i.kind, i.date.slice(0, 10), i.overdue])).toEqual([
      ['inspection', iso(-30), true], // vencida: primero y marcada
      ['inspection', iso(15), false], // la cita (15) en lugar del vencimiento (90)
      ['meeting', iso(20), false],
      ['inspection', iso(40), false],
      ['contract', iso(60), false],
    ]);
  });

  it('los títulos dicen qué es cada hito', async () => {
    const { items } = await service.milestones(estate, milestonesUser);
    expect(items.find((i) => i.kind === 'meeting')!.title).toBe(
      'Junta ordinaria',
    );
    expect(items.find((i) => i.kind === 'inspection')!.title).toBe(
      'Inspección de ascensor · Ascensor portal 1',
    );
    expect(items.find((i) => i.kind === 'contract')!.title).toBe(
      'Vence contrato de Seguros Credimar S.L. (Seguro del edificio)',
    );
  });

  it('las juntas llevan hora (ISO); inspecciones y contratos, solo el día', async () => {
    const { items } = await service.milestones(estate, milestonesUser);
    expect(items.find((i) => i.kind === 'meeting')!.date).toMatch(
      /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(items.find((i) => i.kind === 'contract')!.date).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('no pasa de seis hitos', async () => {
    for (let i = 0; i < 6; i++) await meeting(`Extra ${i}`, dayOffset(100 + i));
    const { items } = await service.milestones(estate, milestonesUser);
    expect(items).toHaveLength(6);
  });

  it('una finca sin nada devuelve la lista vacía y una gestora ajena no puede verla', async () => {
    const empty = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca de prueba — sin hitos' },
    });
    expect(await service.milestones(empty, roleB(admin, [empty]))).toEqual({
      items: [],
    });
    await expect(
      service.milestones(estate, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('EstateDashboardService.activity', () => {
  let estate: string;
  let otherEstate: string;
  let activityUser: AuthenticatedUser;
  let propertyId: string;
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  const entry = (
    summary: string,
    occurredAt: Date,
    opts: {
      estateId?: string | null;
      propertyId?: string | null;
      actor?: boolean;
      subjectType?: 'issue' | 'membership' | 'property';
    } = {},
  ) =>
    prisma.activityLogEntry.create({
      data: {
        subjectType: opts.subjectType ?? 'issue',
        subjectId: estate,
        verb: 'created',
        summary,
        occurredAt,
        estateId: opts.estateId === undefined ? estate : opts.estateId,
        propertyId: opts.propertyId ?? null,
        actorUserId: opts.actor ? admin.userId : null,
      },
    });

  beforeAll(async () => {
    estate = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca de prueba — actividad' },
    });
    otherEstate = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Otra finca — actividad' },
    });
    activityUser = roleB(admin, [estate]);
    propertyId = await createProperty(prisma, estate, { ref: 'A1' });

    await entry('Nueva incidencia: avería en ascensor', ago(10), {
      actor: true,
      propertyId,
    });
    await entry('Se ha registrado un pago de cuota', ago(120));
    await entry('Entrada solo con propiedad (sin finca)', ago(60), {
      estateId: null,
      propertyId,
    });
    await entry('Actividad de OTRA finca', ago(5), { estateId: otherEstate });
    await entry('Nuevo titular en 2ºA', ago(30), {
      subjectType: 'membership',
      propertyId,
    });
    await entry('Importadas 24 propiedades del Catastro', ago(90), {
      subjectType: 'property',
    });
  });

  it('lista la actividad de la finca y de sus propiedades, la más reciente primero', async () => {
    const { items } = await service.activity(estate, activityUser);
    expect(items.map((i) => i.summary)).toEqual([
      'Nueva incidencia: avería en ascensor',
      'Nuevo titular en 2ºA',
      'Entrada solo con propiedad (sin finca)',
      'Importadas 24 propiedades del Catastro',
      'Se ha registrado un pago de cuota',
    ]);
  });

  it('no mezcla la actividad de otra finca', async () => {
    const { items } = await service.activity(estate, activityUser);
    expect(items.some((i) => i.summary.includes('OTRA finca'))).toBe(false);
  });

  it('expone quién lo hizo y a qué propiedad se refiere, o null si no consta', async () => {
    const { items } = await service.activity(estate, activityUser);
    expect(items[0]).toMatchObject({
      verb: 'created',
      subjectType: 'issue',
      actorName: 'Gestor de prueba',
      propertyRef: 'A1',
    });
    expect(items[4]).toMatchObject({ actorName: null, propertyRef: null });
    expect(new Date(items[0].occurredAt).getTime()).toBeLessThan(Date.now());
  });

  it('puede limitarse a ciertos tipos (altas y cambios de propiedades) y rechaza tipos que no existen', async () => {
    const { items } = await service.activity(estate, activityUser, undefined, [
      'membership',
      'property',
    ]);
    expect(items.map((i) => i.summary)).toEqual([
      'Nuevo titular en 2ºA',
      'Importadas 24 propiedades del Catastro',
    ]);
    await expect(
      service.activity(estate, activityUser, undefined, [
        'membership',
        'inventado',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    // el límite se aplica DESPUÉS de filtrar: pedir 1 devuelve la más reciente de esos tipos, no la más reciente de todas
    expect(
      (await service.activity(estate, activityUser, 1, ['property'])).items.map(
        (i) => i.summary,
      ),
    ).toEqual(['Importadas 24 propiedades del Catastro']);
  });

  it('respeta el límite pedido y rechaza uno absurdo', async () => {
    expect(
      (await service.activity(estate, activityUser, 2)).items,
    ).toHaveLength(2);
    await expect(
      service.activity(estate, activityUser, 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.activity(estate, activityUser, 31),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una finca sin actividad devuelve la lista vacía y una gestora ajena no puede verla', async () => {
    const quiet = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca tranquila' },
    });
    expect(await service.activity(quiet, roleB(admin, [quiet]))).toEqual({
      items: [],
    });
    await expect(
      service.activity(estate, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('EstateDashboardService.properties', () => {
  let estate: string;
  let propsUser: AuthenticatedUser;
  const ownerIds: string[] = [];
  const ids: Record<string, string> = {};

  async function property(ref: string, createdAt: Date, quota = '100.00') {
    const id = await createProperty(prisma, estate, {
      ref,
      quotaMonthly: quota,
    });
    await prisma.property.update({ where: { id }, data: { createdAt } });
    ids[ref] = id;
    return id;
  }

  beforeAll(async () => {
    estate = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: new Date(Date.UTC(2023, 0, 1)),
      estate: { name: 'Finca de prueba — propiedades' },
    });
    propsUser = roleB(admin, [estate]);
    const at = (day: number) => new Date(Date.UTC(2026, 0, day));

    await property('P1', at(1));
    await property('P2', at(2), '120.50');
    await property('P3', at(3));
    await property('P4', at(4));
    await property('P5', at(5));
    await property('P6', at(6));
    await property('P7', at(7)); // la más reciente

    // Titular con cuenta en P7 y titular importado (sin cuenta) en P6.
    const ownerId = await createOwnerUser(prisma, {
      fullName: 'Marta Soler Giménez',
    });
    ownerIds.push(ownerId);
    await prisma.propertyMembership.create({
      data: {
        propertyId: ids.P7,
        userId: ownerId,
        roleType: 'Propietario',
        status: 'linked',
        isPrimaryContact: true,
        linkedAt: new Date(Date.UTC(2022, 2, 14, 10)),
      },
    });
    await prisma.externalOwner.create({
      data: {
        propertyId: ids.P6,
        fullName: 'Inmobiliaria Turia S.L.',
        roleType: 'Propietario',
        createdByUserId: admin.userId,
      },
    });

    // P7 debe 80 € (con deuda); P6 tiene una incidencia abierta Y deuda (gana la incidencia); P5 al día con una incidencia resuelta.
    await issueTestReceipt(prisma, {
      estateId: estate,
      propertyId: ids.P7,
      periodKey: '2024-01',
      amount: '80.00',
      status: 'Pendiente',
    });
    await issueTestReceipt(prisma, {
      estateId: estate,
      propertyId: ids.P6,
      periodKey: '2024-01',
      amount: '50.00',
      status: 'Devuelto',
    });
    await issueTestReceipt(prisma, {
      estateId: estate,
      propertyId: ids.P5,
      periodKey: '2024-01',
      amount: '60.00',
      status: 'Pagada',
    });
    let n = 0;
    const issue = (propertyId: string, status: 'Abierta' | 'Resuelta') =>
      prisma.issue.create({
        data: {
          ref: `PRP-${Date.now()}-${n++}`,
          estateId: estate,
          type: 'Fuga',
          title: 'x',
          description: 'x',
          status,
          priority: 'Normal',
          source: 'Comunidad',
          date: new Date(),
        },
      });
    await issue(ids.P6, 'Abierta');
    await issue(ids.P5, 'Resuelta');
  });

  afterAll(async () => {
    await prisma.propertyMembership.deleteMany({
      where: { propertyId: { in: Object.values(ids) } },
    });
    await prisma.externalOwner.deleteMany({
      where: { propertyId: { in: Object.values(ids) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
  });

  it('devuelve las 5 propiedades más recientes y el total de la finca', async () => {
    const out = await service.properties(estate, propsUser);
    expect(out.total).toBe(7);
    expect(out.items.map((i) => i.ref)).toEqual(['P7', 'P6', 'P5', 'P4', 'P3']);
  });

  it('muestra el titular con cuenta, o el importado si no tiene, o null', async () => {
    const out = await service.properties(estate, propsUser, 7);
    const titular = (ref: string) =>
      out.items.find((i) => i.ref === ref)!.titular;
    expect(titular('P7')).toBe('Marta Soler Giménez');
    expect(titular('P6')).toBe('Inmobiliaria Turia S.L.');
    expect(titular('P5')).toBeNull();
  });

  it('cuota mensual y saldo pendiente salen de la propiedad y de sus recibos abiertos', async () => {
    const out = await service.properties(estate, propsUser, 7);
    const by = (ref: string) => out.items.find((i) => i.ref === ref)!;
    expect(by('P2').quotaMonthly).toBe(120.5);
    expect(by('P7').balance).toBe(80);
    expect(by('P6').balance).toBe(50); // devuelto sigue debiéndose
    expect(by('P5').balance).toBe(0); // cobrado
  });

  it('el estado depende solo de la deuda: las incidencias son de la comunidad, no de una vivienda', async () => {
    const out = await service.properties(estate, propsUser, 7);
    const by = (ref: string) => out.items.find((i) => i.ref === ref)!;
    expect(by('P6')).toMatchObject({ status: 'overdue' }); // tiene deuda (y la comunidad tiene incidencias abiertas: no cuenta)
    expect(by('P7')).toMatchObject({ status: 'overdue' });
    expect(by('P5')).toMatchObject({ status: 'ok' });
    expect(by('P5')).not.toHaveProperty('openIssues');
  });

  it('propertyStatuses devuelve saldo y estado de TODAS las propiedades de la finca (sin incidencias)', async () => {
    const out = await service.propertyStatuses(estate, propsUser);
    expect(out.items).toHaveLength(7);
    const by = (ref: string) =>
      out.items.find((i) => i.propertyId === ids[ref])!;
    expect(by('P7')).toMatchObject({
      propertyId: ids.P7,
      balance: 80,
      status: 'overdue',
    });
    expect(by('P6')).toMatchObject({
      propertyId: ids.P6,
      balance: 50,
      status: 'overdue',
    });
    expect(by('P5')).toMatchObject({
      propertyId: ids.P5,
      balance: 0,
      status: 'ok',
    });
    expect(by('P5')).not.toHaveProperty('openIssues');
  });

  it('propertyStatuses incluye el último pago (fecha del último cobro no deshecho) y desde cuándo es titular', async () => {
    const out = await service.propertyStatuses(estate, propsUser);
    const by = (ref: string) =>
      out.items.find((i) => i.propertyId === ids[ref])!;
    expect(by('P5').lastPaymentDate).toBe('2024-01-01'); // recibo cobrado
    expect(by('P7').lastPaymentDate).toBeNull(); // pendiente: nunca ha pagado
    expect(by('P6').lastPaymentDate).toBeNull(); // devuelto: no cuenta como pago
    expect(by('P7').ownerSince).toBe('2022-03-14');
    expect(by('P6').ownerSince).toBeNull(); // titular importado, sin cuenta: no hay fecha de alta
    expect(by('P5').ownerSince).toBeNull();
  });

  it('propertyStatuses se queda con el cobro más reciente y ignora los deshechos', async () => {
    const p8 = await property('P8', new Date(Date.UTC(2026, 0, 8)));
    await issueTestReceipt(prisma, {
      estateId: estate,
      propertyId: p8,
      periodKey: '2024-01',
      amount: '40.00',
      status: 'Pagada',
    });
    await issueTestReceipt(prisma, {
      estateId: estate,
      propertyId: p8,
      periodKey: '2024-02',
      amount: '40.00',
      status: 'Pagada',
    });
    const find = async () =>
      (await service.propertyStatuses(estate, propsUser)).items.find(
        (i) => i.propertyId === p8,
      )!;
    expect((await find()).lastPaymentDate).toBe('2024-02-01');

    const latest = (
      await prisma.collection.findMany({
        where: { propertyId: p8 },
        orderBy: { date: 'desc' },
      })
    )[0];
    const journal = new JournalService();
    const collections = new CollectionPostingService(
      journal,
      new ReceiptPostingService(journal),
    );
    await prisma.$transaction((tx) =>
      collections.undo(tx, latest.id, { reason: 'prueba' }),
    );
    expect((await find()).lastPaymentDate).toBe('2024-01-01'); // el cobro deshecho ya no cuenta
  });

  it('respeta el límite, lo valida, y protege el acceso a la finca', async () => {
    expect((await service.properties(estate, propsUser, 2)).items).toHaveLength(
      2,
    );
    await expect(
      service.properties(estate, propsUser, 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.properties(estate, propsUser, 21),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.properties(estate, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
