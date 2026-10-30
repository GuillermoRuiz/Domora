import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PropertyAccessService } from '../../estate-access/property-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
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
} from '../../testing/db-fixtures';
import {
  renderReportPdf,
  renderReportXlsx,
} from '../../common/reports/table-report';
import { JournalService } from '../journal/journal.service';
import { ReceiptPostingService } from '../posting/receipt-posting.service';
import { CollectionPostingService } from '../posting/collection-posting.service';
import { SupplierPostingService } from '../posting/supplier-posting.service';
import { LedgerQueryService } from '../ledger-query.service';
import { BudgetService } from '../budget/budget.service';
import { FiscalYearsService } from '../../fiscal-years/fiscal-years.service';
import { LedgerReportsService } from './ledger-reports.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Fase 12 de doc/contabilidad/roadmap-partida-doble.md: informes contables.
 * Escenario con los importes esperados calculados a mano:
 *
 * - Propiedad A: cuota de 1.000 € emitida en marzo/2025, sin cobrar (queda
 *   como deuda en la 430).
 * - Propiedad B: cuota de 500 € emitida en marzo/2025, cobrada por 700 € —
 *   los 200 € de más quedan como anticipo sin aplicar (430 acreedora sin
 *   recibo).
 * - Gasto de 300 € contabilizado a mano en la 628 (Suministros), con
 *   presupuesto de 500 € para el ejercicio: desviación de -200 €.
 *
 * Balance esperado a 31/12/2025: Activo = banco (700) + deudores (1.000) =
 * 1.700. Pasivo = anticipos (200). Patrimonio neto = resultado pendiente
 * (1.500 de ingreso − 300 de gasto = 1.200). 200 + 1.200 = 1.400 ≠ 1.700:
 * faltan los 300 € que salieron del banco hacia el gasto — el banco ya
 * los descontó (700 − 300 = 400 en el activo), así que Activo pasa a 1.400
 * y sí cuadra con 200 + 1.200. El test comprueba `balanced` en vez de
 * repetir esta cuenta a mano.
 */
jest.setTimeout(120_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const access = new EstateAccessService();
const journal = new JournalService();
const receiptPosting = new ReceiptPostingService(journal);
const collectionPosting = new CollectionPostingService(journal, receiptPosting);
const ledgerQuery = new LedgerQueryService(db);
const budget = new BudgetService(
  db,
  access,
  new FiscalYearsService(db, access),
  ledgerQuery,
);
const reports = new LedgerReportsService(
  db,
  access,
  ledgerQuery,
  budget,
  new PropertyAccessService(db, access),
);

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

let admin: AdministratorFixture;
let estateId: string;
let propertyA: string;
let propertyB: string;
let user: AuthenticatedUser;
/** Usuarios rol C creados en algún describe — se purgan al final del fichero. */
const extraUserIds: string[] = [];

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (informes)',
  });
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2024-01-01'),
  });
  propertyA = await createProperty(prisma, estateId);
  propertyB = await createProperty(prisma, estateId);
  user = roleB(admin, [estateId]);

  await issueTestReceipt(prisma, {
    estateId,
    propertyId: propertyA,
    periodKey: '2025-03',
    amount: '1000.00',
    status: 'Pendiente',
  });
  const receiptB = await issueTestReceipt(prisma, {
    estateId,
    propertyId: propertyB,
    periodKey: '2025-03',
    amount: '500.00',
    status: 'Pendiente',
  });
  await prisma.$transaction((tx) =>
    collectionPosting.collect(tx, {
      estateId,
      propertyId: propertyB,
      date: D('2025-03-20'),
      amount: 70_000,
      method: 'Transferencia',
      receiptIds: [receiptB.id],
    }),
  );

  const expenseAccount = await prisma.chartAccount.findFirstOrThrow({
    where: { estateId, code: '628' },
  });
  const bankAccount = await prisma.chartAccount.findFirstOrThrow({
    where: { estateId, code: { startsWith: '572' }, postable: true },
  });
  await prisma.budgetItem.create({
    data: {
      estateId,
      accountId: expenseAccount.id,
      category: 'Suministros',
      fiscalYear: 2025,
      budgeted: '500.00',
    },
  });
  await prisma.$transaction((tx) =>
    journal.post(tx, {
      estateId,
      date: D('2025-04-05'),
      sourceType: 'manual',
      concept: 'Factura de suministros de prueba',
      lines: [
        { account: { accountId: expenseAccount.id }, debit: 30_000 },
        { account: { accountId: bankAccount.id }, credit: 30_000 },
      ],
    }),
  );
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId, extraUserIds);
  await prisma.$disconnect();
});

describe('LedgerReportsService.trialBalance', () => {
  it('cuadra debe y haber, y refleja las cuentas movidas del ejercicio', async () => {
    const data = await reports.trialBalance(estateId, 2025, user);
    expect(data.totalDebit).toBeCloseTo(data.totalCredit, 2);
    const cuotas = data.rows.find((r) => r.code === '700');
    expect(cuotas?.credit).toBeCloseTo(1500, 2);
    const suministros = data.rows.find((r) => r.code === '628');
    expect(suministros?.debit).toBeCloseTo(300, 2);
  });
});

describe('LedgerReportsService.generalLedger', () => {
  it('mayor de la 700: dos líneas de haber y saldo final acreedor', async () => {
    const data = await reports.generalLedger(
      estateId,
      { accountCode: '700' },
      user,
    );
    expect(data.rows).toHaveLength(2);
    expect(data.openingBalance).toBe(0);
    expect(data.closingBalance).toBe(-1500);
    expect(data.rows[data.rows.length - 1].balance).toBe(-1500);
  });

  it('filtra por propiedad: la 430 de la propiedad A solo ve su propio recibo', async () => {
    const data = await reports.generalLedger(
      estateId,
      { accountCode: '430', propertyId: propertyA },
      user,
    );
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].debit).toBe(1000);
    expect(data.closingBalance).toBe(1000);
  });

  it('cuenta inexistente: 404', async () => {
    await expect(
      reports.generalLedger(estateId, { accountCode: '999999' }, user),
    ).rejects.toThrow();
  });
});

describe('LedgerReportsService.balanceSheet', () => {
  it('reclasifica la 430: deuda de A como activo, anticipo de B como pasivo, y cuadra', async () => {
    const data = await reports.balanceSheet(estateId, '2025-12-31', user);
    expect(data.balanced).toBe(true);

    const owedRow = data.asset.rows.find((r) => r.code === '430*');
    expect(owedRow?.amount).toBeCloseTo(1000, 2);
    const advanceRow = data.liability.rows.find((r) => r.code === '430*');
    expect(advanceRow?.amount).toBeCloseTo(200, 2);
    const resultRow = data.equity.rows.find((r) => r.code === '129*');
    expect(resultRow?.amount).toBeCloseTo(1200, 2); // 1.500 de ingreso − 300 de gasto.

    expect(data.asset.total).toBeCloseTo(
      data.liability.total + data.equity.total,
      2,
    );
  });
});

describe('LedgerReportsService.budgetVsActual', () => {
  it('compara presupuestado y ejecutado, con la desviación esperada', async () => {
    const data = await reports.budgetVsActual(estateId, 2025, user);
    const row = data.rows.find((r) => r.code === '628');
    expect(row?.budgeted).toBeCloseTo(500, 2);
    expect(row?.executed).toBeCloseTo(300, 2);
    expect(row?.deviation).toBeCloseTo(-200, 2);
  });
});

describe('Documentos', () => {
  it('Excel y PDF de los cuatro informes', async () => {
    const docs = [
      reports.documentTrialBalance(
        await reports.trialBalance(estateId, 2025, user),
      ),
      reports.documentGeneralLedger(
        await reports.generalLedger(estateId, { accountCode: '700' }, user),
      ),
      reports.documentBalanceSheet(
        await reports.balanceSheet(estateId, '2025-12-31', user),
      ),
      reports.documentBudgetVsActual(
        await reports.budgetVsActual(estateId, 2025, user),
      ),
    ];
    for (const d of docs) {
      const xlsx = await renderReportXlsx(d);
      expect(xlsx.fileName).toMatch(/\.xlsx$/);
      expect(xlsx.content.subarray(0, 2).toString()).toBe('PK');
      const pdf = await renderReportPdf(d);
      expect(pdf.fileName).toMatch(/\.pdf$/);
      expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});

describe('LedgerReportsService.cashSettlement', () => {
  /**
   * Finca aparte, con un escenario propio calculado a mano:
   *
   * - Recibo A (1.000 €, una sola línea a la 700): cobrado entero dentro
   *   del periodo → 1.000 € a la 700, sin reparto que hacer.
   * - Recibo B (1.000 €, repartido 90 %/10 % entre 700 y 117 desde el
   *   ejercicio 2025): cobrado solo en parte (300 €) → el reparto
   *   proporcional da exactamente 270 € a la 700 y 30 € a la 117.
   * - Recibo D (500 €, una línea a la 700): cobrado por 700 € — los 500 €
   *   de la deuda van a la 700 y los 200 € de más quedan como anticipo sin
   *   aplicar (recibo sin marcar).
   * - Recibo E (200 €): cobrado FUERA del periodo (enero/2024) — no debe
   *   aparecer en el informe.
   * - Factura de proveedor (400 € a la 621 + 600 € a la 628, IVA 21 %,
   *   sin retención): pagada entera dentro del periodo → el reparto
   *   proporcional da exactamente 484 € a la 621 y 726 € a la 628.
   *
   * Total cobrado esperado: 700 = 1.000 (A) + 270 (B) + 500 (D) = 1.770;
   * 117 = 30 (B); anticipos = 200 (D) → total 1.770 + 30 + 200 = 2.000 €.
   * Total pagado esperado: 484 + 726 = 1.210 €.
   * Resultado de caja del periodo: 2.000 − 1.210 = 790 €.
   */
  let cashEstateId: string;
  let cashUser: AuthenticatedUser;

  beforeAll(async () => {
    cashEstateId = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: D('2024-01-01'),
    });
    cashUser = roleB(admin, [cashEstateId]);
    const propA = await createProperty(prisma, cashEstateId);
    const propB = await createProperty(prisma, cashEstateId);
    const propD = await createProperty(prisma, cashEstateId);
    const propE = await createProperty(prisma, cashEstateId);

    const receiptA = await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId: propA,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pendiente',
    });
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId: cashEstateId,
        propertyId: propA,
        date: D('2025-03-10'),
        amount: 100_000,
        method: 'Transferencia',
        receiptIds: [receiptA.id],
      }),
    );

    // Recibo E, cobrado fuera del periodo (para probar el filtro de fechas).
    const receiptE = await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId: propE,
      periodKey: '2024-01',
      amount: '200.00',
      status: 'Pendiente',
    });
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId: cashEstateId,
        propertyId: propE,
        date: D('2024-01-15'),
        amount: 20_000,
        method: 'Transferencia',
        receiptIds: [receiptE.id],
      }),
    );

    // Recibo D, todavía sin reparto de reserva (como A): se emite ANTES de
    // activar el modo receipt_share más abajo.
    const receiptD = await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId: propD,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pendiente',
    });
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId: cashEstateId,
        propertyId: propD,
        date: D('2025-03-25'),
        amount: 70_000,
        method: 'Transferencia',
        receiptIds: [receiptD.id],
      }),
    );

    // A partir de aquí, el ejercicio 2025 reparte el 10 % de cada cuota al
    // fondo de reserva — solo afecta a lo que se emita desde ahora (B).
    await prisma.fiscalYear.update({
      where: { estateId_year: { estateId: cashEstateId, year: 2025 } },
      data: { reserveMode: 'receipt_share', reserveSharePct: '10.00' },
    });
    const receiptB = await issueTestReceipt(prisma, {
      estateId: cashEstateId,
      propertyId: propB,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pendiente',
    });
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId: cashEstateId,
        propertyId: propB,
        date: D('2025-03-15'),
        amount: 30_000,
        method: 'Transferencia',
        receiptIds: [receiptB.id],
      }),
    );

    const supplierId = await createSupplier(
      prisma,
      cashEstateId,
      admin.administratorId,
    );
    const account621 = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId: cashEstateId, code: '621' },
    });
    const account628 = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId: cashEstateId, code: '628' },
    });
    const supplierPosting = new SupplierPostingService(journal);
    const invoice = await prisma.$transaction((tx) =>
      supplierPosting.registerInvoice(tx, {
        estateId: cashEstateId,
        supplierId,
        number: 'F-2025-001',
        concept: 'Factura de prueba',
        issueDate: D('2025-03-01'),
        vatRatePct: 21,
        withholdingRatePct: 0,
        lines: [
          { accountId: account621.id, base: 40_000 },
          { accountId: account628.id, base: 60_000 },
        ],
      }),
    );
    await prisma.$transaction((tx) =>
      supplierPosting.pay(tx, {
        estateId: cashEstateId,
        supplierId,
        date: D('2025-03-28'),
        amount: 121_000,
        method: 'Transferencia',
        invoiceIds: [invoice.id],
      }),
    );
  });

  it('reparte proporcionalmente los cobros parciales y separa deuda, anticipo y periodo', async () => {
    const data = await reports.cashSettlement(
      cashEstateId,
      { from: '2025-01-01', to: '2025-12-31' },
      cashUser,
    );

    const income700 = data.income.rows.find((r) => r.code === '700');
    expect(income700?.amount).toBeCloseTo(1770, 2); // 1.000 (A) + 270 (B) + 500 (D).
    const income117 = data.income.rows.find((r) => r.code === '117');
    expect(income117?.amount).toBeCloseTo(30, 2);
    const advances = data.income.rows.find((r) =>
      r.name.startsWith('Anticipos'),
    );
    expect(advances?.amount).toBeCloseTo(200, 2);
    expect(data.income.total).toBeCloseTo(2000, 2);

    const expense621 = data.expense.rows.find((r) => r.code === '621');
    expect(expense621?.amount).toBeCloseTo(484, 2);
    const expense628 = data.expense.rows.find((r) => r.code === '628');
    expect(expense628?.amount).toBeCloseTo(726, 2);
    expect(data.expense.total).toBeCloseTo(1210, 2);

    expect(data.net).toBeCloseTo(790, 2);
  });

  it('documento: Excel y PDF', async () => {
    const data = await reports.cashSettlement(
      cashEstateId,
      { from: '2025-01-01', to: '2025-12-31' },
      cashUser,
    );
    const doc = reports.documentCashSettlement(data);
    const xlsx = await renderReportXlsx(doc);
    expect(xlsx.content.subarray(0, 2).toString()).toBe('PK');
    const pdf = await renderReportPdf(doc);
    expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('LedgerReportsService.propertyStatement', () => {
  /**
   * Finca aparte con dos propiedades y un propietario (rol C) vinculado
   * SOLO a la propiedad F — nunca debe poder ver el extracto de la G,
   * aunque las dos estén en la misma finca (por eso `EstateAccessService`
   * no vale aquí: rol C tiene la finca entera en `estateIds`).
   */
  let statementEstateId: string;
  let propertyF: string;
  let propertyG: string;
  let ownerUserId: string;
  let ownerUser: AuthenticatedUser;
  let revokedOwnerUser: AuthenticatedUser;

  beforeAll(async () => {
    statementEstateId = await createLedgerEstate(
      prisma,
      admin.administratorId,
      { cutoverDate: D('2024-01-01') },
    );
    propertyF = await createProperty(prisma, statementEstateId);
    propertyG = await createProperty(prisma, statementEstateId);

    await issueTestReceipt(prisma, {
      estateId: statementEstateId,
      propertyId: propertyF,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pendiente',
    });

    ownerUserId = await createOwnerUser(prisma);
    extraUserIds.push(ownerUserId);
    await prisma.propertyMembership.create({
      data: {
        propertyId: propertyF,
        userId: ownerUserId,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    ownerUser = {
      id: ownerUserId,
      role: 'C',
      estateIds: [statementEstateId],
      administratorId: null,
    };

    const revokedUserId = await createOwnerUser(prisma);
    extraUserIds.push(revokedUserId);
    await prisma.propertyMembership.create({
      data: {
        propertyId: propertyF,
        userId: revokedUserId,
        roleType: 'Inquilino',
        status: 'revoked',
        linkedAt: new Date('2025-01-01'),
        revokedAt: new Date('2025-02-01'),
      },
    });
    revokedOwnerUser = {
      id: revokedUserId,
      role: 'C',
      estateIds: [statementEstateId],
      administratorId: null,
    };
  });

  it('rol B ve el extracto de cualquier propiedad de su finca', async () => {
    const data = await reports.propertyStatement(
      propertyF,
      {},
      roleB(admin, [statementEstateId]),
    );
    expect(data.closingBalance).toBe(1000);
    expect(data.rows).toHaveLength(1);
  });

  it('rol C ve el extracto de SU propiedad', async () => {
    const data = await reports.propertyStatement(propertyF, {}, ownerUser);
    expect(data.closingBalance).toBe(1000);
    expect(data.property.ref).toBeTruthy();
  });

  it('rol C NO puede ver el extracto de otra propiedad de la misma finca', async () => {
    await expect(
      reports.propertyStatement(propertyG, {}, ownerUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una vinculación revocada ya no da acceso', async () => {
    await expect(
      reports.propertyStatement(propertyF, {}, revokedOwnerUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('documento: Excel y PDF', async () => {
    const data = await reports.propertyStatement(propertyF, {}, ownerUser);
    const doc = reports.documentPropertyStatement(data);
    const xlsx = await renderReportXlsx(doc);
    expect(xlsx.content.subarray(0, 2).toString()).toBe('PK');
    const pdf = await renderReportPdf(doc);
    expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');
  });
});
