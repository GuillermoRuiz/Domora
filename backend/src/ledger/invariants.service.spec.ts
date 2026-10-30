import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { JournalService } from './journal/journal.service';
import { CollectionPostingService } from './posting/collection-posting.service';
import { ReceiptPostingService } from './posting/receipt-posting.service';
import { SupplierPostingService } from './posting/supplier-posting.service';
import { LedgerQueryService } from './ledger-query.service';
import { InvariantsService } from './invariants.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Invariantes de fase 13 (doc/contabilidad/roadmap-partida-doble.md,
 * §Invariantes) contra Postgres real. Las invariantes 1 y 6 ya las prueba
 * cada spec de fase anterior indirectamente (llaman a `check()` como red de
 * seguridad); acá se prueban las nuevas. 2 y 4 solo por su camino sano: un
 * intento real de forzarlas con SQL crudo (`UPDATE receipts/supplier_invoices
 * SET outstanding = ...`) confirmó que el trigger diferido DM031/DM051
 * relee la fila al confirmar la transacción y aborta el commit — no hay
 * ningún estado inválido que construir. 3 sí se puede probar por su camino
 * sano (un anticipo real no dispara nada). 5, 7 y 8 son avisos de negocio,
 * no garantías de la base de datos, así que se prueban con escenarios reales
 * en los dos sentidos (cuando avisan y cuando no).
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const journal = new JournalService();
const receiptPosting = new ReceiptPostingService(journal);
const collectionPosting = new CollectionPostingService(journal, receiptPosting);
const supplierPosting = new SupplierPostingService(journal);
const query = new LedgerQueryService(db);
const invariants = new InvariantsService(db, query);

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

beforeAll(async () => {
  admin = await createAdministrator(prisma, { name: 'Gestora invariantes' });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

async function freshEstate(): Promise<string> {
  return createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
}

describe('InvariantsService — errores duros (2, 3, 4)', () => {
  it('una finca sana con un recibo pagado no dispara ningún error', async () => {
    const estateId = await freshEstate();
    const propertyId = await createProperty(prisma, estateId);
    await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
      status: 'Pagada',
    });

    expect(await invariants.check(estateId)).toEqual([]);
  });

  // Las invariantes 2 y 4 (ver el comentario de clase en invariants.service.ts)
  // están confirmadas imposibles de violar hoy: el trigger diferido
  // DM031/DM051 relee la fila entera al confirmar y rechaza cualquier
  // `outstanding` que no cuadre con la partida abierta real, incluso por SQL
  // crudo fuera de `JournalService` — se intentó a propósito (ver el commit
  // de esta spec) y la propia base de datos abortó la transacción antes de
  // que hubiera nada que comprobar. Quedan cubiertas aquí solo por su
  // camino sano (recibo pagado arriba, factura registrada abajo).

  it('3. un anticipo (430 sin recibo) con saldo a favor del propietario NO es un error', async () => {
    const estateId = await freshEstate();
    const propertyId = await createProperty(prisma, estateId);
    const receipt = await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
    });
    // Cobra de más a propósito: el exceso queda como anticipo (430 {P} sin
    // recibo, saldo ACREEDOR) — el caso sano que la invariante 3 no debe tocar.
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId,
        propertyId,
        date: receipt.accrualDate,
        amount: 15000,
        method: 'Transferencia',
        receiptIds: [receipt.id],
      }),
    );

    expect(await invariants.check(estateId)).toEqual([]);
  });

  it('4. una factura registrada y sin pagar no dispara ningún error', async () => {
    const estateId = await freshEstate();
    const supplierId = (
      await prisma.supplier.create({
        data: {
          name: 'Proveedor de prueba',
          category: 'Mantenimiento',
          estateId,
          administratorId: admin.administratorId,
        },
      })
    ).id;
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '623' },
    });
    await prisma.$transaction((tx) =>
      supplierPosting.registerInvoice(tx, {
        estateId,
        supplierId,
        number: 'F-1',
        concept: 'Reparación',
        issueDate: D('2026-03-10'),
        receivedDate: D('2026-03-10'),
        vatRatePct: 21,
        withholdingRatePct: 0,
        lines: [{ accountId: account.id, base: 100000 }],
      }),
    );

    expect(await invariants.check(estateId)).toEqual([]);
  });
});

describe('InvariantsService — avisos (5, 7, 8)', () => {
  it('5. un extracto bancario que no cuadra con el diario avisa, sin bloquear', async () => {
    const estateId = await freshEstate();
    const bank = await prisma.bankAccount.findFirstOrThrow({
      where: { estateId, isDefault: true },
    });
    await prisma.bankStatement.create({
      data: {
        estateId,
        bankAccountId: bank.id,
        fileName: 'extracto.csv',
        fileHash: `hash-${bank.id}`,
        format: 'csv',
        entriesCount: 0,
        closingBalance: '500.00',
      },
    });

    const issues = await invariants.checkWarnings(estateId);
    expect(issues).toContainEqual(
      expect.objectContaining({
        check: 'bank_reconciliation',
        severity: 'warning',
      }),
    );
    // Nunca en `check()`: es un aviso, no debe romper la red de seguridad de otras specs.
    expect(await invariants.check(estateId)).toEqual([]);
  });

  it('5. si lo pendiente de conciliar explica la diferencia, no avisa', async () => {
    const estateId = await freshEstate();
    const propertyId = await createProperty(prisma, estateId);
    await issueTestReceipt(prisma, {
      estateId,
      propertyId,
      periodKey: '2026-03',
      amount: '100.00',
      status: 'Pagada',
    });
    const bank = await prisma.bankAccount.findFirstOrThrow({
      where: { estateId, isDefault: true },
    });
    const statement = await prisma.bankStatement.create({
      data: {
        estateId,
        bankAccountId: bank.id,
        fileName: 'extracto.csv',
        fileHash: `hash-${bank.id}`,
        format: 'csv',
        entriesCount: 1,
        closingBalance: '150.00',
      },
    });
    // El diario ya tiene 100€ (el cobro); el extracto dice 150€ — la
    // diferencia (50€) la explica un apunte todavía sin conciliar.
    await prisma.bankExtractEntry.create({
      data: {
        estateId,
        bankAccountId: bank.id,
        statementId: statement.id,
        date: D('2026-03-05'),
        concept: 'Transferencia recibida',
        amount: '50.00',
      },
    });

    expect(await invariants.checkWarnings(estateId)).toEqual([]);
  });

  it('7. reserva por debajo del 10% del presupuesto ordinario avisa', async () => {
    const estateId = await freshEstate();
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '622' },
    });
    await prisma.budgetItem.create({
      data: {
        estateId,
        accountId: account.id,
        category: 'Ordinario',
        fiscalYear: new Date().getFullYear(),
        budgeted: '10000.00',
      },
    });

    const issues = await invariants.checkWarnings(estateId);
    expect(issues).toContainEqual(
      expect.objectContaining({
        check: 'reserve_minimum',
        severity: 'warning',
      }),
    );
  });

  it('7. sin presupuesto cargado, no afirma nada sobre la reserva', async () => {
    const estateId = await freshEstate();
    expect(await invariants.checkWarnings(estateId)).toEqual([]);
  });

  it('8. dinero sin identificar en la 555 avisa', async () => {
    const estateId = await freshEstate();
    await prisma.$transaction((tx) =>
      collectionPosting.registerSuspense(tx, {
        estateId,
        date: D('2026-03-01'),
        amount: 5000,
        concept: 'Transferencia sin referencia',
      }),
    );

    const issues = await invariants.checkWarnings(estateId);
    expect(issues).toContainEqual(
      expect.objectContaining({
        check: 'suspense_pending',
        severity: 'warning',
      }),
    );
  });
});
