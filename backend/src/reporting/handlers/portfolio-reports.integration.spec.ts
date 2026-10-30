import type { PrismaService } from '../../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { LedgerQueryService } from '../../ledger/ledger-query.service';
import { EstateOverviewService } from '../../estates/estate-overview.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import { PortfolioReportsService } from './portfolio-reports.service';
import type { ReportScope } from '../reporting.types';
import { createPrismaClient } from '../../prisma/create-prisma-client';

jest.setTimeout(120000);
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const service = new PortfolioReportsService(
  db,
  new EstateOverviewService(db, new LedgerQueryService(db)),
  {} as MeetingsService,
);
const D = (value: string) => new Date(`${value}T00:00:00Z`);
let admin: AdministratorFixture;
let scope: ReportScope;
let estate: string;
const people: string[] = [];
beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Reporting portfolio integration',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  scope = {
    administratorId: admin.administratorId,
    user: roleB(admin, [estate]),
    mode: 'selected',
    estateIds: [estate],
    estates: [{ id: estate, name: 'Fixture' }],
  };
  const propertyA = await createProperty(prisma, estate, {
    ref: 'A',
    participationQuota: '50',
  });
  const propertyB = await createProperty(prisma, estate, {
    ref: 'B',
    participationQuota: '50',
  });
  const first = await createOwnerUser(prisma, { fullName: 'Mismo nombre' });
  const second = await createOwnerUser(prisma, { fullName: 'Mismo nombre' });
  people.push(first, second);
  await prisma.propertyMembership.createMany({
    data: [
      {
        propertyId: propertyA,
        userId: first,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: D('2026-01-01'),
      },
      {
        propertyId: propertyB,
        userId: first,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: D('2026-01-01'),
      },
      {
        propertyId: propertyA,
        userId: second,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: D('2026-01-01'),
      },
    ],
  });
  await prisma.externalOwner.createMany({
    data: [
      {
        propertyId: propertyA,
        fullName: 'Titular externo',
        taxIdCountry: 'ES',
        taxId: '12345678Z',
        roleType: 'Propietario',
        createdByUserId: admin.userId,
      },
      {
        propertyId: propertyB,
        fullName: 'Titular externo',
        taxIdCountry: 'ES',
        taxId: '12.345.678-Z',
        roleType: 'Propietario',
        createdByUserId: admin.userId,
      },
      {
        propertyId: propertyA,
        fullName: 'Sin identidad',
        roleType: 'Propietario',
        createdByUserId: admin.userId,
      },
      {
        propertyId: propertyB,
        fullName: 'Sin identidad',
        roleType: 'Propietario',
        createdByUserId: admin.userId,
      },
    ],
  });
  await prisma.estateOfficeTerm.createMany({
    data: [
      {
        estateId: estate,
        role: 'PRESIDENT',
        propertyId: propertyA,
        userId: first,
        holderNameSnapshot: 'Nombre al nombramiento',
        startsAt: D('2026-01-01'),
        endsAt: D('2026-07-01'),
        createdByUserId: admin.userId,
      },
      {
        estateId: estate,
        role: 'PRESIDENT',
        propertyId: propertyB,
        userId: second,
        holderNameSnapshot: 'Sustituto',
        startsAt: D('2026-07-01'),
        createdByUserId: admin.userId,
      },
    ],
  });
});
afterAll(async () => {
  if (admin) {
    await prisma.estateOfficeTerm.deleteMany({ where: { estateId: estate } });
    await purgeAdministrator(prisma, admin.administratorId);
  }
  await prisma.user.deleteMany({ where: { id: { in: people } } });
  await prisma.$disconnect();
});

it('deduplicates by User.id or checked fiscal identity, never namesakes', async () => {
  const report = await service.run('owners', { scopeMode: 'selected' }, scope);
  expect(report.sections[0].rows).toHaveLength(5);
  expect(
    report.sections[0].rows.filter((r) => r.name === 'Mismo nombre'),
  ).toHaveLength(2);
  expect(
    report.sections[0].rows.filter((r) => r.name === 'Sin identidad'),
  ).toHaveLength(2);
  const coefficients = await service.run(
    'owners-coefficients',
    { scopeMode: 'selected' },
    scope,
  );
  expect(coefficients.sections[0].rows).toHaveLength(2);
  expect(coefficients.sections[0].rows.map((r) => r.quota)).toEqual([
    '50',
    '50',
  ]);
});
it('selects the registered president at the cutoff with immutable appointment name', async () => {
  const before = await service.run(
    'presidents',
    { scopeMode: 'selected', asOf: '2026-06-30' },
    scope,
  );
  expect(before.sections[0].rows).toEqual([
    expect.objectContaining({
      holder: 'Nombre al nombramiento',
      property: 'A',
    }),
  ]);
  const after = await service.run(
    'presidents',
    { scopeMode: 'selected', asOf: '2026-07-01' },
    scope,
  );
  expect(after.sections[0].rows).toEqual([
    expect.objectContaining({ holder: 'Sustituto', property: 'B' }),
  ]);
});
it('reuses the complete overview, with explicit current ordinary-fee semantics', async () => {
  const report = await service.run(
    'portfolio-summary',
    { scopeMode: 'selected' },
    scope,
  );
  expect(report.summary).toContainEqual({
    label: 'Propiedades',
    value: 2,
    format: 'number',
  });
  expect(report.warnings?.join(' ')).toMatch(/únicamente cuotas ordinarias/);
});
