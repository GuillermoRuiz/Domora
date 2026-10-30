import { randomUUID } from 'crypto';
import { type AdminInvoiceStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateSetupService } from '../estates/estate-setup.service';
import { CompletenessService } from '../completeness/completeness.service';
import { ClientStatusService } from '../client-status/client-status.service';
import { createAdministrator, purgeAdministrator } from '../testing/db-fixtures';
import { AdminsService } from './admins.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: the role A list and ficha expose the derived client
 * and payment status (S6) from the stored AdminStatus, Stripe subscription
 * and Domora invoices, with the batched queries of ClientStatusService.
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const clientStatus = new ClientStatusService(db, new CompletenessService(db, new EstateSetupService(db)));
const admins = new AdminsService(db, undefined as never, undefined as never, clientStatus);
const created: string[] = [];

afterAll(async () => {
  for (const id of created) await purgeAdministrator(prisma, id);
  await prisma.$disconnect();
});

async function despacho(name: string) {
  const { administratorId } = await createAdministrator(prisma, { name });
  created.push(administratorId);
  return administratorId;
}

/** Fiscal year 2001 keeps the test invoices away from the real numbering. */
async function invoice(administratorId: string, status: AdminInvoiceStatus, total: number, stripeInvoiceId: string | null = null) {
  const sequence = Math.floor(Math.random() * 1_000_000_000);
  await prisma.adminInvoice.create({
    data: {
      administratorId,
      invoiceNo: `TST-2001-${sequence}`,
      series: 'TST',
      fiscalYear: 2001,
      sequence,
      issueDate: new Date('2001-01-01'),
      operationDate: new Date('2001-01-01'),
      taxBase: total / 1.21,
      taxRate: 21,
      taxAmount: total - total / 1.21,
      total,
      recipientName: 'Test',
      recipientTaxId: 'B00000000',
      recipientAddress: 'Calle Test',
      status,
      stripeInvoiceId,
    },
  });
}

async function stripe(administratorId: string, status: 'trialing' | 'past_due' | 'canceled') {
  await prisma.administratorSubscription.create({
    data: { administratorId, stripeCustomerId: `cus_${randomUUID()}`, stripeSubscriptionId: `sub_${randomUUID()}`, status },
  });
}

it('the list and the ficha expose client status, payment status and unpaid invoices next to the previous fields', async () => {
  const onboarding = await despacho('Despacho estado onboarding');
  await invoice(onboarding, 'Pendiente', 60.5);
  await invoice(onboarding, 'Pagada', 60.5);

  const trial = await despacho('Despacho estado prueba');
  await stripe(trial, 'trialing');

  const failed = await despacho('Despacho estado fallido');
  await stripe(failed, 'past_due');
  await invoice(failed, 'Vencida', 72.6, `in_${randomUUID()}`);

  const suspended = await despacho('Despacho estado vencido');
  await prisma.administrator.update({ where: { id: suspended }, data: { status: 'Vencida' } });
  await invoice(suspended, 'Vencida', 60.5);

  const list = await admins.list();
  const byId = new Map(list.map((a) => [a.id, a]));

  expect(byId.get(onboarding)).toMatchObject({
    name: 'Despacho estado onboarding',
    status: 'Activa',
    usersActive: 0,
    clientStatus: 'En onboarding',
    paymentStatus: 'Pendiente',
    pendingInvoices: { count: 1, amount: 60.5, overdueCount: 0, overdueAmount: 0 },
  });
  expect(byId.get(trial)).toMatchObject({ clientStatus: 'En prueba', paymentStatus: 'Al día', pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 } });
  expect(byId.get(failed)).toMatchObject({ clientStatus: 'En onboarding', paymentStatus: 'Fallido', pendingInvoices: { count: 1, amount: 72.6, overdueCount: 1, overdueAmount: 72.6 } });
  expect(byId.get(suspended)).toMatchObject({ status: 'Vencida', clientStatus: 'Suspendido', paymentStatus: 'Vencido', pendingInvoices: { count: 1, amount: 60.5, overdueCount: 1, overdueAmount: 60.5 } });

  const detail = await admins.findById(failed);
  expect(detail).toMatchObject({ id: failed, name: 'Despacho estado fallido', fincas: [], usersActive: 0, clientStatus: 'En onboarding', paymentStatus: 'Fallido' });
  expect(detail.invoices).toHaveLength(1);
  expect(detail.activity).toEqual([]);
});

it('a deleted despacho or a canceled Stripe subscription is Cancelado', async () => {
  const deleted = await despacho('Despacho estado borrado');
  await prisma.administrator.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
  const canceled = await despacho('Despacho estado cancelado');
  await stripe(canceled, 'canceled');

  const statuses = await clientStatus.forAdministrators([deleted, canceled]);
  expect(statuses.get(deleted)?.clientStatus).toBe('Cancelado');
  expect(statuses.get(canceled)?.clientStatus).toBe('Cancelado');
});
