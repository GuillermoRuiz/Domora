import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { StorageService } from '../../files/storage.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { JournalService } from '../journal/journal.service';
import { TreasuryPostingService } from '../posting/treasury-posting.service';
import { InvariantsService } from '../invariants.service';
import { LedgerQueryService } from '../ledger-query.service';
import { JournalBookService } from './journal-book.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Libro diario y tesorería rápida (fase 8a) contra Postgres real.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const journal = new JournalService();
const storage = new StorageService({ get: () => undefined } as never);
const service = new JournalBookService(
  db,
  new EstateAccessService(),
  storage,
  journal,
  new TreasuryPostingService(journal),
);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  user: AuthenticatedUser;
  bankId: string;
  account: (code: string) => Promise<string>;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  const bank = await prisma.bankAccount.findFirstOrThrow({
    where: { estateId, isDefault: true },
  });
  return {
    estateId,
    user: roleB(admin, [estateId]),
    bankId: bank.id,
    account: async (code: string) =>
      (
        await prisma.chartAccount.findFirstOrThrow({
          where: { estateId, code },
        })
      ).id,
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

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (diario y tesorería)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Tesorería rápida', () => {
  it('un ingreso al banco contra una cuenta de ingresos, con centro de coste; un gasto pagado en efectivo', async () => {
    const ctx = await freshEstate();
    const centre = await prisma.costCentre.create({
      data: {
        estateId: ctx.estateId,
        administratorId: admin.administratorId,
        name: 'Garaje',
      },
    });
    const income = await service.quickEntry(
      ctx.estateId,
      {
        date: '2026-03-01',
        direction: 'in',
        amount: 300,
        bankAccountId: ctx.bankId,
        counterpartAccountId: await ctx.account('752'),
        costCentreId: centre.id,
        concept: 'Alquiler de plaza de garaje marzo',
      },
      ctx.user,
    );
    expect(income.sourceType).toBe('treasury');
    expect(
      income.lines.map((l) => [
        l.accountCode.slice(0, 3),
        l.debit,
        l.credit,
        l.costCentre,
      ]),
    ).toEqual([
      ['572', 300, 0, null],
      ['752', 0, 300, 'Garaje'],
    ]);
    await service.quickEntry(
      ctx.estateId,
      {
        date: '2026-03-02',
        direction: 'out',
        amount: 12.5,
        counterpartAccountId: await ctx.account('629'),
        concept: 'Llaves del cuarto de contadores',
      },
      ctx.user,
    );
    expect(await balanceOf(ctx.estateId, '570')).toBe('-12.50');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('manda a su flujo lo que tiene flujo propio y a un asiento manual lo que no es de ingreso o gasto', async () => {
    const ctx = await freshEstate();
    const base = {
      date: '2026-03-01',
      direction: 'in' as const,
      amount: 10,
      bankAccountId: ctx.bankId,
      concept: 'Prueba',
    };
    for (const [code, message] of [
      ['430', /Registrar cobro/],
      ['400', /Proveedores/],
      ['555', /Ingresos sin identificar/],
      ['4751', /modelo 111/],
      ['129', /asiento manual/],
    ] as const) {
      await expect(
        service.quickEntry(
          ctx.estateId,
          { ...base, counterpartAccountId: await ctx.account(code) },
          ctx.user,
        ),
      ).rejects.toThrow(message);
    }
    await expect(
      service.quickEntry(
        ctx.estateId,
        { ...base, counterpartAccountId: await ctx.account('570') },
        ctx.user,
      ),
    ).rejects.toThrow(/Traspaso/);
  });

  it('traspaso del banco a la caja', async () => {
    const ctx = await freshEstate();
    await service.transfer(
      ctx.estateId,
      { date: '2026-03-05', amount: 200, fromBankAccountId: ctx.bankId },
      ctx.user,
    );
    expect(await balanceOf(ctx.estateId, '570')).toBe('200.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('-200.00');
    await expect(
      service.transfer(
        ctx.estateId,
        {
          date: '2026-03-05',
          amount: 1,
          fromBankAccountId: ctx.bankId,
          toBankAccountId: ctx.bankId,
        },
        ctx.user,
      ),
    ).rejects.toThrow(/misma cuenta/);
  });
});

describe('Asiento manual', () => {
  it('registra un asiento cuadrado de varias líneas', async () => {
    const ctx = await freshEstate();
    const bankAccount = (
      await prisma.bankAccount.findUniqueOrThrow({ where: { id: ctx.bankId } })
    ).chartAccountId;
    const entry = await service.createManual(
      ctx.estateId,
      {
        date: '2026-04-01',
        concept: 'Comisión de mantenimiento y gastos financieros',
        reference: 'EXT-04',
        lines: [
          { accountId: await ctx.account('626'), debit: 15, credit: 0 },
          {
            accountId: await ctx.account('669'),
            debit: 5,
            credit: 0,
            concept: 'Descubierto',
          },
          { accountId: bankAccount, debit: 0, credit: 20 },
        ],
      },
      ctx.user,
    );
    expect(entry.sourceType).toBe('manual');
    expect(entry.total).toBe(20);
    expect(entry.canReverse).toBe(true);
  });

  it('rechaza lo que no cuadra, las líneas con los dos lados y las cuentas de documentos', async () => {
    const ctx = await freshEstate();
    const [a626, a669, a430] = [
      await ctx.account('626'),
      await ctx.account('669'),
      await ctx.account('430'),
    ];
    await expect(
      service.createManual(
        ctx.estateId,
        {
          date: '2026-04-01',
          concept: 'Descuadre',
          lines: [
            { accountId: a626, debit: 10, credit: 0 },
            { accountId: a669, debit: 0, credit: 9 },
          ],
        },
        ctx.user,
      ),
    ).rejects.toThrow(/no cuadra/);
    await expect(
      service.createManual(
        ctx.estateId,
        {
          date: '2026-04-01',
          concept: 'Dos lados',
          lines: [
            { accountId: a626, debit: 10, credit: 10 },
            { accountId: a669, debit: 0, credit: 0 },
          ],
        },
        ctx.user,
      ),
    ).rejects.toThrow(/no en los dos/);
    await expect(
      service.createManual(
        ctx.estateId,
        {
          date: '2026-04-01',
          concept: 'Propietarios',
          lines: [
            { accountId: a430, debit: 10, credit: 0 },
            { accountId: a669, debit: 0, credit: 10 },
          ],
        },
        ctx.user,
      ),
    ).rejects.toThrow(/solo se mueve con sus documentos/);
    await expect(
      service.createManual(
        ctx.estateId,
        {
          date: '2025-12-31',
          concept: 'Antes del inicio',
          lines: [
            { accountId: a626, debit: 10, credit: 0 },
            { accountId: a669, debit: 0, credit: 10 },
          ],
        },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('Consultar y anular', () => {
  it('lista con filtros y paginación; anula lo manual y deja los documentos para su flujo', async () => {
    const ctx = await freshEstate();
    const propertyId = await createProperty(prisma, ctx.estateId);
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId,
      periodKey: '2026-02',
      amount: '100.00',
    });
    const quick = await service.quickEntry(
      ctx.estateId,
      {
        date: '2026-03-01',
        direction: 'out',
        amount: 40,
        bankAccountId: ctx.bankId,
        counterpartAccountId: await ctx.account('628'),
        concept: 'Recarga de gasoil',
      },
      ctx.user,
    );

    const all = await service.list(ctx.estateId, {}, ctx.user);
    expect(all.total).toBe(2);
    expect(
      (
        await service.list(ctx.estateId, { sourceType: 'treasury' }, ctx.user)
      ).items.map((e) => e.id),
    ).toEqual([quick.id]);
    expect(
      (await service.list(ctx.estateId, { q: 'gasoil' }, ctx.user)).total,
    ).toBe(1);
    expect(
      (
        await service.list(
          ctx.estateId,
          { accountId: await ctx.account('700') },
          ctx.user,
        )
      ).total,
    ).toBe(1);
    expect(
      (await service.list(ctx.estateId, { pageSize: 1, page: 2 }, ctx.user))
        .items,
    ).toHaveLength(1);

    const receiptEntry = all.items.find(
      (e) => e.sourceType === 'receipt_issue',
    )!;
    expect(receiptEntry.canReverse).toBe(false);
    await expect(
      service.reverse(receiptEntry.id, { reason: 'Error' }, ctx.user),
    ).rejects.toThrow(/desde su documento/);

    const reversal = await service.reverse(
      quick.id,
      { reason: 'Registrado dos veces', date: '2026-03-02' },
      ctx.user,
    );
    expect(reversal.reverses?.id).toBe(quick.id);
    expect(await balanceOf(ctx.estateId, '628')).toBe('0.00');
    await expect(
      service.reverse(reversal.id, { reason: 'Otra vez' }, ctx.user),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reverse(quick.id, { reason: 'Otra vez' }, ctx.user),
    ).rejects.toThrow(/ya está revertido/);
    expect((await service.detail(quick.id, ctx.user)).canReverse).toBe(false);
  });

  it('adjunta un justificante y lo devuelve', async () => {
    const ctx = await freshEstate();
    const entry = await service.quickEntry(
      ctx.estateId,
      {
        date: '2026-03-01',
        direction: 'out',
        amount: 40,
        bankAccountId: ctx.bankId,
        counterpartAccountId: await ctx.account('628'),
        concept: 'Gasoil',
      },
      ctx.user,
    );
    const withFile = await service.attach(
      entry.id,
      {
        originalname: 'ticket.pdf',
        mimetype: 'application/pdf',
        size: 8,
        buffer: Buffer.from('%PDF-1.4'),
      },
      ctx.user,
    );
    expect(withFile.attachments).toHaveLength(1);
    const file = await service.attachmentContent(
      entry.id,
      withFile.attachments[0].id,
      ctx.user,
    );
    expect(file.content.toString()).toBe('%PDF-1.4');
    await expect(service.detail(entry.id, roleB(admin, []))).rejects.toThrow();
  });
});
