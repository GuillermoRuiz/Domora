import { ConflictException } from '@nestjs/common';
import { BillingInterval } from '../prisma/client';
import { AdminsService } from './admins.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const SUPERADMIN: AuthenticatedUser = {
  id: 'sa',
  role: 'A',
  estateIds: [],
  administratorId: null,
};

describe('AdminsService.update — billing interval', () => {
  function setup(subscription: unknown) {
    const tx = {
      administrator: { update: jest.fn().mockResolvedValue({ id: 'adm' }) },
      adminActivityItem: { create: jest.fn() },
    };
    const prisma = {
      administrator: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'adm',
          plan: 'BASE',
          usersMax: 25,
          discountPct: 0,
          status: 'Activa',
        }),
      },
      administratorSubscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return {
      service: new AdminsService(
        prisma as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
      tx,
    };
  }

  it('stores the interval of a manually billed client', async () => {
    const { service, tx } = setup(null);
    await service.update(
      'adm',
      { billingInterval: BillingInterval.year },
      SUPERADMIN,
    );
    expect(tx.administrator.update).toHaveBeenCalledWith({
      where: { id: 'adm' },
      data: { billingInterval: BillingInterval.year },
    });
  });

  it('refuses it while Stripe bills the client (the webhook owns it)', async () => {
    const { service, tx } = setup({
      stripeSubscriptionId: 'sub_1',
      status: 'active',
    });
    await expect(
      service.update(
        'adm',
        { billingInterval: BillingInterval.year },
        SUPERADMIN,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.administrator.update).not.toHaveBeenCalled();
  });
});
