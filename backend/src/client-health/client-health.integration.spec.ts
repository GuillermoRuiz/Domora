import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateSetupService } from '../estates/estate-setup.service';
import { CompletenessService } from '../completeness/completeness.service';
import { ClientStatusService } from '../client-status/client-status.service';
import { UsageService } from '../usage/usage.service';
import { createAdministrator, purgeAdministrator } from '../testing/db-fixtures';
import { DEFAULT_CLIENT_HEALTH_CONFIG } from './client-health.config';
import { ClientHealthService } from './client-health.service';
import { UnavailableSupportSignalSource } from './support-signal';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * End to end over the real queries (Postgres): despachos, completitud, client
 * and payment status, the usage window and first-capture aggregate, the staff
 * count. The database is shared with the demo data, so assertions only look
 * at this test's despachos; everything created is removed afterwards (usage
 * rows cascade with their users).
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const completeness = new CompletenessService(db, new EstateSetupService(db));
const service = new ClientHealthService(
  db,
  completeness,
  new ClientStatusService(db, completeness),
  new UsageService(db),
  new UnavailableSupportSignalSource(),
  DEFAULT_CLIENT_HEALTH_CONFIG,
);
const created: string[] = [];
const DAY_MS = 86_400_000;
const now = new Date();
const dayOffset = (days: number) => new Date(`${new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`);

afterAll(async () => {
  for (const administratorId of created) {
    await prisma.adminInvoice.deleteMany({ where: { administratorId } });
    await purgeAdministrator(prisma, administratorId);
  }
  await prisma.$disconnect();
});

async function despacho(name: string, createdAt: Date) {
  const fx = await createAdministrator(prisma, { name });
  created.push(fx.administratorId);
  await prisma.administrator.update({ where: { id: fx.administratorId }, data: { createdAt } });
  return fx;
}

async function activity(userId: string, administratorId: string, daysAgo: number[]) {
  await prisma.userDailyActivity.createMany({
    data: daysAgo.map((d) => ({ day: dayOffset(d), userId, role: 'B' as const, administratorId, modules: ['estates'], requests: 3 })),
  });
}

it('scores, flags and lists the despachos from the stored data', async () => {
  const old = new Date('2025-01-01T00:00:00Z');
  const busy = await despacho('Salud activo', old);
  // A day older than the window makes sure capture «started» long ago for this test.
  await activity(busy.userId, busy.administratorId, [90, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const overdue = await despacho('Salud vencido', old);
  await activity(overdue.userId, overdue.administratorId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const sequence = 100_000 + Math.floor(Math.random() * 800_000);
  await prisma.adminInvoice.create({
    data: {
      administratorId: overdue.administratorId,
      invoiceNo: `TSH-2001-${sequence}`,
      series: 'TSH',
      fiscalYear: 2001,
      sequence,
      issueDate: new Date('2001-01-01'),
      operationDate: new Date('2001-01-01'),
      taxBase: 100,
      taxRate: 21,
      taxAmount: 21,
      total: 121,
      recipientName: 'Test',
      recipientTaxId: 'B00000000',
      recipientAddress: 'Calle Test',
      status: 'Vencida',
    },
  });

  const cancelled = await despacho('Salud cancelado', old);
  await prisma.administratorSubscription.create({
    data: { administratorId: cancelled.administratorId, stripeCustomerId: `cus_${cancelled.administratorId}`, stripeSubscriptionId: `sub_${cancelled.administratorId}`, status: 'canceled' },
  });

  const fresh = await despacho('Salud nuevo', new Date(now.getTime() - 2 * DAY_MS));

  const overview = await service.overview(now);
  const row = (id: string) => overview.offices.find((o) => o.administratorId === id)!;

  // Busy: 12 active days of 12 expected, its only staff member active; no setup → completitud 0.
  expect(row(busy.administratorId)).toMatchObject({
    clientStatus: 'En onboarding',
    paymentStatus: 'Al día',
    completeness: 0,
    usage: { activeDays: 12, activeUsers: 1, staffUsers: 1, observedDays: 30 },
    salud: 83.3,
    atRisk: false,
    motivo: { code: 'completeness', label: 'Onboarding incompleto' },
  });
  expect(row(busy.administratorId).attention.map((r) => r.code)).toEqual(['onboarding_blocked']);

  expect(row(overdue.administratorId)).toMatchObject({ paymentStatus: 'Vencido', atRisk: true, motivo: { code: 'payment' } });
  expect(row(overdue.administratorId).salud).toBeLessThan(70);

  expect(row(cancelled.administratorId)).toMatchObject({ clientStatus: 'Cancelado', salud: null, atRisk: false, attention: [] });

  // Two days old: usage not scored yet, onboarding not «bloqueado» yet.
  const freshRow = row(fresh.administratorId);
  expect(freshRow.signals.find((s) => s.key === 'usage')).toMatchObject({ available: false });
  expect(freshRow.attention).toEqual([]);

  const attention = await service.attention(now);
  const mine = attention.filter((i) => created.includes(i.administratorId)).map((i) => i.administratorId);
  expect(mine).toEqual([overdue.administratorId, busy.administratorId]);
  expect(overview.churnRisk).toBeGreaterThanOrEqual(1);

  await expect(service.office(overdue.administratorId, now)).resolves.toMatchObject({ administratorId: overdue.administratorId, atRisk: true });
});

it('404 for a deleted despacho', async () => {
  const fx = await despacho('Salud borrado', new Date('2025-01-01T00:00:00Z'));
  await prisma.administrator.update({ where: { id: fx.administratorId }, data: { deletedAt: new Date() } });
  await expect(service.office(fx.administratorId)).rejects.toBeInstanceOf(NotFoundException);
});
