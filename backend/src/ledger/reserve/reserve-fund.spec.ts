import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import { ReserveFundPostingService } from '../posting/reserve-fund-posting.service';
import { ReserveFundService } from './reserve-fund.service';
import { SupplierPostingService } from '../posting/supplier-posting.service';
import { InvariantsService } from '../invariants.service';
import { LedgerQueryService } from '../ledger-query.service';
import { toCents } from '../money';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Uso del fondo de reserva (art. 9.1.f LPH) contra Postgres real: el
 * servicio construye 117 → 746 (ADR D4), el motivo y el acta son
 * obligatorios (a diferencia de la política de intereses, donde
 * `meetingReference` es opcional — acá el fondo tiene "una finalidad
 * totalmente independiente" de los gastos ordinarios), y las garantías de
 * la base de datos (DM110-DM111).
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const access = new EstateAccessService();
const journal = new JournalService();
const posting = new ReserveFundPostingService(journal);
const service = new ReserveFundService(db, access, posting);
const supplierPosting = new SupplierPostingService(journal);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;
let user: AuthenticatedUser;

async function balanceOf(code: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } } },
    _sum: { debit: true, credit: true },
  });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}

let estateId: string;

async function freshEstate(): Promise<string> {
  return createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora fondo de reserva',
  });
  user = roleB(admin, []);
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

beforeEach(async () => {
  estateId = await freshEstate();
  user = roleB(admin, [estateId]);
});

describe('ReserveFundService.create', () => {
  it('libera el fondo (117 → 746) con motivo y acta', async () => {
    const application = await service.create(
      estateId,
      {
        date: '2026-03-15',
        amount: 1500,
        reason: 'reparacion',
        concept: 'Impermeabilización de la cubierta',
        meetingReference: 'Acta junta extraordinaria 2026-03-01, punto 3',
      },
      user,
    );

    expect(application.reason).toBe('reparacion');
    expect(application.meetingReference).toContain('2026-03-01');
    expect(await balanceOf('117')).toBe(1500); // debe (117 se debita: libera reserva)
    expect(await balanceOf('746')).toBe(-1500); // haber
    expect(await invariants.check(estateId)).toEqual([]);
  });

  it('exige un importe mayor que cero', async () => {
    await expect(
      service.create(
        estateId,
        {
          date: '2026-03-15',
          amount: 0,
          reason: 'otro',
          concept: 'x',
          meetingReference: 'Acta',
        },
        user,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('exige el acta que autoriza la disposición', async () => {
    await expect(
      service.create(
        estateId,
        {
          date: '2026-03-15',
          amount: 100,
          reason: 'otro',
          // meetingReference vacío tras trim — la validación del DTO ya lo
          // bloquearía en el controlador; se prueba aquí el guard del servicio.
          meetingReference: '   ',
          concept: 'Concepto válido',
        },
        user,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('vincula opcionalmente la factura de proveedor que motivó el gasto', async () => {
    const supplierId = (
      await prisma.supplier.create({
        data: {
          name: 'Cubiertas del Norte SL',
          category: 'Reparaciones',
          estateId,
          administratorId: admin.administratorId,
        },
      })
    ).id;
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '622' },
    });
    const invoice = await prisma.$transaction((tx) =>
      supplierPosting.registerInvoice(tx, {
        estateId,
        supplierId,
        number: 'F-1',
        concept: 'Reparación de cubierta',
        issueDate: D('2026-03-10'),
        vatRatePct: 21,
        withholdingRatePct: 0,
        lines: [{ accountId: account.id, base: 150000 }],
      }),
    );

    const application = await service.create(
      estateId,
      {
        date: '2026-03-15',
        amount: 1815, // 1.500 base + 21% IVA, coincide con la factura
        reason: 'reparacion',
        concept: 'Reparación de cubierta',
        meetingReference: 'Acta junta 2026-03-01',
        relatedSupplierInvoiceId: invoice.id,
      },
      user,
    );

    const stored = await prisma.reserveFundApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(stored.relatedSupplierInvoiceId).toBe(invoice.id);
  });

  it('rechaza el vínculo a una factura de otra finca', async () => {
    const otherEstateId = await freshEstate();
    const supplierId = (
      await prisma.supplier.create({
        data: {
          name: 'Proveedor de otra finca',
          category: 'Reparaciones',
          estateId: otherEstateId,
          administratorId: admin.administratorId,
        },
      })
    ).id;
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId: otherEstateId, code: '622' },
    });
    const invoice = await prisma.$transaction((tx) =>
      supplierPosting.registerInvoice(tx, {
        estateId: otherEstateId,
        supplierId,
        number: 'F-1',
        concept: 'Factura de otra finca',
        issueDate: D('2026-03-10'),
        vatRatePct: 21,
        withholdingRatePct: 0,
        lines: [{ accountId: account.id, base: 10000 }],
      }),
    );

    await expect(
      service.create(
        estateId,
        {
          date: '2026-03-15',
          amount: 100,
          reason: 'otro',
          concept: 'Concepto',
          meetingReference: 'Acta',
          relatedSupplierInvoiceId: invoice.id,
        },
        user,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ReserveFundService.cancel', () => {
  it('deshace con un contraasiento y no se puede deshacer dos veces', async () => {
    const application = await service.create(
      estateId,
      {
        date: '2026-03-15',
        amount: 500,
        reason: 'conservacion',
        concept: 'Pintura de fachada',
        meetingReference: 'Acta junta 2026-03-01',
      },
      user,
    );

    await service.cancel(
      application.id,
      { reason: 'Importe equivocado' },
      user,
    );
    expect(await balanceOf('117')).toBe(0);
    expect(await balanceOf('746')).toBe(0);
    expect(await invariants.check(estateId)).toEqual([]);

    await expect(
      service.cancel(application.id, { reason: 'Otra vez' }, user),
    ).rejects.toThrow(ConflictException);
  });
});

describe('Garantías', () => {
  it('una liberación no se modifica fuera del ciclo de deshacer (DM110)', async () => {
    const application = await service.create(
      estateId,
      {
        date: '2026-03-15',
        amount: 200,
        reason: 'otro',
        concept: 'Concepto',
        meetingReference: 'Acta',
      },
      user,
    );

    let error: unknown;
    try {
      await prisma.reserveFundApplication.update({
        where: { id: application.id },
        data: { amount: 1 },
      });
    } catch (e) {
      error = e;
    }
    expect(parseLedgerDbError(error)?.code).toBe('DM110');
    expect(await invariants.check(estateId)).toEqual([]);
  });

  it('una liberación no se borra (DM110)', async () => {
    const application = await service.create(
      estateId,
      {
        date: '2026-03-15',
        amount: 200,
        reason: 'otro',
        concept: 'Concepto',
        meetingReference: 'Acta',
      },
      user,
    );

    let error: unknown;
    try {
      await prisma.reserveFundApplication.delete({
        where: { id: application.id },
      });
    } catch (e) {
      error = e;
    }
    expect(parseLedgerDbError(error)?.code).toBe('DM110');
  });

  it('el importe registrado tiene que coincidir con lo que su asiento carga a la 117 (DM111)', async () => {
    const account117 = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '117' },
    });
    const account746 = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '746' },
    });

    let error: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        const entry = await journal.post(tx, {
          estateId,
          date: D('2026-03-15'),
          sourceType: 'reserve_use',
          sourceId: randomUUID(),
          concept: 'Uso del fondo de reserva: prueba de garantía',
          lines: [
            { account: { accountId: account117.id }, debit: toCents(100) },
            { account: { accountId: account746.id }, credit: toCents(100) },
          ],
        });
        // El asiento carga 100 € a la 117, pero la fila dice 200 €: DM111
        // tiene que abortar la transacción al confirmar.
        await tx.reserveFundApplication.create({
          data: {
            estateId,
            date: D('2026-03-15'),
            amount: '200.00',
            reason: 'otro',
            concept: 'Concepto',
            meetingReference: 'Acta',
            entryId: entry.id,
          },
        });
      });
    } catch (e) {
      error = e;
    }
    expect(parseLedgerDbError(error)?.code).toBe('DM111');
  });
});
