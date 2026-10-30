import { ForbiddenException } from '@nestjs/common';
import { EstateOverviewService } from './estate-overview.service';
import { EstateOverviewExcelService } from './estate-overview-excel.service';
import ExcelJS from 'exceljs';
import { EstateOverviewQueryDto } from './dto/estate-overview.dto';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { AccountingService } from '../accounting/accounting.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import {
  createAdministrator,
  createLedgerEstate,
  createEstate,
  createProperty,
  createOwnerUser,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import type { PrismaService } from '../prisma/prisma.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

jest.setTimeout(120_000);
const db = createPrismaClient();
const prisma = db as unknown as PrismaService;
const service = new EstateOverviewService(
  prisma,
  new LedgerQueryService(prisma),
);
let admin: AdministratorFixture;
let other: AdministratorFixture;
let a: string;
let b: string;
let alien: string;
let deleted: string;
const users: string[] = [];
const query = (patch = {}) =>
  Object.assign(new EstateOverviewQueryDto(), patch);
const manager = () => roleB(admin, [a, b, alien, deleted]);

beforeAll(async () => {
  admin = await createAdministrator(db);
  other = await createAdministrator(db);
  a = await createLedgerEstate(db, admin.administratorId, {
    cutoverDate: new Date('2026-01-01'),
    estate: { name: 'Zulu', address: 'Gran Vía', streetNumber: '12' },
  });
  b = await createLedgerEstate(db, admin.administratorId, {
    estate: { name: 'Alameda', type: 'Garaje' },
  });
  alien = await createEstate(db, other.administratorId, { name: 'Ajena' });
  deleted = await createEstate(db, admin.administratorId, {
    name: 'Borrada',
    deletedAt: new Date(),
  });
  const p1 = await createProperty(db, a);
  const p2 = await createProperty(db, a);
  const deletedProperty = await createProperty(db, a, {
    deletedAt: new Date(),
  });
  const owner = await createOwnerUser(db, { fullName: 'María Sol' });
  const tenant = await createOwnerUser(db, { fullName: 'Inquilino' });
  const removed = await createOwnerUser(db, { fullName: 'Borrado' });
  users.push(owner, tenant, removed);
  await db.user.update({
    where: { id: owner },
    data: { taxIdCountry: 'ES', taxId: '12345678Z' },
  });
  await db.user.update({
    where: { id: removed },
    data: { deletedAt: new Date() },
  });
  await db.propertyMembership.createMany({
    data: [
      {
        propertyId: p1,
        userId: owner,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
      {
        propertyId: p2,
        userId: owner,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
      {
        propertyId: p1,
        userId: tenant,
        roleType: 'Inquilino',
        status: 'linked',
        linkedAt: new Date(),
      },
      {
        propertyId: p2,
        userId: removed,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    ],
  });
  await db.externalOwner.createMany({
    data: [
      {
        propertyId: p1,
        fullName: 'Duplicado fiscal',
        taxIdCountry: 'ES',
        taxId: '12.345.678-Z',
        createdByUserId: admin.userId,
      },
      {
        propertyId: p1,
        fullName: 'Titular sin cuenta',
        createdByUserId: admin.userId,
      },
      {
        propertyId: p2,
        fullName: 'Promovido',
        promotedToUserId: owner,
        createdByUserId: admin.userId,
      },
      {
        propertyId: deletedProperty,
        fullName: 'Propiedad borrada',
        createdByUserId: admin.userId,
      },
    ],
  });
  const periodKey = '2026-01';
  await issueTestReceipt(db, {
    estateId: a,
    propertyId: p1,
    periodKey,
    amount: '100',
    kind: 'cuota_ordinaria',
  });
  await issueTestReceipt(db, {
    estateId: a,
    propertyId: p1,
    periodKey,
    amount: '200',
    kind: 'derrama',
  });
  await issueTestReceipt(db, {
    estateId: a,
    propertyId: p1,
    periodKey,
    amount: '90',
    status: 'Pagada',
  });
  await db.issue.createMany({
    data: [
      {
        estateId: a,
        ref: `ACTIVE-${a.slice(0, 8)}`,
        type: 'Averia',
        title: 'Ascensor parado',
        description: 'Motor dañado',
        status: 'Abierta',
        priority: 'Normal',
        source: 'Propietario',
        date: new Date(),
      },
      {
        estateId: a,
        ref: `CLOSED-${a.slice(0, 8)}`,
        type: 'Averia',
        title: 'Histórica',
        description: '',
        status: 'Cerrada',
        priority: 'Normal',
        source: 'Propietario',
        date: new Date(),
      },
    ],
  });
  await db.adhesionRequest.create({
    data: {
      estateId: a,
      propertyId: p1,
      userId: tenant,
      roleType: 'Propietario',
      status: 'pending',
      submittedAt: new Date(),
    },
  });
});

afterAll(async () => {
  if (admin) {
    await db.adhesionRequest.deleteMany({
      where: { estate: { administratorId: admin.administratorId } },
    });
    await db.issue.deleteMany({
      where: {
        estate: { administratorId: admin.administratorId },
      },
    });
    await purgeAdministrator(db, admin.administratorId);
  }
  if (other) await purgeAdministrator(db, other.administratorId);
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

it('tenant/gestora/soft-delete excluyen fincas ajenas aun si llegan en estateIds; C no ve finanzas', async () => {
  expect(
    (await service.overview(query(), manager())).items
      .map((item) => item.id)
      .sort(),
  ).toEqual([a, b].sort());
  await expect(
    service.overview(query(), { ...manager(), role: 'C' }),
  ).rejects.toThrow(ForbiddenException);
  expect(
    (await service.overview(query(), { ...manager(), estateIds: [] })).total,
  ).toBe(0);
});
it('agregados reales: propietarios, incidencias, adhesiones y cuotas ordinarias', async () => {
  const result = await service.overview(query(), manager());
  expect(result.items.find((item) => item.id === a)).toEqual(
    expect.objectContaining({
      ownersCount: 2,
      activeIssues: 1,
      pendingRequests: 1,
      pendingAmount: '100.00',
      balance: '90.00',
    }),
  );
  expect(result.summary.properties).toBe(2);
});
it('balance coincide exactamente con accounting/summary', async () => {
  const accounting = new AccountingService(
    prisma,
    new EstateAccessService(),
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const summary = await accounting.summary(a, manager());
  const result = await service.overview(query({ search: 'zulu' }), manager());
  expect(result.items[0].balance).toBe(summary.balance.toFixed(2));
  expect(summary.delinquency.toFixed(2)).toBe('300.00');
});
it('Excel exporta todos los tipos seleccionados con las mismas finanzas y alcance que el listado', async () => {
  const filters = query({ types: ['Edificio', 'Garaje'], pageSize: 1 });
  const page = await service.overview(filters, manager());
  expect(page.items).toHaveLength(1);
  const file = await new EstateOverviewExcelService(service).generate(
    filters,
    manager(),
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.content as any);
  const sheet = workbook.worksheets[0];
  expect(sheet.rowCount).toBe(3);
  expect(sheet.getRow(2).getCell(1).value).toBe('Alameda');
  expect(sheet.getRow(3).values).toEqual([
    undefined,
    'Zulu',
    'Gran Vía 12, Madrid',
    2,
    1,
    90,
    100,
  ]);
});
it.each(['ownersCount', 'balance', 'activeIssues', 'pendingAmount'])(
  'sorting %s antes de paginar',
  async (sort) => {
    const result = await service.overview(
      query({ sort, direction: 'desc', pageSize: 1, page: 1 }),
      manager(),
    );
    expect(result.items[0].id).toBe(a);
    expect(result.totalPages).toBe(2);
    expect(
      (
        await service.overview(
          query({ sort, direction: 'desc', pageSize: 1, page: 2 }),
          manager(),
        )
      ).items[0].id,
    ).toBe(b);
  },
);
it('sorting por nombre, búsqueda local, filtros y tipo', async () => {
  expect((await service.overview(query(), manager())).items[0].id).toBe(b);
  expect(
    (await service.overview(query({ search: 'gran via 12' }), manager()))
      .items[0].id,
  ).toBe(a);
  for (const filter of ['issues', 'pending', 'requests'])
    expect(
      (await service.overview(query({ filter }), manager())).items.map(
        (item) => item.id,
      ),
    ).toEqual([a]);
  expect(
    (await service.overview(query({ types: ['Garaje'] }), manager())).items[0]
      .id,
  ).toBe(b);
});
it('búsqueda superior real por nombre de propietario y descripción de incidencia, limitada y scoped', async () => {
  expect((await service.search('María', manager()))[0]).toEqual(
    expect.objectContaining({ kind: 'owner', label: 'María Sol', estateId: a }),
  );
  expect((await service.search('Motor', manager()))[0]).toEqual(
    expect.objectContaining({
      kind: 'issue',
      label: 'Ascensor parado',
      estateId: a,
    }),
  );
  expect(await service.search('Ajena', manager())).toEqual([]);
  expect(await service.search('12345678Z', manager())).toEqual([]);
});
