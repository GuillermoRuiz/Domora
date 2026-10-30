import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { AccountingService } from '../accounting/accounting.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  ensurePeriod,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { JournalService } from './journal/journal.service';
import { parseLedgerDbError, runPosting } from './journal/journal-db-errors';
import { ReceiptPostingService } from './posting/receipt-posting.service';
import { CollectionPostingService } from './posting/collection-posting.service';
import { InvariantsService } from './invariants.service';
import { LedgerQueryService } from './ledger-query.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Los recibos contabilizan (fase 4), contra Postgres real: emisión con su
 * asiento, reparto del fondo de reserva, cobro, devolución, anulación, y
 * las garantías de la base de datos que impiden que un recibo y su partida
 * abierta de la 430 se descuadren.
 */
jest.setTimeout(60_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const journal = new JournalService();
const posting = new ReceiptPostingService(journal);
const collections = new CollectionPostingService(journal, posting);
const accounting = new AccountingService(
  db,
  new EstateAccessService(),
  undefined as never,
  posting,
  collections,
  { notify: async () => {} } as unknown as NotificationsService,
);
const fiscalYears = new FiscalYearsService(db, new EstateAccessService());
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

async function freshEstate(): Promise<{
  estateId: string;
  user: AuthenticatedUser;
  propertyId: string;
}> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  const propertyId = await createProperty(prisma, estateId, {
    quotaMonthly: '100.00',
  });
  return { estateId, propertyId, user: roleB(admin, [estateId]) };
}

/** Saldo (debe − haber) de la cuenta con ese código en la finca, en euros. */
async function balanceOf(
  estateId: string,
  code: string,
  filter: Prisma.JournalLineWhereInput = {},
) {
  const lines = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } }, ...filter },
    _sum: { debit: true, credit: true },
  });
  return (lines._sum.debit ?? new Prisma.Decimal(0))
    .minus(lines._sum.credit ?? new Prisma.Decimal(0))
    .toFixed(2);
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error y la operación se completó.');
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (recibos contables)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Emisión', () => {
  it('generar recibos contabiliza cada uno: 430 del recibo contra 700', async () => {
    const { estateId, user, propertyId } = await freshEstate();
    await createProperty(prisma, estateId, { quotaMonthly: '150.00' });
    const result = await accounting.generateReceipts(
      estateId,
      { periodKey: '2026-03' },
      user,
    );
    expect(result.created).toBe(2);

    const receipts = await prisma.accountingReceipt.findMany({
      where: { estateId },
      include: { lines: true },
    });
    for (const r of receipts) {
      expect(r.issueEntryId).not.toBeNull();
      expect(r.outstanding.toFixed(2)).toBe(r.amount.toFixed(2));
      expect(r.accrualDate.toISOString().slice(0, 10)).toBe('2026-03-01');
      expect(r.originYear).toBe(2026);
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: r.issueEntryId! },
        include: { lines: true },
      });
      expect(entry.date.toISOString().slice(0, 10)).toBe('2026-03-01');
      expect(entry.sourceType).toBe('receipt_issue');
      expect(
        entry.lines.find((l) => l.receiptId === r.id)?.debit.toFixed(2),
      ).toBe(r.amount.toFixed(2));
    }
    expect(await balanceOf(estateId, '430')).toBe('250.00');
    expect(await balanceOf(estateId, '700')).toBe('-250.00');
    expect(await balanceOf(estateId, '430', { propertyId })).toBe('100.00');
    expect(await invariants.check(estateId)).toEqual([]);
  });

  it('con reserva por recibo del ejercicio, la parte de la reserva va a la 117', async () => {
    const { estateId, user } = await freshEstate();
    await fiscalYears.updateReserve(
      estateId,
      2026,
      { reserveMode: 'receipt_share', reserveSharePct: 10 },
      user,
    );
    await accounting.generateReceipts(estateId, { periodKey: '2026-04' }, user);

    expect(await balanceOf(estateId, '700')).toBe('-90.00');
    expect(await balanceOf(estateId, '117')).toBe('-10.00');
    const receipt = await prisma.accountingReceipt.findFirstOrThrow({
      where: { estateId },
      include: { lines: true },
    });
    expect(receipt.lines.map((l) => l.amount.toFixed(2)).sort()).toEqual([
      '10.00',
      '90.00',
    ]);
  });

  it('el ejercicio nuevo hereda la reserva por defecto de la finca', async () => {
    const { estateId } = await freshEstate();
    await prisma.accountingSettings.update({
      where: { estateId },
      data: {
        defaultReserveMode: 'both',
        defaultReserveSharePct: new Prisma.Decimal('9.10'),
      },
    });
    const config = await prisma.$transaction((tx) =>
      journal.reserveConfig(tx, estateId, 2027),
    );
    expect(config.mode).toBe('both');
    expect(config.sharePct?.toFixed(2)).toBe('9.10');
  });

  it('una derrama manual va a la 701 y se numera en la serie de manuales', async () => {
    const { estateId, user, propertyId } = await freshEstate();
    const receipt = await accounting.createManualReceipt(
      estateId,
      {
        propertyId,
        periodKey: '2026-05',
        concept: 'Derrama ascensor',
        kind: 'derrama',
        amount: 250,
        dueDate: '2026-05-20',
        method: 'Transferencia',
      },
      user,
    );
    expect(receipt.no).toBe('2026/05-M001');
    expect(await balanceOf(estateId, '701')).toBe('-250.00');
  });

  it('no se emite un recibo de un periodo anterior a la fecha de inicio contable sin fecharlo en el corte', async () => {
    const { estateId, propertyId } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2025-11',
      amount: '40.00',
    });
    // Deuda de 2025 (año de origen para el art. 9.1.e), contabilizada en el corte.
    expect(r.originYear).toBe(2025);
    expect(r.accrualDate.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});

describe('Cobro, devolución y anulación', () => {
  it('cobrar por banco deja el recibo pagado y la 430 del recibo a cero', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    const paid = await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Transferencia' },
      user,
    );

    expect(paid.status).toBe('Pagada');
    expect(paid.outstanding.toFixed(2)).toBe('0.00');
    expect(await balanceOf(estateId, '430', { receiptId: r.id })).toBe('0.00');
    expect(await balanceOf(estateId, '5720001')).toBe('100.00');
  });

  it('un cobro en efectivo va a la caja (570)', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '30.00',
    });
    await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Efectivo' },
      user,
    );
    expect(await balanceOf(estateId, '570')).toBe('30.00');
  });

  it('cobrar dos veces el mismo recibo no se puede', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Transferencia' },
      user,
    );
    const again = await failure(
      prisma.$transaction((tx) =>
        collections.collect(tx, {
          estateId,
          propertyId,
          date: new Date(),
          amount: 10000,
          method: 'Transferencia',
          receiptIds: [r.id],
        }),
      ),
    );
    expect(again).toBeInstanceOf(UnprocessableEntityException);
    expect((again as Error).message).toMatch(/no está pendiente/);
  });

  it('dos cobros simultáneos del mismo recibo: solo uno entra', async () => {
    const { estateId, propertyId } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        runPosting(prisma, (tx) =>
          collections.collect(tx, {
            estateId,
            propertyId,
            date: new Date(),
            amount: 10000,
            method: 'Transferencia',
            receiptIds: [r.id],
          }),
        ),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(estateId, '5720001')).toBe('100.00');
  });

  it('una devolución del banco reabre el recibo y deja el banco como estaba', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Domiciliacion' },
      user,
    );
    const returned = await accounting.updateReceipt(
      r.id,
      {
        status: 'Devuelto',
        returnCode: 'MD01',
        returnReason: 'Cuenta cancelada',
      },
      user,
    );

    expect(returned.status).toBe('Devuelto');
    expect(returned.outstanding.toFixed(2)).toBe('100.00');
    expect(await balanceOf(estateId, '5720001')).toBe('0.00');
    expect(await balanceOf(estateId, '430', { receiptId: r.id })).toBe(
      '100.00',
    );

    // Se vuelve a cobrar después.
    const recollected = await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Transferencia' },
      user,
    );
    expect(recollected.status).toBe('Pagada');
    expect(await balanceOf(estateId, '5720001')).toBe('100.00');
  });

  it('deshacer un cobro (Pagada → Pendiente) es un contraasiento', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Transferencia' },
      user,
    );
    const undone = await accounting.updateReceipt(
      r.id,
      { status: 'Pendiente' },
      user,
    );

    expect(undone.status).toBe('Pendiente');
    expect(await balanceOf(estateId, '5720001')).toBe('0.00');
    const reversals = await prisma.journalEntry.count({
      where: {
        estateId,
        sourceType: 'collection',
        reversesEntryId: { not: null },
      },
    });
    expect(reversals).toBe(1);
  });

  it('anular un recibo revierte su emisión y deja de ser deuda', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    const cancelled = await accounting.cancelReceipt(
      r.id,
      'Emitido a la propiedad equivocada',
      user,
    );

    expect(cancelled.status).toBe('Anulado');
    expect(cancelled.cancelEntryId).not.toBeNull();
    expect(cancelled.cancelReason).toBe('Emitido a la propiedad equivocada');
    expect(await balanceOf(estateId, '430')).toBe('0.00');
    expect(await balanceOf(estateId, '700')).toBe('0.00');

    // Anulado es terminal.
    await expect(
      accounting.cancelReceipt(r.id, 'otra vez', user),
    ).rejects.toThrow(ConflictException);
    await expect(
      accounting.updateReceipt(r.id, { status: 'Pagada' }, user),
    ).rejects.toThrow(/anulado/);
  });

  it('un recibo cobrado no se anula sin deshacer antes el cobro', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await accounting.updateReceipt(
      r.id,
      { status: 'Pagada', method: 'Transferencia' },
      user,
    );
    await expect(accounting.cancelReceipt(r.id, 'error', user)).rejects.toThrow(
      /deshaz el cobro/,
    );
  });

  it('un recibo en una remesa enviada al banco no se anula', async () => {
    const { estateId, propertyId, user } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    const periodId = await ensurePeriod(prisma, estateId, '2026-03');
    const remesa = await prisma.remesaHistoryItem.create({
      data: {
        estateId,
        periodId,
        status: 'Presentada',
        linesCount: 1,
        totalAmount: '100.00',
        presentedAt: new Date(),
        chargeDate: D('2026-03-10'),
        scheme: 'CORE',
        concept: 'Cuota marzo',
      } as never,
    });
    await prisma.remesaLine.create({
      data: {
        remesaId: remesa.id,
        receiptId: r.id,
        propertyId,
        mandateSeq: 'FRST',
        amount: '100.00',
        status: 'Pendiente',
        iban: 'ES91 ···· 1332',
        ibanSnapshot: 'ES91 ···· 1332',
      } as never,
    });
    await expect(accounting.cancelReceipt(r.id, 'error', user)).rejects.toThrow(
      /remesa/,
    );
  });
});

describe('Garantías de la base de datos sobre los recibos', () => {
  async function expectCode(promise: Promise<unknown>, code: string) {
    const error = await failure(promise);
    expect(parseLedgerDbError(error)?.code).toBe(code);
  }

  it('marcar "Pagada" sin contabilizar el cobro no se confirma (DM031)', async () => {
    const { estateId, propertyId } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await expectCode(
      prisma.accountingReceipt.update({
        where: { id: r.id },
        data: { status: 'Pagada', outstanding: '0.00' },
      }),
      'DM031',
    );
  });

  it('el importe, la propiedad o el concepto de un recibo emitido no se cambian (DM032)', async () => {
    const { estateId, propertyId } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await expectCode(
      prisma.accountingReceipt.update({
        where: { id: r.id },
        data: { amount: '1.00' },
      }),
      'DM032',
    );
    await expectCode(
      prisma.accountingReceipt.update({
        where: { id: r.id },
        data: { concept: 'Otro' },
      }),
      'DM032',
    );
  });

  it('un recibo no se borra (DM036), ni su desglose (DM020)', async () => {
    const { estateId, propertyId } = await freshEstate();
    const r = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    await expectCode(
      prisma.accountingReceipt.delete({ where: { id: r.id } }),
      'DM036',
    );
    await expectCode(
      prisma.receiptLine.deleteMany({ where: { receiptId: r.id } }),
      'DM020',
    );
  });

  it('un recibo sin asiento de emisión no se confirma (DM033)', async () => {
    const { estateId, propertyId } = await freshEstate();
    const periodId = await ensurePeriod(prisma, estateId, '2026-03');
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '700' },
    });
    await expectCode(
      prisma.accountingReceipt.create({
        data: {
          estateId,
          periodId,
          propertyId,
          no: 'SIN-ASIENTO',
          concept: 'x',
          kind: 'cuota_ordinaria',
          amount: '10.00',
          outstanding: '10.00',
          accrualDate: D('2026-03-01'),
          originYear: 2026,
          status: 'Pendiente',
          date: new Date(),
          method: 'Pendiente',
          lines: {
            create: [{ lineNo: 1, accountId: account.id, amount: '10.00' }],
          },
        },
      }),
      'DM033',
    );
  });

  it('un recibo de otra finca que su periodo no entra (DM035)', async () => {
    const a = await freshEstate();
    const b = await freshEstate();
    const periodOfB = await ensurePeriod(prisma, b.estateId, '2026-03');
    await expectCode(
      prisma.accountingReceipt.create({
        data: {
          estateId: a.estateId,
          periodId: periodOfB,
          propertyId: a.propertyId,
          no: 'CRUZADO',
          concept: 'x',
          kind: 'cuota_ordinaria',
          amount: '10.00',
          outstanding: '10.00',
          accrualDate: D('2026-03-01'),
          originYear: 2026,
          status: 'Pendiente',
          date: new Date(),
          method: 'Pendiente',
        },
      }),
      'DM035',
    );
  });

  it('existen los triggers de recibos', async () => {
    const rows = await prisma.$queryRaw<
      { tgname: string }[]
    >`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    expect(rows.map((r) => r.tgname)).toEqual(
      expect.arrayContaining([
        'receipts_before_insert',
        'receipts_guard',
        'receipts_consistency',
        'receipt_lines_immutable',
        'receipt_lines_no_truncate',
        'journal_lines_receipt_open_item',
      ]),
    );
  });
});
