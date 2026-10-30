import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { JournalService } from './journal/journal.service';
import { parseLedgerDbError, runPosting } from './journal/journal-db-errors';
import { InvariantsService } from './invariants.service';
import { LedgerQueryService } from './ledger-query.service';
import type { EntryDraft } from './posting/posting.types';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createEstate,
  createLedgerEstate,
  createProperty,
  createSupplier,
  issueTestReceipt,
  purgeAdministrator,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Garantías del libro diario en la BASE DE DATOS (migración ledger_core).
 *
 * Casi todos los tests saltan a propósito la validación de la aplicación y
 * escriben directamente con Prisma: lo que se comprueba es que, aunque un
 * servicio tuviera un fallo, PostgreSQL no dejaría pasar un asiento
 * descuadrado, una línea editada o una cuenta de otra finca.
 */
jest.setTimeout(60_000);

const prisma = createPrismaClient();
const journal = new JournalService();
const query = new LedgerQueryService(prisma as unknown as PrismaService);
const invariants = new InvariantsService(
  prisma as unknown as PrismaService,
  query,
);

const CUTOVER = new Date(Date.UTC(2026, 0, 1));
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

let admin: AdministratorFixture;
let estateId: string;
let otherEstateId: string;
let propertyId: string;
let otherPropertyId: string;
let supplierId: string;
let costCentreId: string;
let receiptId: string;
const acc: Record<string, string> = {};
let otherEstate430: string;

async function accountId(estate: string, code: string): Promise<string> {
  const a = await prisma.chartAccount.findUniqueOrThrow({
    where: { estateId_code: { estateId: estate, code } },
    select: { id: true },
  });
  return a.id;
}

/** Captura el error de una promesa que debe fallar. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error y la operación se completó.');
}

async function expectDbCode(
  promise: Promise<unknown>,
  code: string,
): Promise<string> {
  const error = await failure(promise);
  const parsed = parseLedgerDbError(error);
  expect(parsed?.code).toBe(code);
  return parsed!.message;
}

let rawNumber = 5000;
interface RawLine {
  accountId: string;
  debit?: string;
  credit?: string;
  propertyId?: string;
  supplierId?: string;
  costCentreId?: string;
  receiptId?: string;
  date?: Date;
  estateId?: string;
}

/**
 * Inserta un asiento saltándose `JournalService`: sin validación de la
 * aplicación, con el número que se le dé. Solo para probar la base de datos.
 */
function rawEntry(
  tx: Prisma.TransactionClient,
  opts: {
    date?: Date;
    entryType?: 'opening' | 'standard';
    reversesEntryId?: string;
    lines: RawLine[];
    estate?: string;
  },
) {
  const date = opts.date ?? D('2026-03-10');
  const estate = opts.estate ?? estateId;
  return tx.journalEntry.create({
    data: {
      estateId: estate,
      fiscalYear: date.getUTCFullYear(),
      number: ++rawNumber,
      date,
      entryType: opts.entryType ?? 'standard',
      sourceType: 'manual',
      concept: 'Asiento de prueba',
      reversesEntryId: opts.reversesEntryId,
      lines: {
        createMany: {
          data: opts.lines.map((l, i) => ({
            lineNo: i + 1,
            estateId: l.estateId ?? estate,
            date: l.date ?? date,
            fiscalYear: date.getUTCFullYear(),
            entryType: opts.entryType ?? 'standard',
            accountId: l.accountId,
            debit: l.debit ?? '0',
            credit: l.credit ?? '0',
            propertyId: l.propertyId,
            supplierId: l.supplierId,
            costCentreId: l.costCentreId,
            receiptId: l.receiptId,
          })),
        },
      },
    },
    select: { id: true, number: true },
  });
}

function rawCommit(opts: Parameters<typeof rawEntry>[1]) {
  return prisma.$transaction((tx) => rawEntry(tx, opts));
}

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    estateId,
    date: D('2026-03-10'),
    sourceType: 'manual',
    concept: 'Comisión bancaria',
    lines: [
      { account: { role: 'bank_fees' }, debit: 250 },
      { account: { role: 'bank' }, credit: 250 },
    ],
    ...overrides,
  };
}

function post(d: EntryDraft) {
  return runPosting(prisma, (tx) => journal.post(tx, d));
}

/** Como `post`, pero sin traducir el error: para leer el código de la BD. */
function postUntranslated(d: EntryDraft) {
  return prisma.$transaction((tx) => journal.post(tx, d));
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (garantías del diario)',
  });
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: CUTOVER,
  });
  otherEstateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: CUTOVER,
  });
  propertyId = await createProperty(prisma, estateId);
  otherPropertyId = await createProperty(prisma, otherEstateId);
  supplierId = await createSupplier(prisma, estateId, admin.administratorId);
  costCentreId = (
    await prisma.costCentre.create({
      data: {
        estateId,
        administratorId: admin.administratorId,
        name: 'Piscina',
      },
    })
  ).id;
  // Recibo emitido por la vía contable: la base de datos no admite otro.
  receiptId = (
    await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    })
  ).id;

  for (const code of ['430', '572', '626', '700', '400', '555']) {
    acc[code] = await accountId(estateId, code);
  }
  const bank = await prisma.bankAccount.findFirstOrThrow({
    where: { estateId, isDefault: true },
    select: { chartAccountId: true },
  });
  acc.bank = bank.chartAccountId;
  otherEstate430 = await accountId(otherEstateId, '430');

  // Primer asiento válido: crea el ejercicio 2026 para los inserts directos.
  await post(draft());
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Cuadre del asiento (se comprueba al confirmar la transacción)', () => {
  it('un asiento descuadrado no se confirma (DM002)', async () => {
    const message = await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '10.00' },
          { accountId: acc.bank, credit: '9.99' },
        ],
      }),
      'DM002',
    );
    expect(message).toMatch(/no cuadra/);
  });

  it('un asiento de una sola línea no se confirma (DM001)', async () => {
    await expectDbCode(
      rawCommit({ lines: [{ accountId: acc['626'], debit: '10.00' }] }),
      'DM001',
    );
  });

  it('una línea con debe y haber a la vez la rechaza el CHECK', async () => {
    const error = await failure(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '10.00', credit: '10.00' },
          { accountId: acc.bank, credit: '0.00' },
        ],
      }),
    );
    expect(String(error)).toMatch(/journal_lines_one_side_chk/);
  });

  it('un asiento rechazado no deja nada escrito', async () => {
    const before = await prisma.journalEntry.count({ where: { estateId } });
    await failure(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '1.00' },
          { accountId: acc.bank, credit: '2.00' },
        ],
      }),
    );
    expect(await prisma.journalEntry.count({ where: { estateId } })).toBe(
      before,
    );
  });
});

describe('Inmutabilidad', () => {
  it('no se puede modificar una línea contabilizada (DM020)', async () => {
    const line = await prisma.journalLine.findFirstOrThrow({
      where: { estateId },
      select: { id: true },
    });
    await expectDbCode(
      prisma.journalLine.update({
        where: { id: line.id },
        data: { debit: '999.00' },
      }),
      'DM020',
    );
  });

  it('no se puede borrar un asiento ni sus líneas (DM020)', async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { estateId },
      select: { id: true },
    });
    await expectDbCode(
      prisma.journalEntry.delete({ where: { id: entry.id } }),
      'DM020',
    );
    await expectDbCode(
      prisma.journalLine.deleteMany({ where: { entryId: entry.id } }),
      'DM020',
    );
  });

  it('no se puede vaciar la tabla con TRUNCATE, ni en cascada (DM020)', async () => {
    // Sin CASCADE ya lo impide la clave foránea de la conciliación; con
    // CASCADE esa clave no para, y tiene que pararlo la garantía.
    await expectDbCode(
      prisma.$executeRawUnsafe('TRUNCATE "journal_lines" CASCADE'),
      'DM020',
    );
  });

  it('no se pueden añadir líneas a un asiento ya confirmado (DM003)', async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { estateId },
      select: { id: true, date: true, fiscalYear: true },
    });
    await expectDbCode(
      prisma.$transaction(async (tx) => {
        await tx.journalLine.createMany({
          data: [
            {
              entryId: entry.id,
              lineNo: 90,
              estateId,
              date: entry.date,
              fiscalYear: entry.fiscalYear,
              entryType: 'standard',
              accountId: acc['626'],
              debit: '5.00',
            },
            {
              entryId: entry.id,
              lineNo: 91,
              estateId,
              date: entry.date,
              fiscalYear: entry.fiscalYear,
              entryType: 'standard',
              accountId: acc.bank,
              credit: '5.00',
            },
          ],
        });
      }),
      'DM003',
    );
  });

  it('la línea hereda finca y fecha del asiento aunque se le pasen otras', async () => {
    const entry = await rawCommit({
      lines: [
        { accountId: acc['626'], debit: '1.00', date: D('2030-01-01') },
        { accountId: acc.bank, credit: '1.00', date: D('2030-01-01') },
      ],
    });
    const lines = await prisma.journalLine.findMany({
      where: { entryId: entry.id },
      select: { date: true },
    });
    expect(
      lines.every((l) => l.date.toISOString().startsWith('2026-03-10')),
    ).toBe(true);
  });
});

describe('Fecha de corte y ejercicio', () => {
  it('no admite asientos anteriores a la fecha de corte (DM012)', async () => {
    const message = await expectDbCode(
      postUntranslated(draft({ date: D('2025-12-31') })),
      'DM012',
    );
    expect(message).toMatch(/anterior a la fecha de inicio contable/);
  });

  it('la apertura va exactamente en la fecha de corte (DM013)', async () => {
    await expectDbCode(
      postUntranslated(draft({ entryType: 'opening', date: D('2026-01-02') })),
      'DM013',
    );
  });

  it('sin configuración contable no se contabiliza nada (DM011)', async () => {
    const bare = await createEstate(prisma, admin.administratorId);
    await prisma.fiscalYear.create({
      data: {
        estateId: bare,
        year: 2026,
        startDate: D('2026-01-01'),
        endDate: D('2026-12-31'),
      },
    });
    const a = await prisma.chartAccount.create({
      data: {
        estateId: bare,
        administratorId: admin.administratorId,
        code: '626',
        name: 'Bancos',
        nature: 'expense',
      },
    });
    const b = await prisma.chartAccount.create({
      data: {
        estateId: bare,
        administratorId: admin.administratorId,
        code: '5720001',
        name: 'Banco',
        nature: 'asset',
      },
    });
    await expectDbCode(
      rawCommit({
        estate: bare,
        lines: [
          { accountId: a.id, debit: '1.00' },
          { accountId: b.id, credit: '1.00' },
        ],
      }),
      'DM011',
    );
  });

  it('sin fila de ejercicio no entra el asiento (DM014)', async () => {
    await expectDbCode(
      rawCommit({
        date: D('2027-02-01'),
        lines: [
          { accountId: acc['626'], debit: '1.00' },
          { accountId: acc.bank, credit: '1.00' },
        ],
      }),
      'DM014',
    );
  });

  it('un ejercicio cerrado no admite asientos (DM015, se traduce a 409)', async () => {
    await post(draft({ date: D('2028-05-05') })); // crea el ejercicio 2028
    await prisma.fiscalYear.update({
      where: { estateId_year: { estateId, year: 2028 } },
      data: { status: 'Cerrado', closedAt: new Date() },
    });
    const error = await failure(post(draft({ date: D('2028-06-01') })));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toMatch(/2028 está cerrado/);
  });

  it('un cierre simultáneo nunca deja pasar un asiento en el año que se cierra', async () => {
    await post(draft({ date: D('2029-01-15') })); // crea el ejercicio 2029
    let releaseClose!: () => void;
    const closeHeld = new Promise<void>((r) => (releaseClose = r));
    let closed!: () => void;
    const closeStarted = new Promise<void>((r) => (closed = r));

    // Transacción A: cierra el ejercicio y mantiene el bloqueo un momento.
    const closing = prisma.$transaction(
      async (tx) => {
        await tx.fiscalYear.update({
          where: { estateId_year: { estateId, year: 2029 } },
          data: { status: 'Cerrado', closedAt: new Date() },
        });
        closed();
        await closeHeld;
      },
      { timeout: 20_000 },
    );
    await closeStarted;

    // Transacción B: intenta contabilizar en ese año mientras A no confirma.
    const posting = post(draft({ date: D('2029-02-01') }));
    await new Promise((r) => setTimeout(r, 300));
    releaseClose();
    await closing;

    const error = await failure(posting);
    expect(error).toBeInstanceOf(ConflictException);
  });
});

describe('Cuentas y dimensiones', () => {
  it('la 430 exige propiedad (DM006)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['430'], debit: '1.00' },
          { accountId: acc['700'], credit: '1.00' },
        ],
      }),
      'DM006',
    );
  });

  it('una propiedad de otra finca no vale (DM007)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['430'], debit: '1.00', propertyId: otherPropertyId },
          { accountId: acc['700'], credit: '1.00' },
        ],
      }),
      'DM007',
    );
  });

  it('una cuenta de otra finca no vale (DM004)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: otherEstate430, debit: '1.00', propertyId },
          { accountId: acc['700'], credit: '1.00' },
        ],
      }),
      'DM004',
    );
  });

  it('la 572 agrupadora no admite apuntes: van a la subcuenta del banco (DM005)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '1.00' },
          { accountId: acc['572'], credit: '1.00' },
        ],
      }),
      'DM005',
    );
  });

  it('la 400 exige proveedor y la 626 no lo admite (DM008)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '1.00' },
          { accountId: acc['400'], credit: '1.00' },
        ],
      }),
      'DM008',
    );
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '1.00', supplierId },
          { accountId: acc.bank, credit: '1.00' },
        ],
      }),
      'DM008',
    );
  });

  it('un recibo solo puede ir en la 430 y de su misma propiedad (DM009)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc.bank, debit: '1.00', receiptId },
          { accountId: acc['700'], credit: '1.00' },
        ],
      }),
      'DM009',
    );
    const other = await createProperty(prisma, estateId);
    await expectDbCode(
      rawCommit({
        lines: [
          {
            accountId: acc['430'],
            debit: '1.00',
            propertyId: other,
            receiptId,
          },
          { accountId: acc['700'], credit: '1.00' },
        ],
      }),
      'DM009',
    );
  });

  it('el centro de coste solo va en gastos e ingresos (DM010)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['626'], debit: '1.00', costCentreId },
          { accountId: acc.bank, credit: '1.00', costCentreId },
        ],
      }),
      'DM010',
    );
  });

  it('una línea de la 430 con su propiedad y sin recibo (un anticipo) sí entra', async () => {
    const entry = await rawCommit({
      lines: [
        { accountId: acc.bank, debit: '100.00' },
        { accountId: acc['430'], credit: '100.00', propertyId },
      ],
    });
    expect(entry.id).toBeDefined();
  });

  it('un segundo cargo en la 430 de un recibo ya emitido no se confirma (DM030)', async () => {
    await expectDbCode(
      rawCommit({
        lines: [
          { accountId: acc['430'], debit: '100.00', propertyId, receiptId },
          { accountId: acc['700'], credit: '100.00', costCentreId },
        ],
      }),
      'DM030',
    );
  });
});

describe('Contraasientos', () => {
  it('reverse() genera el espejo exacto y deja el saldo a cero', async () => {
    const original = await post(
      draft({
        date: D('2026-04-01'),
        concept: 'Cuota abril',
        lines: [
          { account: { role: 'owners_receivable' }, debit: 5000, propertyId },
          { account: { role: 'income_ordinary' }, credit: 5000, costCentreId },
        ],
      }),
    );
    const reversal = await runPosting(prisma, (tx) =>
      journal.reverse(tx, original.id, { date: D('2026-04-02') }),
    );
    const net = await prisma.journalLine.aggregate({
      where: {
        entryId: { in: [original.id, reversal.id] },
        accountId: acc['430'],
      },
      _sum: { debit: true, credit: true },
    });
    expect(net._sum.debit!.minus(net._sum.credit!).toString()).toBe('0');
  });

  it('un asiento no se puede revertir dos veces', async () => {
    const original = await post(draft({ date: D('2026-04-03') }));
    await runPosting(prisma, (tx) =>
      journal.reverse(tx, original.id, { date: D('2026-04-03') }),
    );
    const error = await failure(
      runPosting(prisma, (tx) =>
        journal.reverse(tx, original.id, { date: D('2026-04-04') }),
      ),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
  });

  it('un contraasiento no se puede revertir (DM016)', async () => {
    const original = await post(draft({ date: D('2026-04-05') }));
    const reversal = await runPosting(prisma, (tx) =>
      journal.reverse(tx, original.id, { date: D('2026-04-05') }),
    );
    const message = (
      (await failure(
        runPosting(prisma, (tx) =>
          journal.reverse(tx, reversal.id, { date: D('2026-04-06') }),
        ),
      )) as Error
    ).message;
    expect(message).toMatch(/contraasiento no se puede revertir/);
  });

  it('un "contraasiento" que no es el espejo del original no se confirma (DM017)', async () => {
    const original = await post(draft({ date: D('2026-04-07') }));
    await expectDbCode(
      rawCommit({
        date: D('2026-04-07'),
        reversesEntryId: original.id,
        // Mismo importe pero otra cuenta de gasto: no es el espejo.
        lines: [
          { accountId: acc.bank, debit: '2.50' },
          { accountId: acc['700'], credit: '2.50' },
        ],
      }),
      'DM017',
    );
  });
});

describe('Numeración sin huecos', () => {
  // Finca propia: el resto de la spec inserta asientos con números a mano
  // para probar la base de datos, lo que aquí contaría como huecos.
  let numberingEstate: string;
  beforeAll(async () => {
    numberingEstate = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: CUTOVER,
    });
  });
  const inEstate = (overrides: Partial<EntryDraft> = {}) =>
    draft({ estateId: numberingEstate, ...overrides });

  it('30 asientos simultáneos quedan numerados sin huecos ni duplicados', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        post(inEstate({ date: D('2031-06-01'), concept: `Concurrente ${i}` })),
      ),
    );
    const numbers = (
      await prisma.journalEntry.findMany({
        where: { estateId: numberingEstate, fiscalYear: 2031 },
        select: { number: true },
        orderBy: { number: 'asc' },
      })
    ).map((e) => e.number);
    expect(numbers).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('un asiento que la base de datos rechaza no consume número', async () => {
    const first = await post(inEstate({ date: D('2032-03-01') }));
    // Pasa la validación de la aplicación pero la base de datos lo rechaza:
    // centro de coste en la cuenta del banco.
    const ownCentre = await prisma.costCentre.create({
      data: {
        estateId: numberingEstate,
        administratorId: admin.administratorId,
        name: 'Jardín',
      },
    });
    await failure(
      post(
        inEstate({
          date: D('2032-03-02'),
          lines: [
            { account: { role: 'bank_fees' }, debit: 100 },
            {
              account: { role: 'bank' },
              credit: 100,
              costCentreId: ownCentre.id,
            },
          ],
        }),
      ),
    );
    const next = await post(inEstate({ date: D('2032-03-03') }));
    expect(next.number).toBe(first.number + 1);
  });

  it('las comprobaciones de cuadre no encuentran incidencias', async () => {
    expect(await invariants.check(numberingEstate)).toEqual([]);
  });
});

describe('Plan de cuentas', () => {
  it('una subcuenta debe empezar por el código de su padre (DM021)', async () => {
    await expectDbCode(
      prisma.chartAccount.create({
        data: {
          estateId,
          administratorId: admin.administratorId,
          code: '6230001',
          name: 'Mal colgada',
          nature: 'expense',
          parentId: acc['626'],
        },
      }),
      'DM021',
    );
  });

  it('el grupo 7 es de ingreso y el 6 de gasto (DM021)', async () => {
    await expectDbCode(
      prisma.chartAccount.create({
        data: {
          estateId,
          administratorId: admin.administratorId,
          code: '705',
          name: 'Mal clasificada',
          nature: 'expense',
        },
      }),
      'DM021',
    );
  });

  it('una cuenta de sistema no se borra ni cambia de código (DM022)', async () => {
    await expectDbCode(
      prisma.chartAccount.delete({ where: { id: acc['555'] } }),
      'DM022',
    );
    await expectDbCode(
      prisma.chartAccount.update({
        where: { id: acc['555'] },
        data: { code: '5551' },
      }),
      'DM022',
    );
  });

  it('una cuenta propia con apuntes no se borra (DM022), sin apuntes sí', async () => {
    const own = await prisma.chartAccount.create({
      data: {
        estateId,
        administratorId: admin.administratorId,
        code: '6290001',
        name: 'Portería',
        nature: 'expense',
        parentId: await accountId(estateId, '629'),
        allowsCostCentre: true,
      },
    });
    expect(own.level).toBe(2);
    await post(
      draft({
        date: D('2026-05-01'),
        lines: [
          { account: { accountId: own.id }, debit: 100 },
          { account: { role: 'bank' }, credit: 100 },
        ],
      }),
    );
    await expectDbCode(
      prisma.chartAccount.delete({ where: { id: own.id } }),
      'DM022',
    );

    const unused = await prisma.chartAccount.create({
      data: {
        estateId,
        administratorId: admin.administratorId,
        code: '6290002',
        name: 'Sin uso',
        nature: 'expense',
      },
    });
    await prisma.chartAccount.delete({ where: { id: unused.id } });
  });
});

describe('Presencia de las garantías (un reset o un squash no debe perderlas)', () => {
  it('existen todos los triggers', async () => {
    const rows = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
    `;
    const names = rows.map((r) => r.tgname);
    expect(names).toEqual(
      expect.arrayContaining([
        'journal_entries_before_insert',
        'journal_lines_before_insert',
        'journal_entries_balanced',
        'journal_entries_immutable',
        'journal_entries_no_truncate',
        'journal_lines_immutable',
        'journal_lines_no_truncate',
        'chart_accounts_guard',
      ]),
    );
  });

  it('existen los CHECK y el trigger de cuadre es diferido', async () => {
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c'
    `;
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'journal_lines_one_side_chk',
        'journal_entries_year_chk',
        'chart_accounts_code_digits_chk',
      ]),
    );
    const deferred = await prisma.$queryRaw<
      { tgdeferrable: boolean; tginitdeferred: boolean }[]
    >`
      SELECT c.condeferrable AS tgdeferrable, c.condeferred AS tginitdeferred
        FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint
       WHERE t.tgname = 'journal_entries_balanced'
    `;
    expect(deferred).toEqual([{ tgdeferrable: true, tginitdeferred: true }]);
  });
});

describe('runPosting — errores legibles', () => {
  it('traduce un rechazo de la base de datos a 422 con el mensaje en español', async () => {
    const error = await failure(
      post(
        draft({
          lines: [
            { account: { role: 'owners_receivable' }, debit: 100 },
            { account: { role: 'income_ordinary' }, credit: 100 },
          ],
        }),
      ),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as Error).message).toBe(
      'La cuenta 430 exige indicar la propiedad.',
    );
  });
});

describe('Purga', () => {
  it('solo accounting_purge_estate() borra la contabilidad de una finca', async () => {
    const temp = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: CUTOVER,
    });
    await runPosting(prisma, (tx) =>
      journal.post(tx, { ...draft(), estateId: temp }),
    );
    await expectDbCode(
      prisma.journalEntry.deleteMany({ where: { estateId: temp } }),
      'DM020',
    );

    await prisma.$executeRaw`SELECT accounting_purge_estate(${temp}::uuid)`;
    expect(await prisma.journalEntry.count({ where: { estateId: temp } })).toBe(
      0,
    );
    expect(await prisma.chartAccount.count({ where: { estateId: temp } })).toBe(
      0,
    );
    expect(
      await prisma.accountingSettings.count({ where: { estateId: temp } }),
    ).toBe(0);

    // Fuera de la función, la bandera sigue apagada.
    const line = await prisma.journalLine.findFirstOrThrow({
      where: { estateId },
      select: { id: true },
    });
    await expectDbCode(
      prisma.journalLine.delete({ where: { id: line.id } }),
      'DM020',
    );
  });
});
