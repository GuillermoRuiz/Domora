import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
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
import { PayrollPostingService } from '../posting/payroll-posting.service';
import { InvariantsService } from '../invariants.service';
import { LedgerQueryService } from '../ledger-query.service';
import { PayrollService } from './payroll.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Nóminas registradas a mano (fase 7c) contra Postgres real.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const service = new PayrollService(
  db,
  new EstateAccessService(),
  new PayrollPostingService(new JournalService()),
);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  staffId: string;
  user: AuthenticatedUser;
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  const staff = await prisma.staffMember.create({
    data: {
      estateId,
      administratorId: admin.administratorId,
      fullName: 'Portero de prueba',
      position: 'Conserje',
      nationalId: '00000000T',
      contractType: 'Indefinido',
      startDate: D('2020-01-01'),
      monthlyCost: '1500.00',
    },
  });
  return { estateId, staffId: staff.id, user: roleB(admin, [estateId]) };
}

const NOMINA = {
  grossSalary: 1500,
  employeeSs: 97.5,
  employerSs: 480,
  irpfWithholding: 150,
};

async function balanceOf(estateId: string, code: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } } },
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

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (nóminas)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Nóminas', () => {
  it('registrar contabiliza bruto y cuota patronal contra Seguridad Social, IRPF y neto, a fin de mes', async () => {
    const ctx = await freshEstate();
    const p = await service.create(
      ctx.estateId,
      { staffMemberId: ctx.staffId, period: '2026-02', ...NOMINA },
      ctx.user,
    );
    expect(p).toMatchObject({
      netPay: 1252.5,
      totalCost: 1980,
      status: 'Registrada',
      staffName: 'Portero de prueba',
    });
    expect(p.accrualDate.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(await balanceOf(ctx.estateId, '640')).toBe('1500.00');
    expect(await balanceOf(ctx.estateId, '642')).toBe('480.00');
    expect(await balanceOf(ctx.estateId, '476')).toBe('-577.50');
    expect(await balanceOf(ctx.estateId, '4751')).toBe('-150.00');
    expect(await balanceOf(ctx.estateId, '465')).toBe('-1252.50');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('pagar salda el neto desde el banco; deshacer el pago lo devuelve a pendiente', async () => {
    const ctx = await freshEstate();
    const p = await service.create(
      ctx.estateId,
      { staffMemberId: ctx.staffId, period: '2026-03', ...NOMINA },
      ctx.user,
    );
    const paid = await service.pay(
      p.id,
      { date: '2026-04-01', method: 'Transferencia' },
      ctx.user,
    );
    expect(paid.status).toBe('Pagada');
    expect(paid.paidDate?.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(await balanceOf(ctx.estateId, '465')).toBe('0.00');
    expect(await balanceOf(ctx.estateId, '572')).toBe('-1252.50');
    await expect(
      service.pay(
        p.id,
        { date: '2026-04-02', method: 'Transferencia' },
        ctx.user,
      ),
    ).rejects.toThrow(/ya está pagada/);

    const undone = await service.undoPayment(
      p.id,
      { reason: 'Transferencia rechazada' },
      ctx.user,
    );
    expect(undone).toMatchObject({ status: 'Registrada', paidDate: null });
    expect(await balanceOf(ctx.estateId, '572')).toBe('0.00');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('una nómina por empleado, mes y tipo; la extra es otra; anulada, se puede volver a registrar', async () => {
    const ctx = await freshEstate();
    const p = await service.create(
      ctx.estateId,
      { staffMemberId: ctx.staffId, period: '2026-06', ...NOMINA },
      ctx.user,
    );
    await expect(
      service.create(
        ctx.estateId,
        { staffMemberId: ctx.staffId, period: '2026-06', ...NOMINA },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.create(
      ctx.estateId,
      {
        staffMemberId: ctx.staffId,
        period: '2026-06',
        kind: 'extra',
        ...NOMINA,
      },
      ctx.user,
    );

    const cancelled = await service.cancel(
      p.id,
      { reason: 'Importes equivocados' },
      ctx.user,
    );
    expect(cancelled.status).toBe('Anulada');
    await service.create(
      ctx.estateId,
      {
        staffMemberId: ctx.staffId,
        period: '2026-06',
        ...NOMINA,
        grossSalary: 1600,
      },
      ctx.user,
    );
    expect(await balanceOf(ctx.estateId, '640')).toBe('3100.00');
  });

  it('una nómina pagada no se anula sin deshacer el pago', async () => {
    const ctx = await freshEstate();
    const p = await service.create(
      ctx.estateId,
      { staffMemberId: ctx.staffId, period: '2026-04', ...NOMINA },
      ctx.user,
    );
    await service.pay(
      p.id,
      { date: '2026-05-01', method: 'Efectivo' },
      ctx.user,
    );
    expect(await balanceOf(ctx.estateId, '570')).toBe('-1252.50');
    await expect(
      service.cancel(p.id, { reason: 'x error' }, ctx.user),
    ).rejects.toThrow(/deshaz antes el pago/);
  });

  it('rechaza importes imposibles y empleados de otra finca', async () => {
    const ctx = await freshEstate();
    const other = await freshEstate();
    await expect(
      service.create(
        ctx.estateId,
        {
          staffMemberId: ctx.staffId,
          period: '2026-05',
          ...NOMINA,
          irpfWithholding: 1500,
        },
        ctx.user,
      ),
    ).rejects.toThrow(/no pueden superar el bruto/);
    await expect(
      service.create(
        ctx.estateId,
        { staffMemberId: other.staffId, period: '2026-05', ...NOMINA },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.list(ctx.estateId, {}, roleB(admin, [])),
    ).rejects.toThrow();
  });

  it('garantías: no se modifica ni se borra (DM060) y el asiento cuadra con sus importes (DM061)', async () => {
    const ctx = await freshEstate();
    const p = await service.create(
      ctx.estateId,
      { staffMemberId: ctx.staffId, period: '2026-07', ...NOMINA },
      ctx.user,
    );
    const update = await failure(
      prisma.payrollRecord.update({
        where: { id: p.id },
        data: { grossSalary: 1400, netPay: 1152.5 },
      }),
    );
    expect(parseLedgerDbError(update)?.code).toBe('DM060');
    const del = await failure(
      prisma.payrollRecord.delete({ where: { id: p.id } }),
    );
    expect(parseLedgerDbError(del)?.code).toBe('DM060');

    // Una nómina sin su asiento no se confirma.
    const forged = await failure(
      prisma.payrollRecord.create({
        data: {
          estateId: ctx.estateId,
          staffMemberId: ctx.staffId,
          period: '2026-08',
          accrualDate: D('2026-08-31'),
          grossSalary: 999,
          employeeSs: 0,
          employerSs: 0,
          irpfWithholding: 0,
          netPay: 999,
        },
      }),
    );
    expect(parseLedgerDbError(forged)?.code).toBe('DM061');
  });
});
