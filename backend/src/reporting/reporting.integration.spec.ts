import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { Prisma } from '../prisma/client';
import { AppModule } from '../app.module';
import { ReportingService } from './reporting.service';
import { REPORT_CATALOG } from './definitions/report-catalog';
import { LedgerReportsService } from '../ledger/reports/ledger-reports.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

jest.setTimeout(180000);
const prisma = createPrismaClient();
let app: INestApplication;
let first: AdministratorFixture;
let second: AdministratorFixture;
let own: string;
let foreign: string;
let token: string;
const input = {
  scopeMode: 'selected',
  from: '2025-01-01',
  to: '2025-12-31',
  asOf: '2025-12-31',
  fiscalYear: 2025,
  quarter: 1,
};
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  first = await createAdministrator(prisma);
  second = await createAdministrator(prisma);
  own = await createLedgerEstate(prisma, first.administratorId, {
    cutoverDate: new Date('2024-01-01T00:00:00Z'),
    estate: { name: '=HYPERLINK("x")' },
  });
  foreign = await createLedgerEstate(prisma, second.administratorId, {
    cutoverDate: new Date('2024-01-01T00:00:00Z'),
    estate: { name: 'Comunidad ajena' },
  });
  const property = await createProperty(prisma, own);
  await issueTestReceipt(prisma, {
    estateId: own,
    propertyId: property,
    periodKey: '2025-03',
    amount: '1000',
  });
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  // Deliberately false tenant/estate claims: fresh DB resolution is the security boundary.
  token = app
    .get(JwtService)
    .sign({
      sub: first.userId,
      role: 'B',
      administratorId: second.administratorId,
      estateIds: [foreign],
    });
});

afterAll(async () => {
  await app?.close();
  if (first && second) {
    await prisma.reportSnapshot.deleteMany({
      where: {
        administratorId: {
          in: [first.administratorId, second.administratorId],
        },
      },
    });
    await prisma.dataAccessLog.deleteMany({
      where: { actorUserId: { in: [first.userId, second.userId] } },
    });
    await purgeAdministrator(prisma, first.administratorId);
    await purgeAdministrator(prisma, second.administratorId);
  }
  await prisma.$disconnect();
});

describe('Reporting real API isolation and exports', () => {
  it('shows only the real current tenant despite stale signed claims', async () => {
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/reports/catalog')
      .set(auth())
      .expect(200);
    expect(catalog.body.reports).toHaveLength(47);
    const estates = await request(app.getHttpServer())
      .get('/api/v1/reports/estates')
      .set(auth())
      .expect(200);
    expect(estates.body.map((e: { id: string }) => e.id)).toEqual([own]);
    const result = await request(app.getHttpServer())
      .post('/api/v1/reports/communities/query')
      .set(auth())
      .send({ scopeMode: 'all', filters: {} })
      .expect(200);
    expect(
      result.body.metadata.scope.estates.map((e: { id: string }) => e.id),
    ).toEqual([own]);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'rejects foreign or mixed query/export scope (%s,%s)',
    async (mixed, exporting) => {
      await request(app.getHttpServer())
        .post(`/api/v1/reports/communities/${exporting ? 'export' : 'query'}`)
        .set(auth())
        .send({
          scopeMode: 'selected',
          estateIds: mixed ? [own, foreign] : [foreign],
          ...(exporting ? { format: 'xlsx' } : {}),
        })
        .expect(403);
    },
  );
  it('rejects nonexistent UUID, unknown report, unlisted fields and owner/platform roles', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/reports/communities/query')
      .set(auth())
      .send({
        scopeMode: 'selected',
        estateIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/reports/sla-breaches/query')
      .set(auth())
      .send({ scopeMode: 'all' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/reports/communities/query')
      .set(auth())
      .send({ scopeMode: 'all', administratorId: second.administratorId })
      .expect(400);
    for (const role of ['A', 'C']) {
      const denied = app
        .get(JwtService)
        .sign({
          sub: first.userId,
          role,
          administratorId: first.administratorId,
          estateIds: [own],
        });
      await request(app.getHttpServer())
        .get('/api/v1/reports/catalog')
        .set('Authorization', `Bearer ${denied}`)
        .expect(403);
    }
  });
  it('reauthorizes export after the user is moved to another tenant', async () => {
    await prisma.user.update({
      where: { id: first.userId },
      data: { administratorId: second.administratorId },
    });
    try {
      await request(app.getHttpServer())
        .post('/api/v1/reports/communities/export')
        .set(auth())
        .send({ scopeMode: 'selected', estateIds: [own], format: 'pdf' })
        .expect(403);
    } finally {
      await prisma.user.update({
        where: { id: first.userId },
        data: { administratorId: first.administratorId },
      });
    }
  });
  it('exports the same rows as preview, valid XLSX/PDF with safe names and no formulas', async () => {
    const preview = await request(app.getHttpServer())
      .post('/api/v1/reports/communities/query')
      .set(auth())
      .send({ scopeMode: 'selected', estateIds: [own] })
      .expect(200);
    const xlsx = await request(app.getHttpServer())
      .post('/api/v1/reports/communities/export')
      .set(auth())
      .send({ scopeMode: 'selected', estateIds: [own], format: 'xlsx' })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(xlsx.headers['content-disposition']).toMatch(
      /^attachment; filename="domora-communities-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(xlsx.headers['cache-control']).toBe('no-store');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body);
    const cells: unknown[] = [];
    workbook.eachSheet((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
          cells.push(cell.value);
        }),
      ),
    );
    expect(cells).toContain(preview.body.sections[0].rows[0].name);
    const pdf = await request(app.getHttpServer())
      .post('/api/v1/reports/communities/export')
      .set(auth())
      .send({ scopeMode: 'selected', estateIds: [own], format: 'pdf' })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const event = await prisma.dataAccessLog.findFirstOrThrow({
      where: {
        actorUserId: first.userId,
        resource: 'reports',
        action: 'EXPORT',
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(event.metadata).toMatchObject({
      reportKey: 'communities',
      outcome: 'SUCCESS',
      estateCount: 1,
      rowCount: 1,
    });
    expect(JSON.stringify(event.metadata)).not.toContain('HYPERLINK');
    expect(JSON.stringify(event.metadata)).not.toContain('Comunidad ajena');
  });
  it('connects every available report to a real handler', async () => {
    const service = app.get(ReportingService);
    for (const definition of REPORT_CATALOG.filter(
      (r) => r.status === 'available',
    )) {
      const dto = {
        ...input,
        estateIds: [own],
        compareFrom: '2024-01-01',
        compareTo: '2024-12-31',
        ...(definition.key === 'monthly-executive'
          ? { from: '2025-03-01', to: '2025-03-31' }
          : {}),
        filters: Object.fromEntries(
          definition.filters
            .map((filter) => [
              filter,
              filter === 'accountCode'
                ? '430'
                : filter === 'assignmentMode'
                  ? 'current'
                  : filter === 'spendBasis'
                    ? 'invoiced'
                    : filter === 'days'
                      ? 30
                      : undefined,
            ])
            .filter(([, value]) => value !== undefined),
        ),
      } as Parameters<ReportingService['execute']>[1];
      const { result } = await service.execute(
        definition.key,
        dto,
        roleB(first, []),
      );
      expect(result.metadata.reportKey).toBe(definition.key);
      expect(Array.isArray(result.sections)).toBe(true);
      for (const format of definition.formats) {
        const exported = await service.execute(definition.key, dto, roleB(first, []), format, result.metadata.snapshotId);
        expect(exported.result.sections).toEqual(result.sections);
        expect(exported.result.summary).toEqual(result.summary);
        expect(exported.document!.content.subarray(0, format === 'pdf' ? 5 : 2).toString()).toBe(format === 'pdf' ? '%PDF-' : 'PK');
      }
    }
  });
  it('matches existing accounting balance and trial totals without frontend arithmetic', async () => {
    const actor = roleB(first, [own]);
    const existing = await app
      .get(LedgerReportsService)
      .trialBalance(own, 2025, actor);
    const center = await app
      .get(ReportingService)
      .execute(
        'trial-balance',
        { scopeMode: 'selected', estateIds: [own], fiscalYear: 2025 },
        actor,
      );
    expect(center.result.sections[0].totals?.debit).toBe(existing.totalDebit);
    expect(center.result.sections[0].totals?.credit).toBe(existing.totalCredit);
    const figures = await app.get(LedgerQueryService).estateFigures(own, 2025);
    const result = await app
      .get(ReportingService)
      .execute(
        'income-expenses-summary',
        {
          scopeMode: 'selected',
          estateIds: [own],
          from: '2025-01-01',
          to: '2025-12-31',
        },
        actor,
      );
    expect(
      result.result.summary.find((s) => s.label === 'Ingresos por devengo')
        ?.value,
    ).toBe(figures.income.toNumber());
    expect(
      result.result.summary.find((s) => s.label === 'Gastos por devengo')
        ?.value,
    ).toBe(figures.expenses.toNumber());
  });
  it('persists composite versions, reproduces them after source changes and authorizes every export', async () => {
    const service = app.get(ReportingService);
    const actor = roleB(first, [own]);
    const query = {
      scopeMode: 'selected' as const,
      estateIds: [own],
      from: '2025-01-01',
      to: '2025-12-31',
    };
    const original = await service.execute('meeting-finance', query, actor);
    const id = original.result.metadata.snapshotId!;
    expect(id).toBeTruthy();
    const property = await prisma.property.findFirstOrThrow({
      where: { estateId: own },
    });
    await issueTestReceipt(prisma, {
      estateId: own,
      propertyId: property.id,
      periodKey: '2025-04',
      amount: '200',
    });
    const saved = await service.execute(
      'meeting-finance',
      query,
      actor,
      'xlsx',
      id,
    );
    expect(saved.result).toEqual(original.result);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      saved.document!.content as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0],
    );
    const values: unknown[] = [];
    workbook.eachSheet((sheet) =>
      sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value))),
    );
    expect(values).toContain('Resultado del periodo');
    expect(values).toContain(`Versión: ${id}`);
    const updated = await service.execute('meeting-finance', query, actor);
    expect(updated.result.metadata.snapshotId).not.toBe(id);
    expect(
      updated.result.summary.find((s) => s.label === 'Ingresos por devengo')!
        .value,
    ).toBe(1200);
    expect(
      original.result.summary.find((s) => s.label === 'Ingresos por devengo')!
        .value,
    ).toBe(1000);
    await request(app.getHttpServer())
      .post('/api/v1/reports/meeting-finance/export')
      .set(auth())
      .send({ ...query, to: '2025-11-30', format: 'xlsx', snapshotId: id })
      .expect(409);
    const otherToken = app
      .get(JwtService)
      .sign({
        sub: second.userId,
        role: 'B',
        administratorId: second.administratorId,
        estateIds: [foreign],
      });
    await request(app.getHttpServer())
      .post('/api/v1/reports/meeting-finance/export')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...query, estateIds: [foreign], format: 'pdf', snapshotId: id })
      .expect(403);
  });
});
