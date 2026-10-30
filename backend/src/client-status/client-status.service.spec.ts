import { Prisma } from '../prisma/client';
import { ClientStatusService } from './client-status.service';

function setup(admins: unknown[], invoices: unknown[], onboarding: Map<string, boolean>) {
  const prisma = {
    administrator: { findMany: jest.fn().mockResolvedValue(admins) },
    adminInvoice: { findMany: jest.fn().mockResolvedValue(invoices) },
  };
  const completeness = { onboardingCompleteByOffice: jest.fn().mockResolvedValue(onboarding) };
  return { service: new ClientStatusService(prisma as never, completeness as never), prisma, completeness };
}

describe('ClientStatusService.forAdministrators', () => {
  it('derives both statuses and the unpaid invoices of every despacho with a fixed number of queries', async () => {
    const { service, prisma, completeness } = setup(
      [
        { id: 'a', status: 'Activa', deletedAt: null, subscription: null },
        { id: 'b', status: 'Activa', deletedAt: null, subscription: { stripeSubscriptionId: 'sub_b', status: 'past_due' } },
        { id: 'c', status: 'Activa', deletedAt: null, subscription: { stripeSubscriptionId: 'sub_c', status: 'trialing' } },
      ],
      [
        { administratorId: 'a', status: 'Pendiente', total: new Prisma.Decimal('60.50'), stripeInvoiceId: null },
        { administratorId: 'b', status: 'Vencida', total: new Prisma.Decimal('72.60'), stripeInvoiceId: 'in_1' },
      ],
      new Map([['a', false], ['b', true]]),
    );

    const result = await service.forAdministrators(['a', 'b', 'c']);

    expect(result.get('a')).toEqual({
      clientStatus: 'En onboarding',
      paymentStatus: 'Pendiente',
      pendingInvoices: { count: 1, amount: 60.5, overdueCount: 0, overdueAmount: 0 },
    });
    expect(result.get('b')).toEqual({
      clientStatus: 'Activo',
      paymentStatus: 'Fallido',
      pendingInvoices: { count: 1, amount: 72.6, overdueCount: 1, overdueAmount: 72.6 },
    });
    expect(result.get('c')).toEqual({
      clientStatus: 'En prueba',
      paymentStatus: 'Al día',
      pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 },
    });
    expect(prisma.administrator.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.adminInvoice.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.adminInvoice.findMany.mock.calls[0][0].where).toEqual({ administratorId: { in: ['a', 'b', 'c'] }, status: { in: ['Pendiente', 'Vencida'] } });
    // Completitud only for the despachos that could be Activo / En onboarding.
    expect(completeness.onboardingCompleteByOffice).toHaveBeenCalledTimes(1);
    expect(completeness.onboardingCompleteByOffice).toHaveBeenCalledWith(['a', 'b']);
  });

  it('reads deleted despachos too (Cancelado) and skips completitud when no despacho needs it', async () => {
    const { service, prisma, completeness } = setup(
      [{ id: 'd', status: 'Activa', deletedAt: new Date('2026-01-01'), subscription: null }],
      [],
      new Map(),
    );
    const result = await service.forAdministrators(['d']);
    expect(result.get('d')?.clientStatus).toBe('Cancelado');
    expect(prisma.administrator.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['d'] } });
    expect(completeness.onboardingCompleteByOffice).not.toHaveBeenCalled();
  });

  it('a Stripe status without a subscription id counts as manual billing', async () => {
    const { service } = setup(
      [{ id: 'e', status: 'Activa', deletedAt: null, subscription: { stripeSubscriptionId: null, status: 'canceled' } }],
      [],
      new Map([['e', true]]),
    );
    expect((await service.forAdministrators(['e'])).get('e')?.clientStatus).toBe('Activo');
  });

  it('reuses completitud already computed by the caller instead of computing it again', async () => {
    const { service, completeness } = setup(
      [
        { id: 'a', status: 'Activa', deletedAt: null, subscription: null },
        { id: 'b', status: 'Activa', deletedAt: null, subscription: null },
      ],
      [],
      new Map(),
    );
    const result = await service.forAdministrators(['a', 'b'], new Map([['a', true], ['b', false]]));
    expect(result.get('a')?.clientStatus).toBe('Activo');
    expect(result.get('b')?.clientStatus).toBe('En onboarding');
    expect(completeness.onboardingCompleteByOffice).not.toHaveBeenCalled();
  });

  it('does not query anything for an empty list', async () => {
    const { service, prisma } = setup([], [], new Map());
    expect((await service.forAdministrators([])).size).toBe(0);
    expect(prisma.administrator.findMany).not.toHaveBeenCalled();
  });

  it('forAdministrator returns null for an unknown despacho', async () => {
    const { service } = setup([], [], new Map());
    await expect(service.forAdministrator('zz')).resolves.toBeNull();
  });
});
