import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { JournalService } from '../journal/journal.service';
import { LedgerQueryService } from '../ledger-query.service';
import { toCents } from '../money';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { YearCloseService } from './year-close.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Fase 11 de doc/contabilidad/roadmap-partida-doble.md: cierre de
 * ejercicio real. Integración contra Postgres real — las garantías que
 * importan (DM015 en un ejercicio cerrado, DM030/031 de los recibos
 * abiertos) viven en triggers que un mock de Prisma no ejecuta, y el
 * mecanismo central (cierre + apertura de N+1 en la MISMA transacción)
 * solo se puede probar así.
 */
jest.setTimeout(120_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const estateAccess = new EstateAccessService();
const journal = new JournalService();
const ledgerQuery = new LedgerQueryService(db);
const service = new YearCloseService(db, estateAccess, journal, ledgerQuery);

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  propertyId: string;
  user: ReturnType<typeof roleB>;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2024-01-01'),
  });
  const propertyId = await createProperty(prisma, estateId);
  return { estateId, propertyId, user: roleB(admin, [estateId]) };
}

/** Balance total de una cuenta (por systemRole) de toda la finca a una fecha, sin exclusiones — la cifra "real" en ese instante. */
async function roleBalance(
  estateId: string,
  systemRole: string,
  to: Date,
): Promise<number> {
  const rows = await ledgerQuery.accountBalances(estateId, { to });
  return rows
    .filter((r) => r.systemRole === systemRole)
    .reduce((sum, r) => sum + toCents(r.balance), 0);
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (cierre de ejercicio)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('YearCloseService.close — cierre por dimensión y apertura de N+1', () => {
  it('deja las cuentas de balance a cero a 31/12 y las reabre idénticas el 1/1', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pagada',
    });
    const open = await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-06',
      amount: '1000.00',
      status: 'Pendiente',
    });

    // A 31/12/2025, sin cerrar todavía: solo el recibo abierto pesa en la 430.
    expect(
      await roleBalance(ctx.estateId, 'owners_receivable', D('2025-12-31')),
    ).toBe(100_000);

    const closed = await service.close(ctx.estateId, 2025, ctx.user);
    expect(closed.status).toBe('Cerrado');
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedByUserId).toBe(ctx.user.id);

    // El asiento de cierre deja la 430 a cero justo a 31/12.
    expect(
      await roleBalance(ctx.estateId, 'owners_receivable', D('2025-12-31')),
    ).toBe(0);
    // La apertura de 2026 la restablece exactamente igual.
    expect(
      await roleBalance(ctx.estateId, 'owners_receivable', D('2026-06-30')),
    ).toBe(100_000);

    // outstanding del recibo abierto no se ha tocado: sigue siendo la caché
    // verificada de su partida abierta, cierre incluido.
    const refreshed = await prisma.accountingReceipt.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(Number(refreshed.outstanding)).toBe(1000);
    expect(refreshed.status).toBe('Pendiente');
  });

  it('no se puede contabilizar en un ejercicio cerrado (DM015)', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await service.close(ctx.estateId, 2025, ctx.user);

    await expect(
      issueTestReceipt(prisma, {
        estateId: ctx.estateId,
        propertyId: ctx.propertyId,
        periodKey: '2025-09',
        amount: '200.00',
        status: 'Pendiente',
      }),
    ).rejects.toThrow();
  });

  it('rechaza cerrar un ejercicio ya cerrado', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await service.close(ctx.estateId, 2025, ctx.user);
    await expect(
      service.close(ctx.estateId, 2025, ctx.user),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza cerrar un ejercicio si el anterior sigue abierto', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2024-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await expect(
      service.close(ctx.estateId, 2025, ctx.user),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('YearCloseService.reopen', () => {
  it('revierte cierre y apertura, y deja los saldos idénticos a antes de cerrar', async () => {
    const ctx = await freshEstate();
    const open = await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-06',
      amount: '1000.00',
      status: 'Pendiente',
    });
    await service.close(ctx.estateId, 2025, ctx.user);

    const reopened = await service.reopen(
      ctx.estateId,
      2025,
      { reason: 'Se detectó un recibo mal emitido, hay que corregirlo.' },
      ctx.user,
    );
    expect(reopened.status).toBe('Abierto');
    expect(reopened.reopenedAt).not.toBeNull();

    // Los cuatro asientos (cierre + apertura + sus dos contraasientos) se
    // cancelan entre sí: el saldo, a cualquier fecha, vuelve a ser el de
    // antes de cerrar.
    expect(
      await roleBalance(ctx.estateId, 'owners_receivable', D('2025-12-31')),
    ).toBe(100_000);
    expect(
      await roleBalance(ctx.estateId, 'owners_receivable', D('2026-06-30')),
    ).toBe(100_000);

    // Y se puede volver a contabilizar en 2025.
    await expect(
      issueTestReceipt(prisma, {
        estateId: ctx.estateId,
        propertyId: ctx.propertyId,
        periodKey: '2025-09',
        amount: '200.00',
        status: 'Pendiente',
      }),
    ).resolves.toBeDefined();

    const refreshed = await prisma.accountingReceipt.findUniqueOrThrow({
      where: { id: open.id },
    });
    expect(Number(refreshed.outstanding)).toBe(1000);
  });

  it('rechaza reabrir un ejercicio abierto', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await expect(
      service.reopen(
        ctx.estateId,
        2025,
        { reason: 'Motivo de prueba, con detalle' },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza reabrir un ejercicio si el siguiente ya está cerrado', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2024-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await service.close(ctx.estateId, 2024, ctx.user);
    await service.close(ctx.estateId, 2025, ctx.user);
    await expect(
      service.reopen(
        ctx.estateId,
        2024,
        { reason: 'Motivo de prueba, con detalle' },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('YearCloseService — dotación de reserva en el cierre (modo B)', () => {
  it('top_up_to_legal_minimum dota exactamente lo que falta hasta el 10 % del presupuesto', async () => {
    const ctx = await freshEstate();
    // Beneficio de 1.000€: una cuota cobrada, sin gastos.
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pagada',
    });
    // Mínimo legal (art. 9.1.f LPH): 10 % de 2.000€ presupuestados = 200€.
    const account = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId: ctx.estateId, code: '700' },
    });
    await prisma.budgetItem.create({
      data: {
        estateId: ctx.estateId,
        accountId: account.id,
        category: 'Cuotas ordinarias',
        fiscalYear: 2025,
        budgeted: '2000.00',
      },
    });
    await prisma.fiscalYear.update({
      where: { estateId_year: { estateId: ctx.estateId, year: 2025 } },
      data: {
        reserveMode: 'year_end_allocation',
        reserveAllocationRule: 'top_up_to_legal_minimum',
      },
    });

    await service.close(ctx.estateId, 2025, ctx.user);

    expect(
      await roleBalance(ctx.estateId, 'reserve_fund', D('2026-06-30')),
    ).toBe(
      -20_000, // 117 es una cuenta de patrimonio: 200€ de saldo acreedor.
    );
    // El resultado pendiente de aplicar es el beneficio menos lo dotado: 800€.
    expect(await roleBalance(ctx.estateId, 'result', D('2026-06-30'))).toBe(
      -80_000,
    );
  });

  it('sin pérdidas no dota nada, y en modo "none" tampoco aunque haya beneficio', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pagada',
    });
    await prisma.fiscalYear.update({
      where: { estateId_year: { estateId: ctx.estateId, year: 2025 } },
      data: { reserveMode: 'none' },
    });

    await service.close(ctx.estateId, 2025, ctx.user);

    expect(
      await roleBalance(ctx.estateId, 'reserve_fund', D('2026-06-30')),
    ).toBe(0);
    expect(await roleBalance(ctx.estateId, 'result', D('2026-06-30'))).toBe(
      -100_000,
    );
  });
});

describe('YearCloseService.applyResult', () => {
  it('reclasifica el resultado pendiente a remanente (120) tras el cierre', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '1000.00',
      status: 'Pagada',
    });
    await service.close(ctx.estateId, 2025, ctx.user);

    const applied = await service.applyResult(
      ctx.estateId,
      2025,
      { target: 'retained' },
      ctx.user,
    );
    expect(applied.appliedAmount).toBe(1000);

    const now = new Date();
    expect(await roleBalance(ctx.estateId, 'result', now)).toBe(0);
    expect(await roleBalance(ctx.estateId, 'retained', now)).toBe(-100_000);
  });

  it('rechaza aplicar el resultado de un ejercicio que no está cerrado', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await expect(
      service.applyResult(ctx.estateId, 2025, { target: 'retained' }, ctx.user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('YearCloseService.preconditions', () => {
  it('bloquea si el ejercicio anterior sigue abierto, y no bloquea en caso contrario', async () => {
    const ctx = await freshEstate();
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2024-03',
      amount: '500.00',
      status: 'Pagada',
    });
    await issueTestReceipt(prisma, {
      estateId: ctx.estateId,
      propertyId: ctx.propertyId,
      periodKey: '2025-03',
      amount: '500.00',
      status: 'Pagada',
    });

    const blocked = await service.preconditions(ctx.estateId, 2025, ctx.user);
    expect(blocked.canClose).toBe(false);
    expect(blocked.blockers.map((b) => b.code)).toContain('previous_year_open');

    await service.close(ctx.estateId, 2024, ctx.user);
    const clear = await service.preconditions(ctx.estateId, 2025, ctx.user);
    expect(clear.blockers).toHaveLength(0);
    expect(clear.canClose).toBe(true);
  });
});
