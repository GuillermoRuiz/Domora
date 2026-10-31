import { ConflictException, NotFoundException } from '@nestjs/common';
import { BillingInterval, Prisma } from '../prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';

const SUPERADMIN: AuthenticatedUser = {
  id: 'sa',
  role: 'A',
  estateIds: [],
  administratorId: null,
};

/**
 * «Pasar a facturación manual» (odd/tasks/role-a-panel.md T14, S6, S9): role A
 * detaches a dead Stripe subscription so the despacho is read as manually
 * billed. Integration effects (client status, MRR, completitud, webhooks) live
 * in admins-manual-billing.integration.spec.ts.
 */
describe('AdminsService.switchToManualBilling', () => {
  function setup(
    opts: {
      admin?: Record<string, unknown> | null;
      subscription?: Record<string, unknown> | null;
      detached?: number;
    } = {},
  ) {
    const admin =
      opts.admin === undefined
        ? {
            id: 'adm',
            plan: 'BASE',
            usersMax: 25,
            discountPct: new Prisma.Decimal(0),
            status: 'Vencida',
          }
        : opts.admin;
    const subscription =
      opts.subscription === undefined
        ? {
            administratorId: 'adm',
            stripeCustomerId: 'cus_1',
            stripeSubscriptionId: 'sub_1',
            status: 'canceled',
          }
        : opts.subscription;
    const tx = {
      administratorSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: opts.detached ?? 1 }),
      },
      administrator: { update: jest.fn().mockResolvedValue({ id: 'adm' }) },
      adminActivityItem: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      administrator: { findFirst: jest.fn().mockResolvedValue(admin) },
      administratorSubscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new AdminsService(
      prisma as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const findById = jest
      .spyOn(service, 'findById')
      .mockResolvedValue({ id: 'adm', clientStatus: 'Activo' } as never);
    return { service, tx, prisma, findById };
  }

  it.each(['canceled', 'incomplete_expired'])(
    'detaches a %s Stripe subscription, keeping the Stripe customer',
    async (status) => {
      const { service, tx, findById } = setup({
        subscription: {
          administratorId: 'adm',
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          status,
        },
      });

      const result = await service.switchToManualBilling('adm', {}, SUPERADMIN);

      // Conditional on the state that was checked: a webhook landing in between makes it match nothing.
      expect(tx.administratorSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          administratorId: 'adm',
          stripeSubscriptionId: 'sub_1',
          status,
        },
        data: {
          stripeSubscriptionId: null,
          stripePriceId: null,
          status: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pastDueSince: null,
        },
      });
      const data =
        tx.administratorSubscription.updateMany.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('stripeCustomerId');
      expect(result).toEqual({ id: 'adm', clientStatus: 'Activo' });
      expect(findById).toHaveBeenCalledWith('adm');
    },
  );

  it('logs the change in the despacho activity, with the author and a reference to the detached subscription', async () => {
    const { service, tx } = setup();
    await service.switchToManualBilling('adm', {}, SUPERADMIN);
    expect(tx.adminActivityItem.create).toHaveBeenCalledWith({
      data: {
        administratorId: 'adm',
        type: 'plan_change',
        title:
          'Pasada a facturación manual: se desvincula la suscripción de Stripe sub_1 (cancelada)',
        authorUserId: 'sa',
        externalRef: 'stripe-detached:sub_1',
      },
    });
  });

  it('sets the manual MRR from the plan catalogue (tier price net of the discount), as a manual plan change does', async () => {
    const { service, tx } = setup({
      admin: {
        id: 'adm',
        plan: 'STANDARD',
        usersMax: 100,
        discountPct: new Prisma.Decimal(10),
        status: 'Activa',
      },
    });
    await service.switchToManualBilling('adm', {}, SUPERADMIN);
    expect(tx.administrator.update).toHaveBeenCalledWith({
      where: { id: 'adm' },
      data: { mrr: new Prisma.Decimal(116.1) },
    });
  });

  it('reactivates a Vencida despacho and stores the billing interval when role A asks for it in the same action', async () => {
    const { service, tx } = setup();
    await service.switchToManualBilling(
      'adm',
      { activate: true, billingInterval: BillingInterval.year },
      SUPERADMIN,
    );
    expect(tx.administrator.update).toHaveBeenCalledWith({
      where: { id: 'adm' },
      data: {
        mrr: new Prisma.Decimal(49),
        status: 'Activa',
        billingInterval: BillingInterval.year,
      },
    });
    expect(tx.adminActivityItem.create.mock.calls[0][0].data.title).toBe(
      'Pasada a facturación manual: se desvincula la suscripción de Stripe sub_1 (cancelada) · cuenta reactivada · facturación anual',
    );
  });

  it('leaves the status alone when reactivation is not requested', async () => {
    const { service, tx } = setup();
    await service.switchToManualBilling('adm', { activate: false }, SUPERADMIN);
    expect(tx.administrator.update.mock.calls[0][0].data).not.toHaveProperty(
      'status',
    );
  });

  it('refuses to reactivate a Bloqueada despacho: unblocking stays an explicit decision', async () => {
    const { service, tx } = setup({
      admin: {
        id: 'adm',
        plan: 'BASE',
        usersMax: 25,
        discountPct: new Prisma.Decimal(0),
        status: 'Bloqueada',
      },
    });
    await expect(
      service.switchToManualBilling('adm', { activate: true }, SUPERADMIN),
    ).rejects.toThrow(
      new ConflictException(
        'La cuenta está bloqueada: desbloquéala antes de reactivarla.',
      ),
    );
    expect(tx.administratorSubscription.updateMany).not.toHaveBeenCalled();
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])(
    'refuses a live %s Stripe subscription with a 409 and writes nothing',
    async (status) => {
      const { service, tx, prisma } = setup({
        subscription: {
          administratorId: 'adm',
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          status,
        },
      });
      await expect(
        service.switchToManualBilling('adm', {}, SUPERADMIN),
      ).rejects.toThrow(
        new ConflictException(
          'La suscripción de Stripe de este despacho sigue viva: solo se puede pasar a facturación manual cuando está cancelada o caducada. Cancélala primero en Stripe.',
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.administratorSubscription.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no Stripe row at all', null],
    [
      'a Stripe customer without a subscription',
      {
        administratorId: 'adm',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: null,
        status: null,
      },
    ],
  ])('refuses %s: there is nothing to detach', async (_label, subscription) => {
    const { service, prisma } = setup({ subscription });
    await expect(
      service.switchToManualBilling('adm', {}, SUPERADMIN),
    ).rejects.toThrow(
      new ConflictException(
        'Este despacho no tiene ninguna suscripción de Stripe que desvincular: ya se factura manualmente.',
      ),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses when the subscription changed between the check and the write (a Stripe webhook landed)', async () => {
    const { service, tx } = setup({ detached: 0 });
    await expect(
      service.switchToManualBilling('adm', {}, SUPERADMIN),
    ).rejects.toThrow(
      new ConflictException(
        'La suscripción de Stripe acaba de cambiar. Recarga la ficha y vuelve a intentarlo.',
      ),
    );
    expect(tx.administrator.update).not.toHaveBeenCalled();
    expect(tx.adminActivityItem.create).not.toHaveBeenCalled();
  });

  it('404 for an unknown or deleted despacho', async () => {
    const { service } = setup({ admin: null });
    await expect(
      service.switchToManualBilling('nope', {}, SUPERADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminsController — manual billing route', () => {
  it('is for role A only', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminsController.prototype.switchToManualBilling,
      ),
    ).toEqual(['A']);
  });

  it('passes the despacho, the options and the acting user to the service', async () => {
    const service = {
      switchToManualBilling: jest.fn().mockResolvedValue({ id: 'adm' }),
    };
    const controller = new AdminsController(service as never);
    await expect(
      controller.switchToManualBilling('adm', { activate: true }, SUPERADMIN),
    ).resolves.toEqual({ id: 'adm' });
    expect(service.switchToManualBilling).toHaveBeenCalledWith(
      'adm',
      { activate: true },
      SUPERADMIN,
    );
  });
});
