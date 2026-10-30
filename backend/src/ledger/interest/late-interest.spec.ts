import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { JournalService } from '../journal/journal.service';
import { ReceiptPostingService } from '../posting/receipt-posting.service';
import { CollectionPostingService } from '../posting/collection-posting.service';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { LateInterestService } from './late-interest.service';
import { LatePaymentInterestPoliciesService } from './late-interest-policies.service';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Fase 10 de doc/contabilidad/roadmap-partida-doble.md: intereses de
 * demora. Integración contra Postgres real — las garantías que importan de
 * verdad (T11 sin solapes, DM100 sin anatocismo) viven en triggers y
 * EXCLUDE constraints que un mock de Prisma no ejecuta.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const estateAccess = new EstateAccessService();
const journal = new JournalService();
const receiptPosting = new ReceiptPostingService(journal);
const collectionPosting = new CollectionPostingService(journal, receiptPosting);
const service = new LateInterestService(db, estateAccess, receiptPosting);
const policies = new LatePaymentInterestPoliciesService(db, estateAccess);

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

async function overdueReceipt(
  ctx: Ctx,
  opts: { periodKey: string; amount: string; dueDate: Date },
) {
  return issueTestReceipt(prisma, {
    estateId: ctx.estateId,
    propertyId: ctx.propertyId,
    periodKey: opts.periodKey,
    amount: opts.amount,
    dueDate: opts.dueDate,
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (intereses de demora)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('LatePaymentInterestPoliciesService', () => {
  it('crea y lista tipos de interés, más recientes primero', async () => {
    const ctx = await freshEstate();
    const first = await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, graceDays: 5, validFrom: '2024-01-01' },
      ctx.user,
    );
    await policies.close(
      ctx.estateId,
      first.id,
      { validTo: '2025-06-01' },
      ctx.user,
    );
    await policies.create(
      ctx.estateId,
      { annualRatePct: 7.3, validFrom: '2025-06-01' },
      ctx.user,
    );
    const list = await policies.list(ctx.estateId, ctx.user);
    expect(list.map((p) => Number(p.annualRatePct))).toEqual([7.3, 3.65]);
  });

  it('dos vigencias solapadas de la misma finca se rechazan (T11)', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    await expect(
      policies.create(
        ctx.estateId,
        { annualRatePct: 5, validFrom: '2024-06-01' },
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cerrar una vigencia permite abrir la siguiente sin solape', async () => {
    const ctx = await freshEstate();
    const first = await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    await policies.close(
      ctx.estateId,
      first.id,
      { validTo: '2025-06-01' },
      ctx.user,
    );
    const second = await policies.create(
      ctx.estateId,
      { annualRatePct: 7.3, validFrom: '2025-06-01' },
      ctx.user,
    );
    expect(Number(second.annualRatePct)).toBe(7.3);
  });
});

describe('LateInterestService.preview', () => {
  it('sin ninguna política, no hay nada que previsualizar', async () => {
    const ctx = await freshEstate();
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-10'),
    });
    const result = await service.preview(
      ctx.estateId,
      receipt.id,
      '2025-06-01',
      ctx.user,
    );
    expect(result.interestStart).toBeNull();
    expect(result.total).toBe(0);
  });

  it('con carencia y una sola política, un tramo', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, graceDays: 5, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-10'),
    });
    // Carencia hasta el 15/1; 35 días hasta el 19/2.
    const result = await service.preview(
      ctx.estateId,
      receipt.id,
      '2025-02-19',
      ctx.user,
    );
    expect(result.interestStart).toBe('2025-01-15');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      from: '2025-01-15',
      to: '2025-02-19',
      days: 35,
      annualRatePct: 3.65,
      principal: 1000,
    });
    expect(result.total).toBeCloseTo(3.5, 1); // 1000 * 3,65% * 35/365
  });

  it('no persiste nada', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-10'),
    });
    await service.preview(ctx.estateId, receipt.id, '2025-03-01', ctx.user);
    const accruals = await prisma.receiptInterestAccrual.findMany({
      where: { debtReceiptId: receipt.id },
    });
    expect(accruals).toHaveLength(0);
  });
});

describe('LateInterestService.accrue', () => {
  it('contabiliza un recibo de intereses con su asiento 430/769', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, graceDays: 5, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-10'),
    });

    const result = await service.accrue(
      ctx.estateId,
      receipt.id,
      '2025-02-19',
      ctx.user,
    );
    expect(result.total).toBeCloseTo(3.5, 1);

    const interestReceipt = await prisma.accountingReceipt.findUniqueOrThrow({
      where: { id: result.interestReceiptId },
      include: {
        journalLines: { include: { account: true } },
        issueEntry: { include: { lines: true } },
      },
    });
    expect(interestReceipt.kind).toBe('intereses_demora');
    expect(interestReceipt.issueEntryId).not.toBeNull();
    expect(interestReceipt.issueEntry!.lines).toHaveLength(2);
    const debit = interestReceipt.issueEntry!.lines.find(
      (l) => Number(l.debit) > 0,
    );
    const credit = interestReceipt.issueEntry!.lines.find(
      (l) => Number(l.credit) > 0,
    );
    expect(debit?.propertyId).toBe(ctx.propertyId);
    expect(debit?.receiptId).toBe(interestReceipt.id);
    expect(Number(debit?.debit)).toBe(Number(credit?.credit));

    const accrual = await prisma.receiptInterestAccrual.findFirstOrThrow({
      where: { debtReceiptId: receipt.id },
    });
    expect(accrual.interestReceiptId).toBe(interestReceipt.id);
    expect(accrual.days).toBe(35);
  });

  it('un cambio de tipo a mitad del tramo genera dos filas de liquidación', async () => {
    const ctx = await freshEstate();
    const p1 = await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    await policies.close(
      ctx.estateId,
      p1.id,
      { validTo: '2025-02-01' },
      ctx.user,
    );
    await policies.create(
      ctx.estateId,
      { annualRatePct: 7.3, validFrom: '2025-02-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });

    await service.accrue(ctx.estateId, receipt.id, '2025-03-01', ctx.user);
    const accruals = await prisma.receiptInterestAccrual.findMany({
      where: { debtReceiptId: receipt.id },
      orderBy: { fromDate: 'asc' },
    });
    expect(accruals).toHaveLength(2);
    expect(Number(accruals[0].annualRatePct)).toBe(3.65);
    expect(Number(accruals[1].annualRatePct)).toBe(7.3);
  });

  it('volver a liquidar más adelante solo cobra el tramo nuevo, sin repetir el ya liquidado', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });

    await service.accrue(ctx.estateId, receipt.id, '2025-02-01', ctx.user);
    const second = await service.accrue(
      ctx.estateId,
      receipt.id,
      '2025-03-01',
      ctx.user,
    );
    expect(second.segments).toHaveLength(1);
    expect(second.segments[0].from).toBe('2025-02-01');
    expect(second.segments[0].to).toBe('2025-03-01');

    const all = await prisma.receiptInterestAccrual.findMany({
      where: { debtReceiptId: receipt.id },
    });
    expect(all).toHaveLength(2);
  });

  it('un cobro parcial a mitad del tramo reduce el principal desde ese día', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });
    // Cobro parcial de 600€ el 1/2 — quedan 400€ pendientes desde entonces.
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId: ctx.estateId,
        propertyId: ctx.propertyId,
        date: D('2025-02-01'),
        amount: 60_000,
        method: 'Transferencia',
        receiptIds: [receipt.id],
      }),
    );

    const preview = await service.preview(
      ctx.estateId,
      receipt.id,
      '2025-03-01',
      ctx.user,
    );
    // Tramo 1 (1/1 a 1/2, principal 1.000€) + tramo 2 (1/2 a 1/3, principal 400€).
    expect(preview.segments).toHaveLength(2);
    expect(preview.segments[0]).toMatchObject({
      principal: 1000,
      to: '2025-02-01',
    });
    expect(preview.segments[1]).toMatchObject({
      principal: 400,
      from: '2025-02-01',
    });
  });

  it('sin nada que liquidar (todavía en carencia), accrue() rechaza', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, graceDays: 30, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });
    await expect(
      service.accrue(ctx.estateId, receipt.id, '2025-01-10', ctx.user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('no se puede liquidar interés sobre un recibo que ya es de intereses (sin anatocismo)', async () => {
    const ctx = await freshEstate();
    await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    const receipt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });
    const result = await service.accrue(
      ctx.estateId,
      receipt.id,
      '2025-03-01',
      ctx.user,
    );
    await expect(
      service.preview(
        ctx.estateId,
        result.interestReceiptId,
        '2025-06-01',
        ctx.user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('Garantías en base de datos (T11 y DM100)', () => {
  it('dos tramos solapados de la misma deuda se rechazan aunque se inserten a mano', async () => {
    const ctx = await freshEstate();
    const policy = await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    const debt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });
    const result = await service.accrue(
      ctx.estateId,
      debt.id,
      '2025-02-01',
      ctx.user,
    );

    await expect(
      prisma.$executeRaw`
        INSERT INTO "receipt_interest_accruals"
          ("id", "debt_receipt_id", "interest_receipt_id", "policy_id", "from_date", "to_date", "principal_base", "annual_rate_pct", "days", "amount")
        VALUES
          (gen_random_uuid(), ${debt.id}::uuid, ${result.interestReceiptId}::uuid, ${policy.id}::uuid, '2025-01-15', '2025-01-25', 1000.00, 3.65, 10, 1.00)
      `,
    ).rejects.toThrow();
  });

  it('DM100: un tramo no puede citar como deuda un recibo que ya es de intereses', async () => {
    const ctx = await freshEstate();
    const policy = await policies.create(
      ctx.estateId,
      { annualRatePct: 3.65, validFrom: '2024-01-01' },
      ctx.user,
    );
    const debt = await overdueReceipt(ctx, {
      periodKey: '2025-01',
      amount: '1000.00',
      dueDate: D('2025-01-01'),
    });
    const result = await service.accrue(
      ctx.estateId,
      debt.id,
      '2025-02-01',
      ctx.user,
    );

    await expect(
      prisma.$executeRaw`
        INSERT INTO "receipt_interest_accruals"
          ("id", "debt_receipt_id", "interest_receipt_id", "policy_id", "from_date", "to_date", "principal_base", "annual_rate_pct", "days", "amount")
        VALUES
          (gen_random_uuid(), ${result.interestReceiptId}::uuid, ${result.interestReceiptId}::uuid, ${policy.id}::uuid, '2025-03-01', '2025-03-10', 3.50, 3.65, 9, 1.00)
      `,
    ).rejects.toThrow(/DM100/);
  });

  it('el EXCLUDE y el trigger siguen ahí tras esta migración', async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conname IN (
        'excl_interest_policy_no_overlap', 'excl_interest_accrual_no_overlap'
      )
    `;
    expect(rows.map((r) => r.conname).sort()).toEqual([
      'excl_interest_accrual_no_overlap',
      'excl_interest_policy_no_overlap',
    ]);
    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgname = 'receipt_interest_accruals_before_insert'
    `;
    expect(triggers).toHaveLength(1);
  });
});
