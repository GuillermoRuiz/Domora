import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { JournalService } from '../ledger/journal/journal.service';
import { parseLedgerDbError } from '../ledger/journal/journal-db-errors';
import { SupplierPostingService } from '../ledger/posting/supplier-posting.service';
import { InvariantsService } from '../ledger/invariants.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { SupplierInvoicesService } from './supplier-invoices.service';
import type { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Facturas y pagos a proveedores (fase 7a) contra Postgres real: asiento
 * de la factura con IVA no deducible y retención, pagos parciales,
 * anulación, mayor del proveedor y las garantías de la base de datos.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const posting = new SupplierPostingService(new JournalService());
const service = new SupplierInvoicesService(
  db,
  new EstateAccessService(),
  posting,
);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  supplierId: string;
  user: AuthenticatedUser;
  account: (code: string) => Promise<string>;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  const supplierId = await createSupplier(
    prisma,
    estateId,
    admin.administratorId,
    { name: 'Arquitectura Norte S.L.P.', taxId: 'B00000001' },
  );
  const account = async (code: string) =>
    (await prisma.chartAccount.findFirstOrThrow({ where: { estateId, code } }))
      .id;
  return { estateId, supplierId, user: roleB(admin, [estateId]), account };
}

async function invoiceDto(
  ctx: Ctx,
  overrides: Partial<CreateSupplierInvoiceDto> = {},
): Promise<CreateSupplierInvoiceDto> {
  return {
    number: `F-${Math.random().toString(36).slice(2, 8)}`,
    concept: 'Informe técnico de fachada',
    issueDate: '2026-03-10',
    vatRatePct: 21,
    withholdingRatePct: 15,
    lines: [{ accountId: await ctx.account('623'), baseAmount: 1000 }],
    ...overrides,
  };
}

async function balanceOf(
  estateId: string,
  code: string,
  filter: Prisma.JournalLineWhereInput = {},
) {
  const agg = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } }, ...filter },
    _sum: { debit: true, credit: true },
  });
  return (agg._sum.debit ?? new Prisma.Decimal(0))
    .minus(agg._sum.credit ?? new Prisma.Decimal(0))
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

const reload = (id: string) =>
  prisma.supplierInvoice.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (facturas de proveedor)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Registrar una factura', () => {
  it('profesional con IVA y retención: gasto 623 con IVA, 400 por lo que se paga y 4751 por la retención', async () => {
    const ctx = await freshEstate();
    const invoice = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, { withholdingKey: 'G_profesional' }),
      ctx.user,
    );
    expect(invoice).toMatchObject({
      baseAmount: 1000,
      vatAmount: 210,
      withholdingAmount: 150,
      total: 1210,
      payable: 1060,
      status: 'Registrada',
      outstanding: 1060,
      payableAccount: '400',
      withholdingKey: 'G_profesional',
    });
    expect(invoice.lines[0]).toMatchObject({
      accountCode: '623',
      baseAmount: 1000,
      amount: 1210,
    });
    expect(await balanceOf(ctx.estateId, '623')).toBe('1210.00');
    expect(
      await balanceOf(ctx.estateId, '400', { supplierInvoiceId: invoice.id }),
    ).toBe('-1060.00');
    expect(await balanceOf(ctx.estateId, '4751')).toBe('-150.00');
    const row = await reload(invoice.id);
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: row.entryId! },
    });
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-03-10');
    expect(entry.sourceType).toBe('supplier_invoice');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('varias líneas con centro de coste: el IVA se reparte y la fecha contable es la de recepción; 410 si se pide', async () => {
    const ctx = await freshEstate();
    const admin2 = await prisma.costCentre.create({
      data: {
        estateId: ctx.estateId,
        administratorId: admin.administratorId,
        name: 'Garaje',
      },
    });
    const invoice = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, {
        receivedDate: '2026-03-15',
        withholdingRatePct: 0,
        payableAccount: '410',
        lines: [
          {
            accountId: await ctx.account('622'),
            baseAmount: 33.33,
            description: 'Portal',
          },
          {
            accountId: await ctx.account('622'),
            baseAmount: 33.33,
            costCentreId: admin2.id,
            description: 'Garaje',
          },
          { accountId: await ctx.account('628'), baseAmount: 33.34 },
        ],
      }),
      ctx.user,
    );
    expect(invoice.total).toBe(121);
    expect(invoice.lines.map((l) => l.amount)).toEqual([40.33, 40.33, 40.34]);
    expect(invoice.payableAccount).toBe('410');
    expect(
      await balanceOf(ctx.estateId, '622', { costCentreId: admin2.id }),
    ).toBe('40.33');
    expect(await balanceOf(ctx.estateId, '410')).toBe('-121.00');
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: (await reload(invoice.id)).entryId! },
    });
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('el mismo número del mismo proveedor no se registra dos veces, salvo que la primera esté anulada', async () => {
    const ctx = await freshEstate();
    const first = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, { number: 'A-001' }),
      ctx.user,
    );
    await expect(
      service.create(
        ctx.estateId,
        ctx.supplierId,
        await invoiceDto(ctx, { number: 'a-001' }),
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.cancel(
      ctx.estateId,
      ctx.supplierId,
      first.id,
      { reason: 'Importe equivocado' },
      ctx.user,
    );
    const again = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, { number: 'A-001' }),
      ctx.user,
    );
    expect(again.status).toBe('Registrada');
  });

  it('rechaza cuentas que no son de gasto, centros de otra finca y proveedores de otra finca', async () => {
    const ctx = await freshEstate();
    const other = await freshEstate();
    const foreignCentre = await prisma.costCentre.create({
      data: {
        estateId: other.estateId,
        administratorId: admin.administratorId,
        name: 'Ajeno',
      },
    });
    await expect(
      service.create(
        ctx.estateId,
        ctx.supplierId,
        await invoiceDto(ctx, {
          lines: [{ accountId: await ctx.account('700'), baseAmount: 10 }],
        }),
        ctx.user,
      ),
    ).rejects.toThrow(/no es de gastos/);
    await expect(
      service.create(
        ctx.estateId,
        ctx.supplierId,
        await invoiceDto(ctx, {
          lines: [
            {
              accountId: await ctx.account('622'),
              baseAmount: 10,
              costCentreId: foreignCentre.id,
            },
          ],
        }),
        ctx.user,
      ),
    ).rejects.toThrow(/centro de coste/);
    await expect(
      service.create(
        ctx.estateId,
        other.supplierId,
        await invoiceDto(ctx),
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.create(
        ctx.estateId,
        ctx.supplierId,
        await invoiceDto(ctx, { issueDate: '2025-12-31' }),
        ctx.user,
      ),
    ).rejects.toThrow();
  });
});

describe('Pagar', () => {
  it('pago parcial y después el resto, por banco; lo que sobra es un error', async () => {
    const ctx = await freshEstate();
    const invoice = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx),
      ctx.user,
    );
    await service.pay(
      ctx.estateId,
      {
        supplierId: ctx.supplierId,
        date: '2026-03-20',
        amount: 500,
        method: 'Transferencia',
      },
      ctx.user,
    );
    expect(await reload(invoice.id)).toMatchObject({ status: 'Parcial' });
    expect((await reload(invoice.id)).outstanding.toFixed(2)).toBe('560.00');

    await expect(
      service.pay(
        ctx.estateId,
        {
          supplierId: ctx.supplierId,
          date: '2026-03-25',
          amount: 600,
          method: 'Transferencia',
        },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await service.pay(
      ctx.estateId,
      {
        supplierId: ctx.supplierId,
        date: '2026-03-25',
        amount: 560,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const paid = await reload(invoice.id);
    expect(paid.status).toBe('Pagada');
    expect(paid.outstanding.toFixed(2)).toBe('0.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('-1060.00');
    // La retención queda en la 4751 hasta el ingreso del modelo 111.
    expect(await balanceOf(ctx.estateId, '4751')).toBe('-150.00');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('sin indicar facturas, paga primero la que vence antes; en efectivo va a la caja', async () => {
    const ctx = await freshEstate();
    const later = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, {
        withholdingRatePct: 0,
        vatRatePct: 0,
        dueDate: '2026-05-31',
      }),
      ctx.user,
    );
    const sooner = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, {
        withholdingRatePct: 0,
        vatRatePct: 0,
        dueDate: '2026-04-30',
      }),
      ctx.user,
    );
    const payment = await service.pay(
      ctx.estateId,
      {
        supplierId: ctx.supplierId,
        date: '2026-04-01',
        amount: 1200,
        method: 'Efectivo',
      },
      ctx.user,
    );
    expect(payment.bankAccountId).toBeNull();
    expect((await reload(sooner.id)).status).toBe('Pagada');
    expect((await reload(later.id)).outstanding.toFixed(2)).toBe('800.00');
    expect(await balanceOf(ctx.estateId, '570')).toBe('-1200.00');
    const list = await service.listPayments(ctx.estateId, {}, ctx.user);
    expect(list[0].invoices.map((i) => i.amount).sort()).toEqual([1000, 200]);
  });

  it('dos pagos simultáneos del total: el proveedor se bloquea y solo uno entra', async () => {
    const ctx = await freshEstate();
    await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx),
      ctx.user,
    );
    const pay = () =>
      service.pay(
        ctx.estateId,
        {
          supplierId: ctx.supplierId,
          date: '2026-03-20',
          amount: 1060,
          method: 'Transferencia',
        },
        ctx.user,
      );
    const results = await Promise.allSettled([pay(), pay(), pay()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(ctx.estateId, '572')).toBe('-1060.00');
  });

  it('una factura con pagos no se anula; deshecho el pago, sí', async () => {
    const ctx = await freshEstate();
    const invoice = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx),
      ctx.user,
    );
    const payment = await service.pay(
      ctx.estateId,
      {
        supplierId: ctx.supplierId,
        date: '2026-03-20',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    await expect(
      service.cancel(
        ctx.estateId,
        ctx.supplierId,
        invoice.id,
        { reason: 'Error' },
        ctx.user,
      ),
    ).rejects.toThrow(/tiene pagos/);

    await service.undoPayment(
      payment.id,
      { reason: 'Transferencia rechazada' },
      ctx.user,
    );
    expect((await reload(invoice.id)).status).toBe('Registrada');
    await expect(
      service.undoPayment(payment.id, { reason: 'Otra vez' }, ctx.user),
    ).rejects.toThrow(/ya está deshecho/);

    const cancelled = await service.cancel(
      ctx.estateId,
      ctx.supplierId,
      invoice.id,
      { reason: 'Duplicada' },
      ctx.user,
    );
    expect(cancelled).toMatchObject({ status: 'Anulada', outstanding: 0 });
    expect(await balanceOf(ctx.estateId, '623')).toBe('0.00');
    expect(await balanceOf(ctx.estateId, '4751')).toBe('0.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('0.00');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('el mayor del proveedor muestra facturas y pagos con lo que se le debe', async () => {
    const ctx = await freshEstate();
    await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx, { number: 'L-1' }),
      ctx.user,
    );
    await service.pay(
      ctx.estateId,
      {
        supplierId: ctx.supplierId,
        date: '2026-03-20',
        amount: 60,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const ledger = await service.ledger(ctx.estateId, ctx.supplierId, ctx.user);
    expect(
      ledger.movements.map((m) => [m.sourceType, m.invoiceNumber, m.balance]),
    ).toEqual([
      ['supplier_invoice', 'L-1', 1060],
      ['supplier_payment', 'L-1', 1000],
    ]);
    expect(ledger.balance).toBe(1000);
    const pending = await service.listForEstate(ctx.estateId, {}, ctx.user);
    expect(pending.map((i) => i.outstanding)).toEqual([1000]);
  });
});

describe('Garantías de la base de datos', () => {
  it('una factura registrada no cambia de importe ni se borra (DM053)', async () => {
    const ctx = await freshEstate();
    const invoice = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx),
      ctx.user,
    );
    const update = await failure(
      prisma.supplierInvoice.update({
        where: { id: invoice.id },
        data: { concept: 'Otra cosa' },
      }),
    );
    expect(parseLedgerDbError(update)?.code).toBe('DM053');
    const del = await failure(
      prisma.supplierInvoice.delete({ where: { id: invoice.id } }),
    );
    expect(parseLedgerDbError(del)?.code).toBe('DM053');
  });

  it('marcarla pagada sin contabilizar el pago no se confirma (DM051)', async () => {
    const ctx = await freshEstate();
    const invoice = await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx),
      ctx.user,
    );
    const error = await failure(
      prisma.supplierInvoice.update({
        where: { id: invoice.id },
        data: { status: 'Pagada', outstanding: 0 },
      }),
    );
    expect(parseLedgerDbError(error)?.code).toBe('DM051');
  });

  it('un pago no se modifica y su importe es lo que salda (DM054, DM055)', async () => {
    const ctx = await freshEstate();
    await service.create(
      ctx.estateId,
      ctx.supplierId,
      await invoiceDto(ctx),
      ctx.user,
    );
    const payment = await service.pay(
      ctx.estateId,
      {
        supplierId: ctx.supplierId,
        date: '2026-03-20',
        amount: 100,
        method: 'Transferencia',
      },
      ctx.user,
    );
    const update = await failure(
      prisma.supplierPayment.update({
        where: { id: payment.id },
        data: { amount: 90 },
      }),
    );
    expect(parseLedgerDbError(update)?.code).toBe('DM054');
    // Un asiento que salda 100 € de la factura con un pago que dice 50 €.
    const invoice = (
      await service.listForEstate(ctx.estateId, {}, ctx.user)
    )[0];
    const journal = new JournalService();
    const forged = await failure(
      prisma.$transaction(async (tx) => {
        const entry = await journal.post(tx, {
          estateId: ctx.estateId,
          date: D('2026-03-21'),
          sourceType: 'supplier_payment',
          concept: 'Pago falsificado',
          lines: [
            {
              account: { role: 'suppliers_payable' },
              debit: 10000,
              supplierId: ctx.supplierId,
              supplierInvoiceId: invoice.id,
            },
            { account: { role: 'bank' }, credit: 10000 },
          ],
        });
        await tx.supplierInvoice.update({
          where: { id: invoice.id },
          data: { outstanding: 860, status: 'Parcial' },
        });
        await tx.supplierPayment.create({
          data: {
            estateId: ctx.estateId,
            supplierId: ctx.supplierId,
            date: D('2026-03-21'),
            amount: 50,
            method: 'Transferencia',
            entryId: entry.id,
          },
        });
      }),
    );
    expect(parseLedgerDbError(forged)?.code).toBe('DM055');
  });

  it('una factura de un proveedor de otra finca no entra (DM056)', async () => {
    const ctx = await freshEstate();
    const other = await freshEstate();
    const error = await failure(
      prisma.supplierInvoice.create({
        data: {
          estateId: ctx.estateId,
          supplierId: other.supplierId,
          number: 'X',
          concept: 'x',
          issueDate: D('2026-03-01'),
          receivedDate: D('2026-03-01'),
          baseAmount: 10,
          vatRatePct: 0,
          vatAmount: 0,
          withholdingRatePct: 0,
          withholdingAmount: 0,
          total: 10,
          payable: 10,
          payableRole: 'suppliers_payable',
          outstanding: 10,
        },
      }),
    );
    expect(parseLedgerDbError(error)?.code).toBe('DM056');
  });

  it('existen los triggers de facturas y pagos', async () => {
    const rows = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid IN ('supplier_invoices'::regclass, 'supplier_payments'::regclass, 'supplier_invoice_lines'::regclass)
         AND NOT tgisinternal
    `;
    const names = rows.map((r) => r.tgname);
    for (const t of [
      'supplier_invoices_guard',
      'supplier_invoices_consistency',
      'supplier_invoices_before_insert',
      'supplier_payments_guard',
      'supplier_payments_consistency',
      'supplier_invoice_lines_immutable',
    ]) {
      expect(names).toContain(t);
    }
  });
});
