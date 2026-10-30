import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { JournalService } from '../journal/journal.service';
import { parseLedgerDbError } from '../journal/journal-db-errors';
import { TreasuryPostingService } from '../posting/treasury-posting.service';
import { ReconciliationService } from './reconciliation.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Conciliación bancaria sobre el diario (fase 8b) contra Postgres real.
 * Los ficheros Norma 43 se generan aquí con las posiciones que verifica
 * norma43-parser.util.spec.ts contra un fichero real.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const treasury = new TreasuryPostingService(new JournalService());
const service = new ReconciliationService(db, new EstateAccessService());

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  bankId: string;
  user: AuthenticatedUser;
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
    bankId: bank.id,
    user: roleB(admin, [estateId]),
    account: async (code: string) =>
      (
        await prisma.chartAccount.findFirstOrThrow({
          where: { estateId, code },
        })
      ).id,
  };
}

/** Apunte de tesorería: positivo entra dinero, negativo sale. */
async function quick(ctx: Ctx, date: string, euros: number, code: string) {
  const counterpartAccountId = await ctx.account(code);
  return prisma.$transaction((tx) =>
    treasury.quickEntry(tx, {
      estateId: ctx.estateId,
      date: D(date),
      direction: euros > 0 ? 'in' : 'out',
      amount: Math.round(Math.abs(euros) * 100),
      place: { bankAccountId: ctx.bankId },
      counterpartAccountId,
      concept: `Apunte ${date}`,
    }),
  );
}

const yymmdd = (iso: string) =>
  iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const amt = (euros: number) =>
  String(Math.round(Math.abs(euros) * 100)).padStart(14, '0');

function norma43(
  opening: number,
  rows: { date: string; amount: number; concept: string }[],
  from: string,
  to: string,
): Buffer {
  const lines = [
    `11111122223333444412${yymmdd(from)}${yymmdd(to)}${opening < 0 ? '1' : '2'}${amt(opening)}9783COMUNIDAD DE PRUEBA`,
  ];
  for (const r of rows) {
    lines.push(
      `22    2222${yymmdd(r.date)}${yymmdd(r.date)}12408${r.amount < 0 ? '1' : '2'}${amt(r.amount)}0000000000`,
    );
    lines.push(`2301${r.concept}`);
  }
  const debits = rows.filter((r) => r.amount < 0);
  const credits = rows.filter((r) => r.amount > 0);
  const closing = opening + rows.reduce((s, r) => s + r.amount, 0);
  lines.push(
    '33' +
      '1111' +
      '2222' +
      '3333444412' +
      String(debits.length).padStart(5, '0') +
      amt(debits.reduce((s, r) => s + r.amount, 0)) +
      String(credits.length).padStart(5, '0') +
      amt(credits.reduce((s, r) => s + r.amount, 0)) +
      (closing < 0 ? '1' : '2') +
      amt(closing) +
      '978',
  );
  return Buffer.from(lines.join('\n'), 'latin1');
}

const n43File = (buffer: Buffer, name = 'extracto.n43') => ({
  originalname: name,
  size: buffer.length,
  buffer,
});

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (conciliación)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Extracto y conciliación', () => {
  it('importa el Norma 43 con sus saldos, no lo repite, y concilia lo evidente', async () => {
    const ctx = await freshEstate();
    await quick(ctx, '2026-03-01', 300, '752');
    await quick(ctx, '2026-03-05', -40, '628');
    await quick(ctx, '2026-03-20', -40, '628');

    const file = norma43(
      0,
      [
        { date: '2026-03-02', amount: 300, concept: 'TRANSF ALQUILER GARAJE' },
        { date: '2026-03-06', amount: -40, concept: 'RECIBO GASOLEOS' },
        { date: '2026-03-10', amount: -12, concept: 'COMISION MANTENIMIENTO' },
      ],
      '2026-03-01',
      '2026-03-15',
    );
    const imported = await service.importStatement(
      ctx.estateId,
      ctx.bankId,
      n43File(file),
      ctx.user,
    );
    expect(imported).toMatchObject({
      imported: 3,
      skippedDuplicates: 0,
      openingBalance: 0,
      closingBalance: 248,
      warnings: [],
    });
    await expect(
      service.importStatement(
        ctx.estateId,
        ctx.bankId,
        n43File(file),
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const auto = await service.autoMatch(ctx.estateId, ctx.bankId, ctx.user);
    // 300 con 300; el cargo de 40 del 06/03 con el apunte del 05/03 (el del 20/03 está a más de 10 días).
    expect(auto).toEqual({ matched: 2, pendingEntries: 1, pendingLines: 1 });

    const ledger = await service.ledger(ctx.estateId, ctx.bankId, {}, ctx.user);
    expect(ledger.closingBalance).toBe(220);
    expect(
      ledger.lines.map((l) => [
        l.date,
        l.amount,
        l.balance,
        Boolean(l.reconciliationGroupId),
      ]),
    ).toEqual([
      ['2026-03-01', 300, 300, true],
      ['2026-03-05', -40, 260, true],
      ['2026-03-20', -40, 220, false],
    ]);
    expect(ledger.lines[0].counterparts[0]).toMatch(/^752/);

    const statement = await service.statement(
      ctx.estateId,
      ctx.bankId,
      { pending: true },
      ctx.user,
    );
    expect(statement.entries.map((e) => e.concept)).toEqual([
      'COMISION MANTENIMIENTO',
    ]);
    expect(statement.lastStatement?.closingBalance).toBe(248);
  });

  it('concilia a mano lo que suma lo mismo (varias partidas contra una línea) y se puede deshacer', async () => {
    const ctx = await freshEstate();
    const entry = await quick(ctx, '2026-03-05', 100, '752');
    const csv = Buffer.from(
      'Fecha;Concepto;Importe\n05/03/2026;INGRESO 1;50,00\n05/03/2026;INGRESO 2;50,00\n07/03/2026;OTRO;-9,99\n',
      'utf8',
    );
    await service.importStatement(
      ctx.estateId,
      ctx.bankId,
      { originalname: 'extracto.csv', size: csv.length, buffer: csv },
      ctx.user,
    );
    const { entries } = await service.statement(
      ctx.estateId,
      ctx.bankId,
      {},
      ctx.user,
    );
    const [e1, e2] = entries.filter((e) => e.amount === 50).map((e) => e.id);
    const other = entries.find((e) => e.amount === -9.99)!.id;
    const lineId = (
      await prisma.journalLine.findFirstOrThrow({
        where: { entryId: entry.id, debit: { gt: 0 } },
      })
    ).id;

    await expect(
      service.match(
        ctx.estateId,
        ctx.bankId,
        { entryIds: [e1], lineIds: [lineId] },
        ctx.user,
      ),
    ).rejects.toThrow(/No suman lo mismo/);
    const { groupId } = await service.match(
      ctx.estateId,
      ctx.bankId,
      { entryIds: [e1, e2], lineIds: [lineId] },
      ctx.user,
    );
    await expect(
      service.match(
        ctx.estateId,
        ctx.bankId,
        { entryIds: [other], lineIds: [lineId] },
        ctx.user,
      ),
    ).rejects.toThrow(/ya está conciliada/);

    await service.unmatch(groupId, ctx.user);
    expect(
      (
        await service.statement(
          ctx.estateId,
          ctx.bankId,
          { pending: true },
          ctx.user,
        )
      ).entries,
    ).toHaveLength(3);
    expect(
      (await service.ledger(ctx.estateId, ctx.bankId, {}, ctx.user)).lines[0]
        .reconciliationGroupId,
    ).toBeNull();
  });

  it('un extracto que se solapa con otro no repite partidas; el saldo inicial del rango arrastra lo anterior', async () => {
    const ctx = await freshEstate();
    await quick(ctx, '2026-02-10', 1000, '752');
    await quick(ctx, '2026-03-10', -100, '628');
    await service.importStatement(
      ctx.estateId,
      ctx.bankId,
      n43File(
        norma43(
          0,
          [{ date: '2026-02-10', amount: 1000, concept: 'A' }],
          '2026-02-01',
          '2026-02-28',
        ),
        'feb.n43',
      ),
      ctx.user,
    );
    const second = await service.importStatement(
      ctx.estateId,
      ctx.bankId,
      n43File(
        norma43(
          0,
          [
            { date: '2026-02-10', amount: 1000, concept: 'A' },
            { date: '2026-03-10', amount: -100, concept: 'B' },
          ],
          '2026-02-01',
          '2026-03-31',
        ),
        'feb-mar.n43',
      ),
      ctx.user,
    );
    expect(second).toMatchObject({ imported: 1, skippedDuplicates: 1 });

    const march = await service.ledger(
      ctx.estateId,
      ctx.bankId,
      { from: '2026-03-01' },
      ctx.user,
    );
    expect(march.openingBalance).toBe(1000);
    expect(march.lines.map((l) => l.balance)).toEqual([900]);
  });

  it('rechaza formatos desconocidos, cuentas de otra finca y a otra gestora', async () => {
    const ctx = await freshEstate();
    const other = await freshEstate();
    await expect(
      service.importStatement(
        ctx.estateId,
        ctx.bankId,
        { originalname: 'x.pdf', size: 3, buffer: Buffer.from('pdf') },
        ctx.user,
      ),
    ).rejects.toThrow(/Formato no admitido/);
    await expect(
      service.ledger(ctx.estateId, other.bankId, {}, ctx.user),
    ).rejects.toThrow(/no existe en esta finca/);
    await expect(
      service.ledger(ctx.estateId, ctx.bankId, {}, roleB(admin, [])),
    ).rejects.toThrow();
  });

  it('la base de datos no deja conciliar líneas de otra cuenta ni importes que no cuadran (DM080)', async () => {
    const ctx = await freshEstate();
    const entry = await quick(ctx, '2026-03-05', -20, '626');
    const csv = Buffer.from(
      'Fecha;Concepto;Importe\n05/03/2026;COMISION;-20,00\n',
      'utf8',
    );
    await service.importStatement(
      ctx.estateId,
      ctx.bankId,
      { originalname: 'e.csv', size: csv.length, buffer: csv },
      ctx.user,
    );
    const extractId = (
      await service.statement(ctx.estateId, ctx.bankId, {}, ctx.user)
    ).entries[0].id;
    const expenseLine = await prisma.journalLine.findFirstOrThrow({
      where: { entryId: entry.id, debit: { gt: 0 } },
    });

    let error: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        const g = await tx.reconciliationGroup.create({
          data: {
            estateId: ctx.estateId,
            bankAccountId: ctx.bankId,
            method: 'manual',
          },
        });
        await tx.reconciliationLine.create({
          data: { groupId: g.id, journalLineId: expenseLine.id },
        });
        await tx.bankExtractEntry.update({
          where: { id: extractId },
          data: { reconciliationGroupId: g.id },
        });
      });
    } catch (e) {
      error = e;
    }
    expect(parseLedgerDbError(error)?.code).toBe('DM080');
  });
});
