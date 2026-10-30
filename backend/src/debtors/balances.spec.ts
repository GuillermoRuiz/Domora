import { ForbiddenException, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { AuditService } from '../gdpr/audit.service';
import { DebtorsService } from './debtors.service';
import { DebtorBalancesExcelService } from './debtor-balances-excel.service';
import { PropertiesService } from '../properties/properties.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JournalService } from '../ledger/journal/journal.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * `computeBalances`/`computePropertyBalance` reemplazan a la tabla
 * `Debtor` como fuente del "saldo por vecino" (tarea 12 del tracker) —
 * el saldo real se recalcula en vivo sumando `AccountingReceipt`
 * Pendiente/Devuelto para CADA propiedad de la finca, tenga o no fila en
 * `Debtor` todavía. Integración contra Postgres real, mismo criterio que
 * `debt-certificate.spec.ts`: es exactamente el tipo de agregación que un
 * mock no verifica de verdad.
 *
 * Cada test crea sus propias propiedades y solo mira sus filas, así que no
 * hace falta limpiar entre tests: la gestora entera se purga al final.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
const audit = new AuditService(prisma as unknown as PrismaService);
const balancesExcel = new DebtorBalancesExcelService();
const collectionPosting = new CollectionPostingService(
  new JournalService(),
  new ReceiptPostingService(new JournalService()),
);
const propertyAccess = new PropertyAccessService(
  prisma as unknown as PrismaService,
  estateAccess,
);
const service = new DebtorsService(
  prisma as unknown as PrismaService,
  estateAccess,
  audit,
  balancesExcel,
  collectionPosting,
  propertyAccess,
);
const propertiesService = new PropertiesService(
  prisma as unknown as PrismaService,
  estateAccess,
  service,
  // Esta suite solo lee saldos: no emite avisos.
  {} as NotificationsService,
  propertyAccess,
);

let admin: AdministratorFixture;
let estateId: string;
let user: AuthenticatedUser;
const ownerUserIds: string[] = [];

function makeProperty(opts: { ref?: string } = {}) {
  return createProperty(prisma, estateId, { staircase: '3', ref: opts.ref });
}

function makeReceipt(opts: {
  propertyId: string;
  amount: string;
  status: 'Pendiente' | 'Pagada' | 'Devuelto';
}) {
  return issueTestReceipt(prisma, { estateId, periodKey: '2099-07', ...opts });
}

async function makeDebtor(opts: {
  propertyId: string;
  amount: string;
  interest?: string;
  step?: string;
  monthsOverdue?: number;
}) {
  return prisma.debtor.create({
    data: {
      administratorId: admin.administratorId,
      estateId,
      propertyId: opts.propertyId,
      amount: opts.amount,
      interest: opts.interest ?? '0',
      monthsOverdue: opts.monthsOverdue ?? 1,
      oldest: '2099-07',
      step: opts.step ?? 'Aviso enviado',
    },
  });
}

async function makePrimaryContact(opts: {
  propertyId: string;
  fullName: string;
}) {
  const userId = await createOwnerUser(prisma, { fullName: opts.fullName });
  ownerUserIds.push(userId);
  await prisma.propertyMembership.create({
    data: {
      propertyId: opts.propertyId,
      userId,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (saldo)',
  });
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2099, 0, 1)),
    estate: { name: 'Finca de prueba — saldo por vecino' },
  });
  user = roleB(admin, [estateId]);
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId, ownerUserIds);
  await prisma.$disconnect();
});

describe('DebtorsService.computeBalances', () => {
  it('incluye a TODOS los vecinos de la finca, no solo a quien ya tiene fila en Debtor', async () => {
    const alDia = await makeProperty({ ref: 'AL-DIA' });
    const sinGestionar = await makeProperty({ ref: 'SIN-GESTIONAR' });
    await makeReceipt({
      propertyId: sinGestionar,
      amount: '80.00',
      status: 'Pendiente',
    });

    const rows = await service.computeBalances(estateId, user);
    const rowIds = rows.map((r) => r.propertyId);

    expect(rowIds).toContain(alDia);
    expect(rowIds).toContain(sinGestionar);

    const alDiaRow = rows.find((r) => r.propertyId === alDia)!;
    expect(alDiaRow.isUpToDate).toBe(true);
    expect(alDiaRow.balance.toString()).toBe('0');
    expect(alDiaRow.debtorId).toBeNull();

    const sinGestionarRow = rows.find((r) => r.propertyId === sinGestionar)!;
    expect(sinGestionarRow.isUpToDate).toBe(false);
    expect(sinGestionarRow.balance.toString()).toBe('80');
    expect(sinGestionarRow.debtorId).toBeNull();
    expect(sinGestionarRow.step).toBeNull();
  });

  it('el saldo es el principal de los recibos — Debtor.interest ya no se lee (fase 10: los intereses son un recibo real)', async () => {
    const prop = await makeProperty({ ref: 'CON-DEBTOR' });
    await makeReceipt({
      propertyId: prop,
      amount: '150.00',
      status: 'Pendiente',
    });
    await makeDebtor({
      propertyId: prop,
      amount: '150',
      interest: '9.25',
      step: 'En reclamación',
      monthsOverdue: 3,
    });

    const rows = await service.computeBalances(estateId, user);
    const row = rows.find((r) => r.propertyId === prop)!;

    expect(row.balance.toString()).toBe('150');
    expect(row.step).toBe('En reclamación');
    expect(row.monthsOverdue).toBe(3);
    expect(row.isUpToDate).toBe(false);
  });

  it('ignora los recibos Pagada — solo cuentan Pendiente y Devuelto', async () => {
    const prop = await makeProperty({ ref: 'PAGADA' });
    await makeReceipt({ propertyId: prop, amount: '999.00', status: 'Pagada' });

    const rows = await service.computeBalances(estateId, user);
    const row = rows.find((r) => r.propertyId === prop)!;

    expect(row.balance.toString()).toBe('0');
    expect(row.isUpToDate).toBe(true);
  });

  it('expone al titular principal de la propiedad (nombre/email)', async () => {
    const prop = await makeProperty({ ref: 'CON-TITULAR' });
    await makePrimaryContact({ propertyId: prop, fullName: 'Ana Propietaria' });

    const rows = await service.computeBalances(estateId, user);
    const row = rows.find((r) => r.propertyId === prop)!;

    expect(row.titular).toBe('Ana Propietaria');
  });

  it('ordena de mayor a menor deuda', async () => {
    const baja = await makeProperty({ ref: 'BAJA' });
    const alta = await makeProperty({ ref: 'ALTA' });
    await makeReceipt({
      propertyId: baja,
      amount: '30.00',
      status: 'Pendiente',
    });
    await makeReceipt({
      propertyId: alta,
      amount: '500.00',
      status: 'Pendiente',
    });

    const rows = await service.computeBalances(estateId, user);
    const idxAlta = rows.findIndex((r) => r.propertyId === alta);
    const idxBaja = rows.findIndex((r) => r.propertyId === baja);

    expect(idxAlta).toBeLessThan(idxBaja);
  });

  it('un anticipo sin aplicar viaja en "advance", separado de "balance" (no se resta)', async () => {
    const prop = await makeProperty({ ref: 'ANTICIPO' });
    // Cobro de 120€ sin ningún recibo abierto en ese momento: todo queda
    // como anticipo (430 acreedora sin recibo).
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId,
        propertyId: prop,
        date: new Date(Date.UTC(2099, 6, 1)),
        amount: 12000,
        method: 'Transferencia',
      }),
    );
    // Un recibo posterior no se paga solo con el anticipo: aplicarlo es una
    // acción explícita (`POST advances/apply`), así que sigue Pendiente.
    await makeReceipt({
      propertyId: prop,
      amount: '80.00',
      status: 'Pendiente',
    });

    const rows = await service.computeBalances(estateId, user);
    const row = rows.find((r) => r.propertyId === prop)!;

    expect(row.balance.toNumber()).toBe(80);
    expect(row.advance.toNumber()).toBe(120);
  });

  it('deniega el acceso a una finca fuera del scope del usuario', async () => {
    const outsider = roleB(admin, ['00000000-0000-0000-0000-000000000000']);
    await expect(service.computeBalances(estateId, outsider)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('deja rastro de auditoría del listado', async () => {
    await service.computeBalances(estateId, user);
    const log = await prisma.dataAccessLog.findFirst({
      where: {
        actorUserId: admin.userId,
        resource: 'debtors',
        action: 'list',
        resourceId: estateId,
      },
      orderBy: { id: 'desc' },
    });
    expect(log).not.toBeNull();
  });
});

describe('DebtorsService.listDebtorsByEstate — titular', () => {
  // `Debtor` no tiene columna `name`: el frontend esperaba ese campo (y lo
  // recibía siempre `undefined`) hasta que se añadió este enriquecimiento.
  it('resuelve el nombre del primary contact de la propiedad del deudor', async () => {
    const prop = await makeProperty({ ref: 'TITULAR-DEBTOR' });
    await makeDebtor({ propertyId: prop, amount: '90' });
    await makePrimaryContact({ propertyId: prop, fullName: 'Carlos Titular' });

    const rows = await service.listDebtorsByEstate(estateId, user);
    const row = rows.find((r) => r.propertyId === prop)!;

    expect(row.titular).toBe('Carlos Titular');
  });

  it('sin titular vinculado, devuelve null en vez de reventar', async () => {
    const prop = await makeProperty({ ref: 'SIN-TITULAR' });
    await makeDebtor({ propertyId: prop, amount: '50' });

    const rows = await service.listDebtorsByEstate(estateId, user);
    const row = rows.find((r) => r.propertyId === prop)!;

    expect(row.titular).toBeNull();
  });
});

describe('DebtorsService.computePropertyBalance', () => {
  it('devuelve 0 cuando la propiedad está al día', async () => {
    const prop = await makeProperty();
    expect(await service.computePropertyBalance(prop)).toBe(0);
  });

  it('devuelve el saldo EN NEGATIVO cuando hay deuda (convención "saldo de cuenta")', async () => {
    const prop = await makeProperty();
    await makeReceipt({
      propertyId: prop,
      amount: '75.50',
      status: 'Pendiente',
    });

    expect(await service.computePropertyBalance(prop)).toBe(-75.5);
  });
});

describe('PropertiesService.findById — balance calculado', () => {
  it('devuelve balance negativo reflejando la deuda real, no un campo fijo', async () => {
    const prop = await makeProperty();
    await makeReceipt({
      propertyId: prop,
      amount: '42.00',
      status: 'Pendiente',
    });

    const result = await propertiesService.findById(prop, user);
    expect(result.balance).toBe(-42);
  });
});

describe('DebtorsService.generateBalancesExcelFile', () => {
  it('genera un .xlsx real y legible con las filas de la finca', async () => {
    const prop = await makeProperty({ ref: 'XLSX-1' });
    await makeReceipt({
      propertyId: prop,
      amount: '60.00',
      status: 'Pendiente',
    });

    const { fileName, content } = await service.generateBalancesExcelFile(
      estateId,
      user,
    );

    expect(fileName).toMatch(/\.xlsx$/);
    expect(content.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Saldo por vecino');
    expect(sheet).toBeDefined();

    const headerRow = sheet!.getRow(3).values as unknown[];
    expect(headerRow).toContain('Propiedad');
    expect(headerRow).toContain('Saldo');

    const dataRowCount = sheet!.rowCount - 3;
    const rows = await service.computeBalances(estateId, user);
    expect(dataRowCount).toBe(rows.length);
  });

  it('deja rastro de auditoría de la exportación, distinto del listado simple', async () => {
    await service.generateBalancesExcelFile(estateId, user);
    const log = await prisma.dataAccessLog.findFirst({
      where: {
        actorUserId: admin.userId,
        resource: 'debtors',
        action: 'export',
        resourceId: estateId,
      },
      orderBy: { id: 'desc' },
    });
    expect(log).not.toBeNull();
  });

  it('finca inexistente lanza NotFoundException', async () => {
    await expect(
      service.generateBalancesExcelFile(
        '00000000-0000-0000-0000-000000000000',
        roleB(admin, ['00000000-0000-0000-0000-000000000000']),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
