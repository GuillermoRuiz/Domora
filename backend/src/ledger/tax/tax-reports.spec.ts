import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import {
  renderReportPdf,
  renderReportXlsx,
} from '../../common/reports/table-report';
import { JournalService } from '../journal/journal.service';
import { parseLedgerDbError } from '../journal/journal-db-errors';
import { SupplierPostingService } from '../posting/supplier-posting.service';
import { PayrollPostingService } from '../posting/payroll-posting.service';
import { TaxSettlementPostingService } from '../posting/tax-settlement-posting.service';
import { InvariantsService } from '../invariants.service';
import { LedgerQueryService } from '../ledger-query.service';
import { TaxReportsService } from './tax-reports.service';
import { TaxSettlementsService } from './tax-settlements.service';
import { document111, document190, document347 } from './tax-report-documents';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Modelos 111, 190 y 347 (fase 7b) sobre un escenario con los importes
 * esperados calculados a mano:
 *
 * - Arquitectos (profesional): base 1.000 €, IVA 21 %, IRPF 15 % → a pagar
 *   1.060 €. Se paga 500 € el 20/03 (1T) y 560 € el 10/04 (2T): la
 *   retención se reparte 70,75 € + 79,25 € y la base 471,70 € + 528,30 €.
 * - Ascensores: dos facturas de 2.420 € (IVA incluido), febrero y mayo, sin
 *   retención → 4.840 € en el 347.
 * - Eléctrica (Suministros): 4.840 € → excluida por el art. 33.5 RGAT.
 * - Portero: nóminas de febrero y marzo (bruto 1.500 €, IRPF 150 €) pagadas
 *   el 01/03 y el 01/04; la de abril, sin pagar, no cuenta.
 */
jest.setTimeout(120_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const access = new EstateAccessService();
const journal = new JournalService();
const suppliers = new SupplierPostingService(journal);
const payroll = new PayrollPostingService(journal);
const reports = new TaxReportsService(db, access);
const settlements = new TaxSettlementsService(
  db,
  access,
  new TaxSettlementPostingService(journal),
);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;
let estateId: string;
let user: AuthenticatedUser;

async function balanceOf(code: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } } },
    _sum: { debit: true, credit: true },
  });
  return (agg._sum.debit ?? new Prisma.Decimal(0))
    .minus(agg._sum.credit ?? new Prisma.Decimal(0))
    .toFixed(2);
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (modelos fiscales)',
  });
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
    estate: { cif: 'H00000000' },
  });
  user = roleB(admin, [estateId]);
  const account = async (code: string) =>
    (await prisma.chartAccount.findFirstOrThrow({ where: { estateId, code } }))
      .id;

  const arq = await createSupplier(prisma, estateId, admin.administratorId, {
    name: 'Arquitectos Norte',
    taxId: 'B11111111',
    category: 'Administración',
  });
  const asc = await createSupplier(prisma, estateId, admin.administratorId, {
    name: 'Ascensores XYZ',
    taxId: 'B22222222',
    category: 'Mantenimiento',
  });
  const luz = await createSupplier(prisma, estateId, admin.administratorId, {
    name: 'Eléctrica',
    taxId: 'A33333333',
    category: 'Suministros',
    excludedFrom347: true,
  });
  const staff = await prisma.staffMember.create({
    data: {
      estateId,
      administratorId: admin.administratorId,
      fullName: 'Portero Pérez',
      position: 'Conserje',
      nationalId: '00000000T',
      contractType: 'Indefinido',
      startDate: D('2020-01-01'),
    },
  });

  await prisma.$transaction(async (tx) => {
    const line = async (code: string, base: number) => [
      { accountId: await account(code), base },
    ];
    await suppliers.registerInvoice(tx, {
      estateId,
      supplierId: arq,
      number: 'A-1',
      concept: 'Informe de fachada',
      issueDate: D('2026-03-01'),
      vatRatePct: 21,
      withholdingRatePct: 15,
      withholdingKey: 'G_profesional',
      lines: await line('623', 100000),
    });
    for (const [n, date] of [
      ['X-1', '2026-02-10'],
      ['X-2', '2026-05-10'],
    ]) {
      await suppliers.registerInvoice(tx, {
        estateId,
        supplierId: asc,
        number: n,
        concept: 'Mantenimiento',
        issueDate: D(date),
        vatRatePct: 21,
        withholdingRatePct: 0,
        lines: await line('622', 200000),
      });
    }
    await suppliers.registerInvoice(tx, {
      estateId,
      supplierId: luz,
      number: 'L-1',
      concept: 'Luz zonas comunes',
      issueDate: D('2026-02-28'),
      vatRatePct: 21,
      withholdingRatePct: 0,
      lines: await line('628', 400000),
    });
  });
  await prisma.$transaction((tx) =>
    suppliers.pay(tx, {
      estateId,
      supplierId: arq,
      date: D('2026-03-20'),
      amount: 50000,
      method: 'Transferencia',
    }),
  );
  await prisma.$transaction((tx) =>
    suppliers.pay(tx, {
      estateId,
      supplierId: arq,
      date: D('2026-04-10'),
      amount: 56000,
      method: 'Transferencia',
    }),
  );

  for (const [period, paid] of [
    ['2026-02', '2026-03-01'],
    ['2026-03', '2026-04-01'],
    ['2026-04', null],
  ] as const) {
    const p = await prisma.$transaction((tx) =>
      payroll.register(tx, {
        estateId,
        staffMemberId: staff.id,
        period,
        gross: 150000,
        employeeSs: 9750,
        employerSs: 48000,
        irpf: 15000,
      }),
    );
    if (paid)
      await prisma.$transaction((tx) =>
        payroll.pay(tx, p.id, { date: D(paid), method: 'Transferencia' }),
      );
  }
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Modelo 111', () => {
  it('1T: nómina de febrero y la parte de la retención del primer pago', async () => {
    const r = await reports.model111(estateId, 2026, 1, user);
    expect(r.boxes).toEqual({
      '01': 1,
      '02': 1500,
      '03': 150,
      '07': 1,
      '08': 471.7,
      '09': 70.75,
      '28': 220.75,
    });
    expect(r.deadline).toBe('2026-04-20');
    expect(r.pending).toBe(220.75);
    expect(r.detail.map((d) => [d.documentRef, d.withholding])).toEqual([
      ['Nómina 2026-02', 150],
      ['Factura A-1', 70.75],
    ]);
  });

  it('2T: el resto de la retención y la nómina de marzo pagada en abril; la de abril sin pagar no cuenta', async () => {
    const r = await reports.model111(estateId, 2026, 2, user);
    expect(r.boxes).toEqual({
      '01': 1,
      '02': 1500,
      '03': 150,
      '07': 1,
      '08': 528.3,
      '09': 79.25,
      '28': 229.25,
    });
  });

  it('el ingreso del 111 salda la 4751 y deja el trimestre sin pendiente; deshacerlo lo devuelve', async () => {
    const before = await balanceOf('4751');
    const t = await settlements.create(
      estateId,
      {
        kind: 'modelo111',
        period: '2026-T1',
        date: '2026-04-15',
        amount: 220.75,
        reference: 'NRC-TEST',
      },
      user,
    );
    const r = await reports.model111(estateId, 2026, 1, user);
    expect(r.settled).toBe(220.75);
    expect(r.pending).toBe(0);
    expect(Number(await balanceOf('4751'))).toBeCloseTo(
      Number(before) + 220.75,
      2,
    );

    await settlements.undo(t.id, { reason: 'Importe equivocado' }, user);
    expect((await reports.model111(estateId, 2026, 1, user)).pending).toBe(
      220.75,
    );
    await expect(
      settlements.undo(t.id, { reason: 'Otra vez' }, user),
    ).rejects.toThrow(/ya está deshecho/);
  });

  it('el pago de la Seguridad Social salda la 476', async () => {
    const before = Number(await balanceOf('476'));
    await settlements.create(
      estateId,
      {
        kind: 'seguridad_social',
        period: '2026-02',
        date: '2026-03-31',
        amount: 577.5,
      },
      user,
    );
    expect(Number(await balanceOf('476'))).toBeCloseTo(before + 577.5, 2);
    await expect(
      settlements.create(
        estateId,
        { kind: 'modelo111', period: '2026-02', date: '2026-03-31', amount: 1 },
        user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('Modelo 190', () => {
  it('resumen anual por perceptor y clave, solo con lo pagado', async () => {
    const r = await reports.model190(estateId, 2026, user);
    expect(r.rows).toEqual([
      {
        nif: 'B11111111',
        name: 'Arquitectos Norte',
        key: 'G',
        subkey: '01',
        perceptions: 1000,
        withholdings: 150,
      },
      {
        nif: '00000000T',
        name: 'Portero Pérez',
        key: 'A',
        subkey: null,
        perceptions: 3000,
        withholdings: 300,
      },
    ]);
    expect(r.totals).toEqual({
      recipients: 2,
      perceptions: 4000,
      withholdings: 450,
    });
    expect(r.missingNif).toEqual([]);
  });
});

describe('Modelo 347', () => {
  it('declara a Ascensores por trimestres y explica por qué no entran los demás', async () => {
    const r = await reports.model347(estateId, 2026, user);
    expect(
      r.purchases.map((p) => ({
        name: p.name,
        nif: p.nif,
        total: p.total,
        quarters: p.quarters,
      })),
    ).toEqual([
      {
        name: 'Ascensores XYZ',
        nif: 'B22222222',
        total: 4840,
        quarters: [2420, 2420, 0, 0],
      },
    ]);
    expect(r.excluded.map((e) => [e.name, e.reason])).toEqual([
      ['Arquitectos Norte', 'retencion'],
      ['Eléctrica', 'art_33_5'],
    ]);
  });
});

describe('Documentos', () => {
  it('Excel y PDF de los tres modelos', async () => {
    const docs = [
      document111(await reports.model111(estateId, 2026, 1, user)),
      document190(await reports.model190(estateId, 2026, user)),
      document347(await reports.model347(estateId, 2026, user)),
    ];
    for (const d of docs) {
      const xlsx = await renderReportXlsx(d);
      expect(xlsx.fileName).toMatch(/\.xlsx$/);
      expect(xlsx.content.subarray(0, 2).toString()).toBe('PK');
      const pdf = await renderReportPdf(d);
      expect(pdf.fileName).toMatch(/^modelo-\d{3}-2026.*\.pdf$/);
      expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});

describe('Garantías', () => {
  it('un ingreso no se modifica (DM070) y la contabilidad sigue cuadrada', async () => {
    const t = await settlements.create(
      estateId,
      {
        kind: 'modelo111',
        period: '2026-T2',
        date: '2026-07-15',
        amount: 229.25,
      },
      user,
    );
    let error: unknown;
    try {
      await prisma.taxSettlement.update({
        where: { id: t.id },
        data: { amount: 1 },
      });
    } catch (e) {
      error = e;
    }
    expect(parseLedgerDbError(error)?.code).toBe('DM070');
    expect(await invariants.check(estateId)).toEqual([]);
  });

  it('otra gestora no ve los modelos', async () => {
    await expect(
      reports.model111(estateId, 2026, 1, roleB(admin, [])),
    ).rejects.toThrow();
  });
});
