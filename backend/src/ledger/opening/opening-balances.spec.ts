import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { JournalService } from '../journal/journal.service';
import { ensureDefaultBankAccount } from '../chart/ledger-bootstrap';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { OpeningBalancesService } from './opening-balances.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Fase 9 de doc/contabilidad/roadmap-partida-doble.md: el asiento de
 * apertura. Integración contra Postgres real — es exactamente el tipo de
 * garantía (un único asiento cuadrado, la diferencia aceptada, el
 * contraasiento al corregir) que un mock de Prisma no verifica de verdad.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const estateAccess = new EstateAccessService();
const journal = new JournalService();
const service = new OpeningBalancesService(db, estateAccess, journal);

const YEAR = new Date().getFullYear();
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  bankAccountId: string;
  propertyId: string;
  supplierId: string;
  user: ReturnType<typeof roleB>;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D(`${YEAR}-01-01`),
  });
  const bankAccountId = await prisma.$transaction((tx) =>
    ensureDefaultBankAccount(tx, estateId),
  );
  const propertyId = await createProperty(prisma, estateId);
  const supplierId = await createSupplier(
    prisma,
    estateId,
    admin.administratorId,
  );
  return {
    estateId,
    bankAccountId,
    propertyId,
    supplierId,
    user: roleB(admin, [estateId]),
  };
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (saldos iniciales)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('OpeningBalancesService.get', () => {
  it('crea un borrador vacío la primera vez, y devuelve siempre el mismo después', async () => {
    const ctx = await freshEstate();
    const first = await service.get(ctx.estateId, ctx.user);
    expect(first.status).toBe('Borrador');
    expect(first.bankBalances).toEqual([]);

    const second = await service.get(ctx.estateId, ctx.user);
    expect(second.id).toBe(first.id);
  });
});

describe('OpeningBalancesService.saveDraft', () => {
  it('rechaza una cuenta bancaria, propiedad o proveedor de otra finca', async () => {
    const ctx = await freshEstate();
    const other = await freshEstate();
    await expect(
      service.saveDraft(
        ctx.estateId,
        {
          bankBalances: [{ bankAccountId: other.bankAccountId, balance: 100 }],
          propertyDebts: [],
          propertyAdvances: [],
          supplierInvoices: [],
          otherBalances: [],
        },
        ctx.user,
      ),
    ).rejects.toThrow('no pertenece a esta finca');
  });

  it('reemplaza todas las filas de una vez, y limpia la diferencia calculada antes', async () => {
    const ctx = await freshEstate();
    const view = await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 1000 }],
        propertyDebts: [
          {
            propertyId: ctx.propertyId,
            originYear: YEAR - 1,
            concept: 'Cuotas 2025 pendientes',
            amount: 200,
          },
        ],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    expect(view.bankBalances).toHaveLength(1);
    expect(view.propertyDebts[0].amount).toBe(200);
    expect(view.propertyDebts[0].originYear).toBe(YEAR - 1);
    expect(typeof view.propertyDebts[0].propertyLabel).toBe('string');
    expect(view.difference).toBeNull();
  });
});

describe('OpeningBalancesService.validate', () => {
  it('calcula debe, haber y la diferencia sin persistir ningún asiento', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 1000 }],
        propertyDebts: [
          {
            propertyId: ctx.propertyId,
            originYear: YEAR,
            concept: 'Cuotas pendientes',
            amount: 100,
          },
        ],
        propertyAdvances: [],
        supplierInvoices: [
          {
            supplierId: ctx.supplierId,
            number: 'F-1',
            concept: 'Factura pendiente',
            issueDate: `${YEAR - 1}-12-01`,
            amount: 300,
          },
        ],
        otherBalances: [],
      },
      ctx.user,
    );

    const result = await service.validate(ctx.estateId, ctx.user);
    expect(result.debit).toBe(1100);
    expect(result.credit).toBe(300);
    expect(result.difference).toBe(800);

    const entries = await prisma.journalEntry.count({
      where: { estateId: ctx.estateId },
    });
    expect(entries).toBe(0);
  });
});

describe('OpeningBalancesService.post', () => {
  it('con la diferencia sin aceptar, no contabiliza nada', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 500 }],
        propertyDebts: [],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    await expect(service.post(ctx.estateId, {}, ctx.user)).rejects.toThrow(
      'no cuadra',
    );
    expect(
      await prisma.journalEntry.count({ where: { estateId: ctx.estateId } }),
    ).toBe(0);
  });

  it('contabiliza un asiento por documento (deuda/factura) más el tronco, todos cuadrados, exactamente en cutoverDate', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 1000 }],
        propertyDebts: [
          {
            propertyId: ctx.propertyId,
            originYear: YEAR - 1,
            concept: 'Cuotas 2025',
            amount: 200,
          },
        ],
        propertyAdvances: [],
        supplierInvoices: [
          {
            supplierId: ctx.supplierId,
            number: 'F-1',
            concept: 'Factura pendiente',
            issueDate: `${YEAR - 1}-12-01`,
            amount: 300,
          },
        ],
        otherBalances: [],
      },
      ctx.user,
    );

    const posted = await service.post(
      ctx.estateId,
      { differenceRole: 'reserve_fund' },
      ctx.user,
    );
    expect(posted.status).toBe('Contabilizado');
    expect(posted.difference).toBe(900); // (1000 banco + 200 deuda) debe - 300 factura haber
    expect(posted.entryId).not.toBeNull();

    // Cada deuda y cada factura llevan su propio asiento (mismo criterio que
    // un recibo o una factura del día a día: issueEntryId/entryId son 1:1
    // con su documento) — el tronco (banco) es uno más, no el único. Los
    // tres cuadran por separado y, juntos, casan con `difference`.
    const entries = await prisma.journalEntry.findMany({
      where: { estateId: ctx.estateId, entryType: 'opening' },
      include: { lines: true },
    });
    expect(entries).toHaveLength(3);
    let debitTotal = 0;
    let creditTotal = 0;
    for (const entry of entries) {
      expect(entry.date.toISOString().slice(0, 10)).toBe(`${YEAR}-01-01`);
      const entryDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
      const entryCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(entryDebit).toBe(entryCredit); // cada asiento cuadra por sí solo
      debitTotal += entryDebit;
      creditTotal += entryCredit;
    }
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(1000 + 200 + 300); // banco + deuda + factura, cada uno contado por su propio asiento

    const receipt = await prisma.accountingReceipt.findFirstOrThrow({
      where: { estateId: ctx.estateId, kind: 'saldo_anterior' },
    });
    expect(receipt.issueEntryId).not.toBeNull();
    expect(Number(receipt.outstanding)).toBe(200);
    expect(receipt.originYear).toBe(YEAR - 1);
    expect(receipt.includeInRemesa).toBe(false);

    const invoice = await prisma.supplierInvoice.findFirstOrThrow({
      where: { estateId: ctx.estateId },
    });
    expect(Number(invoice.outstanding)).toBe(300);
    expect(invoice.status).toBe('Registrada');
    expect(invoice.entryId).not.toBeNull();
    expect(invoice.entryId).not.toBe(receipt.issueEntryId); // cada uno con el suyo
  });

  it('sin diferencia, no hace falta indicar differenceRole', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 500 }],
        propertyDebts: [],
        propertyAdvances: [
          { propertyId: ctx.propertyId, concept: 'Anticipo', amount: 500 },
        ],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    const posted = await service.post(ctx.estateId, {}, ctx.user);
    expect(posted.difference).toBe(0);
    expect(posted.differenceAccepted).toBe(false);
  });

  it('no se puede contabilizar dos veces seguidas', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 100 }],
        propertyDebts: [],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    await service.post(ctx.estateId, { differenceRole: 'retained' }, ctx.user);
    await expect(
      service.post(ctx.estateId, { differenceRole: 'retained' }, ctx.user),
    ).rejects.toThrow('No hay ningún borrador');
  });
});

describe('OpeningBalancesService.repost', () => {
  it('corrige un set ya contabilizado: revierte el asiento viejo, anula sus documentos y contabiliza el nuevo', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 1000 }],
        propertyDebts: [
          {
            propertyId: ctx.propertyId,
            originYear: YEAR,
            concept: 'Cuotas pendientes',
            amount: 1000,
          },
        ],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    const first = await service.post(
      ctx.estateId,
      { differenceRole: 'reserve_fund' },
      ctx.user,
    );
    const firstReceipt = await prisma.accountingReceipt.findFirstOrThrow({
      where: { estateId: ctx.estateId, kind: 'saldo_anterior' },
    });

    // No se puede editar directamente lo contabilizado: hace falta repost.
    await expect(service.post(ctx.estateId, {}, ctx.user)).rejects.toThrow(
      'No hay ningún borrador',
    );

    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 1000 }],
        propertyDebts: [
          {
            propertyId: ctx.propertyId,
            originYear: YEAR,
            concept: 'Cuotas pendientes (corregidas)',
            amount: 700,
          },
        ],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );

    await expect(service.post(ctx.estateId, {}, ctx.user)).rejects.toThrow(
      'corrección',
    );

    const second = await service.repost(
      ctx.estateId,
      { differenceRole: 'reserve_fund' },
      ctx.user,
    );
    expect(second.status).toBe('Contabilizado');
    expect(second.id).not.toBe(first.id);
    expect(second.propertyDebts[0].amount).toBe(700);

    const oldSet = await prisma.openingBalanceSet.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(oldSet.status).toBe('Sustituido');

    const reversedFirstEntry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: first.entryId! },
      include: { reversedBy: true },
    });
    expect(reversedFirstEntry.reversedBy).not.toBeNull();

    const oldReceipt = await prisma.accountingReceipt.findUniqueOrThrow({
      where: { id: firstReceipt.id },
    });
    expect(oldReceipt.status).toBe('Anulado');

    const newReceipt = await prisma.accountingReceipt.findFirstOrThrow({
      where: {
        estateId: ctx.estateId,
        kind: 'saldo_anterior',
        status: { not: 'Anulado' },
      },
    });
    expect(Number(newReceipt.outstanding)).toBe(700);
  });

  it('repost sin un set contabilizado que corregir se rechaza', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 100 }],
        propertyDebts: [],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    await expect(service.repost(ctx.estateId, {}, ctx.user)).rejects.toThrow(
      'no es una corrección',
    );
  });
});

describe('OpeningBalancesService.confirmNoPriorBalances', () => {
  it('marca la finca como sin saldos previos', async () => {
    const ctx = await freshEstate();
    await service.confirmNoPriorBalances(ctx.estateId, {}, ctx.user);
    const settings = await prisma.accountingSettings.findUniqueOrThrow({
      where: { estateId: ctx.estateId },
    });
    expect(settings.noPriorBalancesConfirmedAt).not.toBeNull();
  });

  it('no tiene sentido si ya hay una apertura contabilizada', async () => {
    const ctx = await freshEstate();
    await service.saveDraft(
      ctx.estateId,
      {
        bankBalances: [{ bankAccountId: ctx.bankAccountId, balance: 100 }],
        propertyDebts: [],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      },
      ctx.user,
    );
    await service.post(ctx.estateId, { differenceRole: 'retained' }, ctx.user);
    await expect(
      service.confirmNoPriorBalances(ctx.estateId, {}, ctx.user),
    ).rejects.toThrow(ConflictException);
  });
});
