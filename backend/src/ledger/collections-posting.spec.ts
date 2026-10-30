import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { DebtorsService } from '../debtors/debtors.service';
import { RemesasService } from '../sepa/remesas.service';
import type { AuthenticatedUser } from '../auth/auth.types';
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
import { JournalService } from './journal/journal.service';
import { parseLedgerDbError } from './journal/journal-db-errors';
import { ReceiptPostingService } from './posting/receipt-posting.service';
import { CollectionPostingService } from './posting/collection-posting.service';
import { CollectionsService } from './collections/collections.service';
import { InvariantsService } from './invariants.service';
import { LedgerQueryService } from './ledger-query.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Cobros (fase 5), contra Postgres real: parciales, anticipos, orden legal
 * de imputación, devoluciones con comisión, ingresos sin identificar (555),
 * cobro y devolución de remesas, cuotas de planes de pago y las garantías
 * de la base de datos sobre los cobros.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const access = new EstateAccessService();
const journal = new JournalService();
const receipts = new ReceiptPostingService(journal);
const posting = new CollectionPostingService(journal, receipts);
const collections = new CollectionsService(db, access, posting);
const debtors = new DebtorsService(
  db,
  access,
  undefined as never,
  undefined as never,
  posting,
  undefined as never,
);
const remesas = new RemesasService(
  db,
  access,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  posting,
);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  propertyId: string;
  user: AuthenticatedUser;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  const propertyId = await createProperty(prisma, estateId, {
    quotaMonthly: '100.00',
  });
  return { estateId, propertyId, user: roleB(admin, [estateId]) };
}

function receipt(
  ctx: Ctx,
  periodKey: string,
  amount = '100.00',
  extra: Partial<Parameters<typeof issueTestReceipt>[1]> = {},
) {
  return issueTestReceipt(prisma, {
    estateId: ctx.estateId,
    propertyId: ctx.propertyId,
    periodKey,
    amount,
    ...extra,
  });
}

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

async function reload(id: string) {
  return prisma.accountingReceipt.findUniqueOrThrow({ where: { id } });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error y la operación se completó.');
}

async function assertBalanced(estateId: string) {
  expect(await invariants.check(estateId)).toEqual([]);
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (cobros)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Cobro manual e imputación', () => {
  it('un cobro parcial deja el recibo Parcial y lo que sobra de otro cobro es anticipo', async () => {
    const ctx = await freshEstate();
    const r = await receipt(ctx, '2026-02');
    await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 40,
        method: 'Transferencia',
      },
      ctx.user,
    );
    expect((await reload(r.id)).status).toBe('Parcial');
    expect((await reload(r.id)).outstanding.toFixed(2)).toBe('60.00');

    await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-20',
        amount: 85,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const after = await reload(r.id);
    expect(after.status).toBe('Pagada');
    expect(after.outstanding.toFixed(2)).toBe('0.00');

    const account = await collections.propertyAccount(
      ctx.estateId,
      ctx.propertyId,
      ctx.user,
    );
    expect(account.advance).toBe(25);
    expect(account.pending).toBe(0);
    expect(account.balance).toBe(-25);
    // 430 de la propiedad acreedora por el anticipo; banco con los 125 €.
    expect(
      await balanceOf(ctx.estateId, '430', { propertyId: ctx.propertyId }),
    ).toBe('-25.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('125.00');
    await assertBalanced(ctx.estateId);
  });

  it('sin indicar recibos, primero los intereses y después lo más antiguo (arts. 1173 y 1174 CC)', async () => {
    const ctx = await freshEstate();
    const march = await receipt(ctx, '2026-03');
    const january = await receipt(ctx, '2026-01');
    const interest = await receipt(ctx, '2026-04', '10.00', {
      kind: 'intereses_demora',
    });

    await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-04-15',
        amount: 60,
        method: 'Efectivo',
      },
      ctx.user,
    );
    expect((await reload(interest.id)).status).toBe('Pagada');
    expect((await reload(january.id)).outstanding.toFixed(2)).toBe('50.00');
    expect((await reload(march.id)).outstanding.toFixed(2)).toBe('100.00');
    // En efectivo: a la caja.
    expect(await balanceOf(ctx.estateId, '570')).toBe('60.00');
  });

  it('la gestora puede elegir a qué recibo va el cobro', async () => {
    const ctx = await freshEstate();
    const january = await receipt(ctx, '2026-01');
    const march = await receipt(ctx, '2026-03');
    await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-03-10',
        amount: 100,
        method: 'Transferencia',
        receiptIds: [march.id],
      },
      ctx.user,
    );
    expect((await reload(march.id)).status).toBe('Pagada');
    expect((await reload(january.id)).status).toBe('Pendiente');
  });

  it('dos cobros simultáneos del mismo recibo: la propiedad se bloquea y solo uno lo cobra', async () => {
    const ctx = await freshEstate();
    const r = await receipt(ctx, '2026-02');
    const pay = () =>
      collections.create(
        ctx.estateId,
        {
          propertyId: ctx.propertyId,
          date: '2026-02-10',
          amount: 100,
          method: 'Transferencia',
          receiptIds: [r.id],
        },
        ctx.user,
      );
    const results = await Promise.allSettled([pay(), pay(), pay()]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await reload(r.id)).outstanding.toFixed(2)).toBe('0.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('100.00');
    await assertBalanced(ctx.estateId);
  });

  it('un banco de otra finca no se acepta', async () => {
    const ctx = await freshEstate();
    const other = await freshEstate();
    const bank = await prisma.bankAccount.findFirstOrThrow({
      where: { estateId: other.estateId },
    });
    await receipt(ctx, '2026-02');
    await expect(
      collections.create(
        ctx.estateId,
        {
          propertyId: ctx.propertyId,
          date: '2026-02-10',
          amount: 100,
          method: 'Transferencia',
          bankAccountId: bank.id,
        },
        ctx.user,
      ),
    ).rejects.toThrow(/cuenta bancaria no existe/);
  });
});

describe('Anticipos', () => {
  it('se aplican a los recibos nuevos, y el cobro que los generó ya no se deshace', async () => {
    const ctx = await freshEstate();
    const advancePayment = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-01-15',
        amount: 150,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const r = await receipt(ctx, '2026-02');
    const result = await collections.applyAdvance(
      ctx.estateId,
      { propertyId: ctx.propertyId, date: '2026-02-01' },
      ctx.user,
    );
    expect(result.applied).toBe(100);
    expect((await reload(r.id)).status).toBe('Pagada');
    expect(
      (
        await collections.propertyAccount(
          ctx.estateId,
          ctx.propertyId,
          ctx.user,
        )
      ).advance,
    ).toBe(50);

    const error = await failure(
      collections.undo(
        advancePayment.id,
        { reason: 'Error de registro' },
        ctx.user,
      ),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toMatch(/anticipo .* ya se aplicó/);
    await assertBalanced(ctx.estateId);
  });

  it('sin anticipo no hay nada que aplicar', async () => {
    const ctx = await freshEstate();
    await receipt(ctx, '2026-02');
    await expect(
      collections.applyAdvance(
        ctx.estateId,
        { propertyId: ctx.propertyId },
        ctx.user,
      ),
    ).rejects.toThrow(/no tiene anticipos/);
  });
});

describe('Deshacer y devolver', () => {
  it('deshacer un cobro es un contraasiento y el recibo vuelve a deber', async () => {
    const ctx = await freshEstate();
    const r = await receipt(ctx, '2026-02');
    const c = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const undone = await collections.undo(
      c.id,
      { reason: 'Cobro duplicado', date: '2026-02-11' },
      ctx.user,
    );
    expect(undone.undoneAt).not.toBeNull();
    expect(undone.undoEntryId).not.toBeNull();
    const after = await reload(r.id);
    expect(after.status).toBe('Pendiente');
    expect(after.outstanding.toFixed(2)).toBe('100.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('0.00');
    await expect(
      collections.undo(c.id, { reason: 'Otra vez' }, ctx.user),
    ).rejects.toThrow();
    await assertBalanced(ctx.estateId);
  });

  it('una devolución con comisión repercutida reabre el recibo y emite otro por la comisión', async () => {
    const ctx = await freshEstate();
    const r = await receipt(ctx, '2026-02');
    const c = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const ret = await collections.returnCollection(
      c.id,
      {
        date: '2026-02-15',
        returnCode: 'AM04',
        returnReason: 'Fondos insuficientes',
        feeAmount: 3.5,
        rechargeFee: true,
      },
      ctx.user,
    );
    const after = await reload(r.id);
    expect(after.status).toBe('Devuelto');
    expect(after.outstanding.toFixed(2)).toBe('100.00');
    expect(after.returnCode).toBe('AM04');
    // El banco perdió la comisión; el gasto va a la 626 y se repercute con un recibo (759).
    expect(await balanceOf(ctx.estateId, '572')).toBe('-3.50');
    expect(await balanceOf(ctx.estateId, '626')).toBe('3.50');
    expect(ret.feeRechargedReceiptId).not.toBeNull();
    const fee = await reload(ret.feeRechargedReceiptId!);
    expect(fee.kind).toBe('gastos_devolucion');
    expect(fee.outstanding.toFixed(2)).toBe('3.50');
    expect(await balanceOf(ctx.estateId, '759')).toBe('-3.50');

    // Recobrar después lo imputa primero a lo más antiguo.
    await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-03-01',
        amount: 103.5,
        method: 'Efectivo',
      },
      ctx.user,
    );
    expect((await reload(r.id)).status).toBe('Pagada');
    expect((await reload(fee.id)).status).toBe('Pagada');
    await assertBalanced(ctx.estateId);
  });

  it('un cobro en efectivo no se devuelve', async () => {
    const ctx = await freshEstate();
    await receipt(ctx, '2026-02');
    const c = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 100,
        method: 'Efectivo',
      },
      ctx.user,
    );
    await expect(
      collections.returnCollection(c.id, { date: '2026-02-12' }, ctx.user),
    ).rejects.toThrow(/efectivo/);
  });
});

describe('Ingresos sin identificar (555)', () => {
  it('entran al banco contra la 555 y se aplican después a una propiedad', async () => {
    const ctx = await freshEstate();
    const r = await receipt(ctx, '2026-02');
    const item = await collections.registerSuspense(
      ctx.estateId,
      {
        date: '2026-02-05',
        amount: 150,
        concept: 'Transferencia sin referencia',
      },
      ctx.user,
    );
    expect(await balanceOf(ctx.estateId, '572')).toBe('150.00');
    expect(await balanceOf(ctx.estateId, '555')).toBe('-150.00');

    await collections.applySuspense(
      item.id,
      { propertyId: ctx.propertyId, amount: 100, date: '2026-02-08' },
      ctx.user,
    );
    expect((await reload(r.id)).status).toBe('Pagada');
    expect(await balanceOf(ctx.estateId, '555')).toBe('-50.00');
    // El banco no se mueve al aplicar: el dinero ya estaba.
    expect(await balanceOf(ctx.estateId, '572')).toBe('150.00');

    const list = await collections.listSuspense(ctx.estateId, ctx.user);
    expect(list[0].remaining).toBe(50);
    await expect(
      collections.applySuspense(
        item.id,
        { propertyId: ctx.propertyId, amount: 60 },
        ctx.user,
      ),
    ).rejects.toThrow(/Solo quedan 50.00/);
    await assertBalanced(ctx.estateId);
  });
});

describe('Remesas', () => {
  async function remesaWith(ctx: Ctx, receiptIds: string[]) {
    const rs = await prisma.accountingReceipt.findMany({
      where: { id: { in: receiptIds } },
    });
    const bank = await prisma.bankAccount.findFirstOrThrow({
      where: { estateId: ctx.estateId, isDefault: true },
    });
    const total = rs.reduce(
      (s, r) => s.plus(r.outstanding),
      new Prisma.Decimal(0),
    );
    return prisma.remesaHistoryItem.create({
      data: {
        estateId: ctx.estateId,
        scheme: 'CORE',
        concept: 'Remesa de prueba',
        status: 'Presentada',
        linesCount: rs.length,
        totalAmount: total,
        messageId: `MSG-${Math.random().toString(36).slice(2, 14)}`,
        bankAccountId: bank.id,
        lines: {
          create: rs.map((r, i) => ({
            receiptId: r.id,
            propertyId: r.propertyId,
            iban: 'ES9121000418450200051332',
            mandateSeq: 'RCUR',
            amount: r.outstanding,
            status: 'Pendiente',
            endToEndId: `E2E-${Math.random().toString(36).slice(2, 12)}-${i}`,
          })),
        },
      },
      include: { lines: true },
    });
  }

  it('cobrar una remesa: una línea al banco por el total y un cobro por recibo', async () => {
    const ctx = await freshEstate();
    const second = await createProperty(prisma, ctx.estateId, {
      quotaMonthly: '150.00',
    });
    const a = await receipt(ctx, '2026-02');
    const b = await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: second,
      periodKey: '2026-02',
      amount: '150.00',
    });
    const remesa = await remesaWith(ctx, [a.id, b.id]);

    const collected = await remesas.collect(
      remesa.id,
      { date: '2026-02-06' },
      ctx.user,
    );
    expect(collected.status).toBe('Cobrada');
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: collected.collectionEntryId! },
      include: { lines: { include: { account: true } } },
    });
    const bankLines = entry.lines.filter((l) =>
      l.account.code.startsWith('572'),
    );
    expect(bankLines).toHaveLength(1);
    expect(bankLines[0].debit.toFixed(2)).toBe('250.00');
    expect(
      await prisma.collection.count({ where: { entryId: entry.id } }),
    ).toBe(2);
    expect((await reload(a.id)).status).toBe('Pagada');
    expect((await reload(b.id)).status).toBe('Pagada');
    await expect(
      remesas.collect(remesa.id, { date: '2026-02-06' }, ctx.user),
    ).rejects.toThrow(/solo se cobra una remesa presentada/);

    // Devolución de una línea: reabre ese recibo y solo ese.
    const lineA = remesa.lines.find((l) => l.receiptId === a.id)!;
    await debtors.returnRemesaLine(
      lineA.id,
      { returnCode: 'MD06', feeAmount: 2 },
      ctx.user,
    );
    expect((await reload(a.id)).status).toBe('Devuelto');
    expect((await reload(b.id)).status).toBe('Pagada');
    expect(
      (await prisma.remesaLine.findUniqueOrThrow({ where: { id: lineA.id } }))
        .status,
    ).toBe('Devuelto');
    expect(
      (
        await prisma.remesaHistoryItem.findUniqueOrThrow({
          where: { id: remesa.id },
        })
      ).status,
    ).toBe('ConDevoluciones');
    expect(await balanceOf(ctx.estateId, '572')).toBe('148.00');
    await expect(
      debtors.returnRemesaLine(lineA.id, { returnCode: 'MD06' }, ctx.user),
    ).rejects.toThrow(/ya está devuelta/);
    await assertBalanced(ctx.estateId);
  });

  it('un rechazo antes del cobro no contabiliza nada', async () => {
    const ctx = await freshEstate();
    const a = await receipt(ctx, '2026-02');
    const remesa = await remesaWith(ctx, [a.id]);
    const entriesBefore = await prisma.journalEntry.count({
      where: { estateId: ctx.estateId },
    });
    await debtors.returnRemesaLine(
      remesa.lines[0].id,
      { returnCode: 'AC04' },
      ctx.user,
    );
    expect(
      (
        await prisma.remesaLine.findUniqueOrThrow({
          where: { id: remesa.lines[0].id },
        })
      ).status,
    ).toBe('Rechazado');
    expect((await reload(a.id)).status).toBe('Devuelto');
    expect(
      await prisma.journalEntry.count({ where: { estateId: ctx.estateId } }),
    ).toBe(entriesBefore);
  });

  it('no se cobra una remesa con un recibo cobrado a mano después de enviarla', async () => {
    const ctx = await freshEstate();
    const a = await receipt(ctx, '2026-02');
    const remesa = await remesaWith(ctx, [a.id]);
    await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-03',
        amount: 100,
        method: 'Efectivo',
      },
      ctx.user,
    );
    await expect(
      remesas.collect(remesa.id, { date: '2026-02-06' }, ctx.user),
    ).rejects.toThrow(/ya no deben el importe/);
  });

  it('anular una remesa no cobrada; una cobrada no se anula', async () => {
    const ctx = await freshEstate();
    const a = await receipt(ctx, '2026-02');
    const b = await receipt(ctx, '2026-03');
    const pending = await remesaWith(ctx, [a.id]);
    expect((await remesas.cancel(pending.id, ctx.user)).status).toBe('Anulada');
    const collected = await remesaWith(ctx, [b.id]);
    await remesas.collect(collected.id, { date: '2026-03-06' }, ctx.user);
    await expect(remesas.cancel(collected.id, ctx.user)).rejects.toThrow(
      /todavía no se ha cobrado/,
    );
  });

  it('otra gestora no cobra ni anula la remesa', async () => {
    const ctx = await freshEstate();
    const a = await receipt(ctx, '2026-02');
    const remesa = await remesaWith(ctx, [a.id]);
    const stranger = roleB(admin, []);
    await expect(
      remesas.collect(remesa.id, { date: '2026-02-06' }, stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(remesas.cancel(remesa.id, stranger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('Planes de pago', () => {
  it('cada cuota pagada es un cobro imputado a los recibos del plan, del más antiguo al más nuevo', async () => {
    const ctx = await freshEstate();
    const january = await receipt(ctx, '2026-01');
    const february = await receipt(ctx, '2026-02');
    const debtor = await prisma.debtor.create({
      data: {
        administratorId: admin.administratorId,
        estateId: ctx.estateId,
        propertyId: ctx.propertyId,
        amount: '200.00',
        monthsOverdue: 2,
        oldest: '2026-01',
        step: 'Aviso',
      },
    });
    const agreement = await debtors.createAgreement(
      debtor.id,
      { totalAmount: 200, installmentsCount: 2, firstDueDate: '2026-03-01' },
      ctx.user,
    );
    expect(
      await prisma.paymentAgreementReceipt.count({
        where: { agreementId: agreement.id },
      }),
    ).toBe(2);
    // Un recibo posterior al plan no lo cubre.
    const april = await receipt(ctx, '2026-04');

    const [first, second] = agreement.installments;
    const paid = await debtors.markInstallmentPaid(
      first.id,
      { date: '2026-03-01' },
      ctx.user,
    );
    expect(paid.collectionId).not.toBeNull();
    expect((await reload(january.id)).status).toBe('Pagada');
    expect((await reload(february.id)).status).toBe('Pendiente');

    await debtors.markInstallmentPaid(
      second.id,
      { date: '2026-04-01', method: 'Bizum' },
      ctx.user,
    );
    expect((await reload(february.id)).status).toBe('Pagada');
    expect((await reload(april.id)).status).toBe('Pendiente');
    expect(
      (
        await prisma.paymentAgreement.findUniqueOrThrow({
          where: { id: agreement.id },
        })
      ).status,
    ).toBe('completed');
    await expect(
      debtors.markInstallmentPaid(second.id, {}, ctx.user),
    ).rejects.toThrow(/ya está marcada/);
    await assertBalanced(ctx.estateId);
  });
});

describe('Historial de un recibo', () => {
  it('muestra emisión, cobro y devolución con el saldo en cada paso; el propietario solo ve los suyos', async () => {
    const ctx = await freshEstate();
    const ownerId = await createOwnerUser(prisma);
    const r = await receipt(ctx, '2026-02', '100.00', { ownerUserId: ownerId });
    const c = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    await collections.returnCollection(
      c.id,
      { date: '2026-02-15', returnCode: 'MS02' },
      ctx.user,
    );

    const history = await collections.receiptHistory(r.id, ctx.user);
    expect(history.movements.map((m) => [m.sourceType, m.balance])).toEqual([
      ['receipt_issue', 100],
      ['collection', 0],
      ['receipt_return', 100],
    ]);
    expect(history.movements[1].collectionId).toBe(c.id);
    expect(history.movements[2].returnCode).toBe('MS02');

    const owner: AuthenticatedUser = {
      id: ownerId,
      role: 'C',
      estateIds: [ctx.estateId],
      administratorId: null,
    };
    const own = await collections.receiptHistory(r.id, owner);
    expect(own.movements.every((m) => m.collectionId === null)).toBe(true);
    const otherOwner: AuthenticatedUser = {
      id: await createOwnerUser(prisma),
      role: 'C',
      estateIds: [ctx.estateId],
      administratorId: null,
    };
    await expect(
      collections.receiptHistory(r.id, otherOwner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Garantías de la base de datos sobre los cobros', () => {
  it('un cobro no se modifica salvo para marcarlo deshecho (DM040)', async () => {
    const ctx = await freshEstate();
    await receipt(ctx, '2026-02');
    const c = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const error = await failure(
      prisma.collection.update({
        where: { id: c.id },
        data: { amount: '90.00' },
      }),
    );
    expect(parseLedgerDbError(error)?.code).toBe('DM040');
    const del = await failure(
      prisma.collection.delete({ where: { id: c.id } }),
    );
    expect(parseLedgerDbError(del)?.code).toBe('DM040');
  });

  it('un cobro cuyo importe no es lo abonado a la 430 en su asiento no se confirma (DM041)', async () => {
    const ctx = await freshEstate();
    await receipt(ctx, '2026-02');
    const c = await collections.create(
      ctx.estateId,
      {
        propertyId: ctx.propertyId,
        date: '2026-02-10',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const error = await failure(
      prisma.collection.create({
        data: {
          estateId: ctx.estateId,
          propertyId: ctx.propertyId,
          date: D('2026-02-10'),
          amount: '50.00',
          method: 'Transferencia',
          entryId: c.entryId,
        },
      }),
    );
    expect(parseLedgerDbError(error)?.code).toBe('DM041');
  });

  it('existen los triggers de cobros', async () => {
    const rows = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'collections'::regclass AND NOT tgisinternal
    `;
    const names = rows.map((r) => r.tgname);
    expect(names.some((n) => n.includes('guard'))).toBe(true);
    expect(names.some((n) => n.includes('consistency'))).toBe(true);
  });
});
