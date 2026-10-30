import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '../prisma/client';
import { BillingService } from './billing.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AdminsService } from '../admins/admins.service';
import type { StripeService } from './stripe.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

function user(role: AppRole, administratorId: string | null = 'admin-1'): AuthenticatedUser {
  return { id: 'user-1', role, estateIds: [], administratorId };
}

describe('BillingService', () => {
  let prisma: any;
  let stripe: any;
  let admins: any;
  let notifications: any;
  let config: ConfigService;
  let service: BillingService;

  beforeEach(() => {
    prisma = {
      administrator: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ status: 'Activa' }),
        update: jest.fn(),
      },
      administratorSubscription: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        // Conditional writes report the rows they matched.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminInvoice: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      adminActivityItem: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Tombstone of a subscription role A detached («Pasar a facturación manual»): none by default.
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
      ),
    };
    stripe = {
      priceIdFor: jest.fn().mockReturnValue('price_base'),
      planForPriceId: jest.fn(),
      createCustomer: jest.fn().mockResolvedValue('cus_new'),
      createSubscriptionCheckoutSession: jest.fn().mockResolvedValue('https://checkout/x'),
      createSetupCheckoutSession: jest.fn().mockResolvedValue('https://checkout/setup'),
      createPortalSession: jest.fn().mockResolvedValue('https://portal/x'),
      changePlan: jest.fn(),
      cancelAtPeriodEnd: jest.fn(),
      retrieveSubscription: jest.fn(),
      setDefaultPaymentMethodFromSetupIntent: jest.fn(),
      constructWebhookEvent: jest.fn(),
    };
    admins = {
      createFiscalInvoiceFromStripe: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    };
    notifications = {
      administratorTeamUserIds: jest.fn().mockResolvedValue(['b1']),
      notify: jest.fn().mockResolvedValue(undefined),
    };
    config = { get: jest.fn().mockReturnValue('http://localhost:4200') } as unknown as ConfigService;

    service = new BillingService(
      prisma as PrismaService,
      stripe as StripeService,
      admins as AdminsService,
      config,
      notifications as NotificationsService,
    );
  });

  describe('openPortal — resolución del customerId', () => {
    // Regresión del IDOR que sí tiene `stripe-customer-portal` en domora-es:
    // ahí el cliente manda su propio stripe_customer_id sin comprobar que
    // sea suyo. Aquí el método ni siquiera acepta un customerId como
    // parámetro — se resuelve entero desde la fila de AdministratorSubscription
    // ligada al administratorId del JWT.
    it('resuelve el customerId SIEMPRE desde la fila de la propia gestora (JWT), nunca de un valor externo', async () => {
      prisma.administrator.findFirst.mockResolvedValue({
        id: 'admin-1',
        billing: null,
        subscription: { administratorId: 'admin-1', stripeCustomerId: 'cus_admin1_real' },
      });

      await service.openPortal(user('B', 'admin-1'));

      expect(prisma.administrator.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1', deletedAt: null } }),
      );
      expect(stripe.createPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_admin1_real' }),
      );
    });

    it('rechaza si el usuario no tiene gestora asociada', async () => {
      await expect(service.openPortal(user('B', null))).rejects.toThrow(ForbiddenException);
      expect(stripe.createPortalSession).not.toHaveBeenCalled();
    });

    it('rechaza si la gestora todavía no tiene ninguna suscripción de Stripe', async () => {
      prisma.administrator.findFirst.mockResolvedValue({ id: 'admin-1', billing: null, subscription: null });
      await expect(service.openPortal(user('B', 'admin-1'))).rejects.toThrow(ConflictException);
    });
  });

  describe('createCheckoutSession — datos de facturación completos', () => {
    // AdminsService.create() SIEMPRE crea una fila AdminBilling (con
    // `address: ''` si no se completó después), así que `admin.billing`
    // nunca es null en la práctica — el guard tiene que mirar los campos,
    // no solo la presencia de la fila.
    it('rechaza si AdminBilling existe pero con campos vacíos (alta recién creada, sin completar)', async () => {
      prisma.administrator.findFirst.mockResolvedValue({
        id: 'admin-1',
        plan: 'BASE',
        usersMax: 10,
        billing: { businessName: 'Gestora Demo', cif: 'B1', address: '', email: '', contactEmail: null },
        subscription: null,
      });

      await expect(service.createCheckoutSession(user('B', 'admin-1'))).rejects.toThrow(ConflictException);
      expect(stripe.createCustomer).not.toHaveBeenCalled();
    });

    it('crea el customer con el email de AdminBilling cuando los datos están completos', async () => {
      prisma.administrator.findFirst.mockResolvedValue({
        id: 'admin-1',
        plan: 'BASE',
        usersMax: 10,
        billing: {
          businessName: 'Gestora Demo',
          cif: 'B1',
          address: 'Calle Real 1',
          email: 'facturacion@demo.com',
        },
        subscription: null,
      });
      prisma.administratorSubscription.upsert.mockResolvedValue({
        administratorId: 'admin-1',
        stripeCustomerId: 'cus_new',
        stripeSubscriptionId: null,
        status: null,
      });

      await service.createCheckoutSession(user('B', 'admin-1'));

      expect(stripe.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'facturacion@demo.com' }),
      );
    });
  });

  describe('changePlan — reajuste de quantity al tramo del plan nuevo', () => {
    // AdminsService.update() ya fuerza `usersMax = firstTier.max` en cada
    // cambio de plan manual (invariante: usersMax siempre es un tramo
    // válido de PLAN_TIERS[plan]). El cambio de plan de autoservicio tiene
    // que respetar el mismo invariante, o un downgrade dejaría en Stripe
    // (y luego, vía el webhook, en Administrator.usersMax) una cantidad de
    // un tramo que no existe en el plan nuevo.
    it('pasa el primer tramo del plan nuevo como quantity, sin importar el usersMax actual', async () => {
      prisma.administrator.findFirst.mockResolvedValue({
        id: 'admin-1',
        billing: null,
        subscription: { stripeSubscriptionId: 'sub_1', status: 'active' },
      });

      await service.changePlan(user('B', 'admin-1'), { plan: 'BASE' } as any);

      // PLAN_TIERS.BASE[0].max === 25 (ver plans.catalog.ts) — nada que ver
      // con el usersMax=300 que pudiera venir de un plan PREMIUM anterior.
      expect(stripe.changePlan).toHaveBeenCalledWith('sub_1', 'price_base', 25);
    });
  });

  describe('webhook: checkout.session.completed', () => {
    it('crea AdministratorSubscription con los datos reales de la suscripción de Stripe', async () => {
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            mode: 'subscription',
            metadata: { administrator_id: 'admin-1' },
            subscription: 'sub_1',
            customer: 'cus_1',
          },
        },
      });
      stripe.retrieveSubscription.mockResolvedValue({
        id: 'sub_1',
        status: 'active',
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: 'price_base', unit_amount: 4900 },
              quantity: 25,
              current_period_end: 1735689600,
            },
          ],
        },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administratorSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { administratorId: 'admin-1' },
          create: expect.objectContaining({
            administratorId: 'admin-1',
            stripeCustomerId: 'cus_1',
            stripeSubscriptionId: 'sub_1',
            status: 'active',
          }),
        }),
      );
    });

    // Único caso en el que una gestora Vencida puede volver a pasar por
    // checkout.session.completed: createCheckoutSession solo lo permite si
    // NO hay una suscripción "activa" en Stripe (ver isActiveStripeSubscription
    // — past_due SÍ cuenta como activa, así que ese caso lo cierra
    // customer.subscription.updated, no este webhook). Aquí el escenario es
    // una suscripción anterior ya 'canceled'/'incomplete_expired' y una
    // nueva de verdad. Stripe no manda `customer.subscription.updated` al
    // CREAR una suscripción — sin este webhook, Vencida se quedaría así para
    // siempre pese al nuevo pago.
    it('una gestora Vencida que vuelve a suscribirse desde cero recupera Activa aquí mismo (Stripe no manda .updated al crear)', async () => {
      prisma.administrator.findUnique.mockResolvedValue({ status: 'Vencida' });
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            mode: 'subscription',
            metadata: { administrator_id: 'admin-1' },
            subscription: 'sub_1',
            customer: 'cus_1',
          },
        },
      });
      stripe.retrieveSubscription.mockResolvedValue({
        id: 'sub_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_base', unit_amount: 4900 }, quantity: 25, current_period_end: 1735689600 }] },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administrator.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1' }, data: expect.objectContaining({ status: 'Activa' }) }),
      );
      expect(prisma.adminActivityItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ administratorId: 'admin-1', title: expect.stringContaining('reactivada automáticamente') }) }),
      );
    });

    it('ignora el evento si falta metadata suficiente, sin lanzar', async () => {
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: { id: 'cs_2', mode: 'subscription', metadata: {}, subscription: null, customer: null },
        },
      });

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
    });

    it('a late retry for a subscription role A detached («Pasar a facturación manual») does not link it again', async () => {
      prisma.adminActivityItem.findUnique.mockResolvedValue({ id: 'tombstone' });
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_old', mode: 'subscription', metadata: { administrator_id: 'admin-1' }, subscription: 'sub_old', customer: 'cus_1' } },
      });

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.adminActivityItem.findUnique).toHaveBeenCalledWith({ where: { externalRef: 'stripe-detached:sub_old' }, select: { id: true } });
      expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
      expect(prisma.administrator.update).not.toHaveBeenCalled();
    });
  });

  describe('webhook: customer.subscription.updated', () => {
    function subscriptionEvent(overrides: Record<string, unknown> = {}) {
      return {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            customer: 'cus_1',
            status: 'active',
            cancel_at_period_end: false,
            metadata: {},
            items: { data: [{ price: { id: 'price_base', unit_amount: 4900 }, quantity: 25, current_period_end: 1735689600 }] },
            ...overrides,
          },
        },
      };
    }

    it('una suscripción anual guarda su MRR mensual (importe ÷ 12) y el intervalo anual', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripePriceId: 'price_base' });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({
        items: { data: [{ price: { id: 'price_base', unit_amount: 58800, recurring: { interval: 'year', interval_count: 1 } }, quantity: 1, current_period_end: 1735689600 }] },
      }));

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      const data = prisma.administrator.update.mock.calls.at(-1)[0].data;
      expect(Number(data.mrr)).toBe(49);
      expect(data.billingInterval).toBe('year');
    });

    it('una suscripción mensual mantiene unit_amount × quantity como MRR y el intervalo mensual', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripePriceId: 'price_base' });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({
        items: { data: [{ price: { id: 'price_base', unit_amount: 4900, recurring: { interval: 'month', interval_count: 1 } }, quantity: 25, current_period_end: 1735689600 }] },
      }));

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      const data = prisma.administrator.update.mock.calls.at(-1)[0].data;
      expect(Number(data.mrr)).toBe(1225);
      expect(data.billingInterval).toBe('month');
    });

    it('actualiza la fila existente cuando ya hay AdministratorSubscription para esa suscripción', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({
        administratorId: 'admin-1',
        stripePriceId: 'price_base',
      });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent());

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      // Only while this subscription is still the linked one (see the race test below).
      expect(prisma.administratorSubscription.updateMany).toHaveBeenCalledWith({
        where: { administratorId: 'admin-1', stripeSubscriptionId: 'sub_1' },
        data: { stripePriceId: 'price_base', status: 'active', currentPeriodEnd: new Date(1735689600 * 1000), cancelAtPeriodEnd: false },
      });
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
    });

    it('if the subscription was detached between the read and the write («Pasar a facturación manual»), changes nothing', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripePriceId: 'price_base', cancelAtPeriodEnd: false });
      prisma.administratorSubscription.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.administrator.findUnique.mockResolvedValue({ status: 'Activa' });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'canceled', cancel_at_period_end: true }));

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
      expect(prisma.administrator.update).not.toHaveBeenCalled();
      expect(prisma.adminActivityItem.create).not.toHaveBeenCalled();
      expect(prisma.adminActivityItem.createMany).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('se auto-repara creando la fila a partir de subscription.metadata cuando llega antes que checkout.session.completed', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(
        subscriptionEvent({ metadata: { administrator_id: 'admin-1' } }),
      );

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administratorSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { administratorId: 'admin-1' },
          create: expect.objectContaining({
            administratorId: 'admin-1',
            stripeCustomerId: 'cus_1',
            stripeSubscriptionId: 'sub_1',
          }),
        }),
      );
    });

    it('registra una «Solicitud de baja» cuando la suscripción pasa a cancelarse al final del periodo, una sola vez por periodo', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripePriceId: 'price_base', cancelAtPeriodEnd: false });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ cancel_at_period_end: true }));

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.adminActivityItem.createMany).toHaveBeenCalledWith({
        data: [{
          administratorId: 'admin-1',
          type: 'cancellation_requested',
          title: 'Solicitud de baja: la suscripción termina el 01/01/2025',
          externalRef: 'stripe-cancel:sub_1:1735689600',
        }],
        skipDuplicates: true,
      });
    });

    it('no registra baja si la suscripción ya estaba marcada para cancelarse o no se cancela', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripePriceId: 'price_base', cancelAtPeriodEnd: true });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ cancel_at_period_end: true }));
      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripePriceId: 'price_base', cancelAtPeriodEnd: false });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent());
      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.adminActivityItem.createMany).not.toHaveBeenCalled();
    });

    it('a late event for a subscription role A detached («Pasar a facturación manual») does not link it again nor restrict the despacho', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue(null);
      prisma.adminActivityItem.findUnique.mockResolvedValue({ id: 'tombstone' });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ id: 'sub_old', status: 'canceled', metadata: { administrator_id: 'admin-1' } }));

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.adminActivityItem.findUnique).toHaveBeenCalledWith({ where: { externalRef: 'stripe-detached:sub_old' }, select: { id: true } });
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
      expect(prisma.administrator.update).not.toHaveBeenCalled();
      expect(prisma.adminActivityItem.createMany).not.toHaveBeenCalled();
    });

    it('a known subscription never pays for the tombstone lookup', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false });
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent());

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');
      expect(prisma.adminActivityItem.findUnique).not.toHaveBeenCalled();
      expect(prisma.administratorSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { administratorId: 'admin-1', stripeSubscriptionId: 'sub_1' } }),
      );
    });

    it('descarta el evento sin lanzar si no hay fila ni metadata resoluble', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ metadata: {} }));

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
    });

    // Bug reportado: ningún webhook tocaba Administrator.status (el campo
    // que lee SubscriptionStatusGuard) — un impago dejaba a la gestora con
    // acceso de escritura completo hasta que alguien de Domora la
    // bloqueaba a mano. Este bloque cubre que el lazo ya cierra solo.
    describe('cierre del lazo de morosidad (Administrator.status)', () => {
      beforeEach(() => {
        prisma.administratorSubscription.findUnique.mockResolvedValue({
          administratorId: 'admin-1',
          stripePriceId: 'price_base',
        });
      });

      // ID 17 — período de gracia: un impago YA NO restringe en el primer
      // intento (ver subscription-status.ts) — arranca pastDueSince y avisa
      // "warning", pero la gestora sigue Activa. SubscriptionGraceCronService
      // es quien restringe de verdad, 7 días después, si sigue sin cobrarse.
      it('un impago (Stripe → past_due) por primera vez arranca el período de gracia y avisa, sin restringir todavía', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Activa' });
        prisma.administratorSubscription.findUnique.mockResolvedValue({
          administratorId: 'admin-1',
          stripePriceId: 'price_base',
          pastDueSince: null,
        });
        stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'past_due' }));

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administratorSubscription.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { administratorId: 'admin-1' }, data: { pastDueSince: expect.any(Date) } }),
        );
        expect(prisma.administrator.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: expect.anything() }) }),
        );
        expect(prisma.adminActivityItem.create).not.toHaveBeenCalled();
        expect(notifications.administratorTeamUserIds).toHaveBeenCalledWith('admin-1');
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            userIds: ['b1'],
            category: 'billing',
            dedupeKey: 'billing:admin-1:warning',
          }),
        );
      });

      it('un segundo past_due mientras la gracia ya está corriendo no reescribe pastDueSince ni avisa de nuevo', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Activa' });
        prisma.administratorSubscription.findUnique.mockResolvedValue({
          administratorId: 'admin-1',
          stripePriceId: 'price_base',
          pastDueSince: new Date('2026-09-20'),
        });
        stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'past_due' }));

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administratorSubscription.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: { pastDueSince: expect.any(Date) } }),
        );
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('la recuperación (Stripe → active) devuelve a la gestora de Vencida a Activa, limpia la gracia y avisa', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Vencida' });
        stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'active' }));

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administrator.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'Activa' }) }),
        );
        expect(prisma.adminActivityItem.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('reactivada automáticamente') }) }),
        );
        expect(prisma.administratorSubscription.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ administratorId: 'admin-1' }), data: { pastDueSince: null } }),
        );
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'billing', dedupeKey: 'billing:admin-1:recovered' }),
        );
      });

      it('ya en Vencida, un nuevo past_due no reescribe el status ni deja actividad de más (pero sí actualiza plan/cupo si cambiaron)', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Vencida' });
        stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'past_due' }));

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administrator.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }),
        );
        expect(prisma.adminActivityItem.create).not.toHaveBeenCalled();
      });

      it('Bloqueada NUNCA se toca automáticamente, ni siquiera si Stripe confirma "active" — solo un humano la desbloquea', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Bloqueada' });
        stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'active' }));

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administrator.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }),
        );
        expect(prisma.adminActivityItem.create).not.toHaveBeenCalled();
      });

      it('Periodo_de_gracia tampoco se toca automáticamente', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Periodo_de_gracia' });
        stripe.constructWebhookEvent.mockReturnValue(subscriptionEvent({ status: 'past_due' }));

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administrator.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }),
        );
      });

      it('sin plan/cupo/importe que cambiar y sin transición de status, no llama a administrator.update en vano', async () => {
        prisma.administrator.findUnique.mockResolvedValue({ status: 'Vencida' });
        stripe.constructWebhookEvent.mockReturnValue(
          subscriptionEvent({
            status: 'past_due',
            items: { data: [{ price: { id: 'price_base', unit_amount: null }, quantity: undefined, current_period_end: 1735689600 }] },
          }),
        );

        await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

        expect(prisma.administrator.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('webhook: customer.subscription.deleted', () => {
    function deletedEvent(overrides: Record<string, unknown> = {}) {
      return {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', status: 'canceled', ...overrides } },
      };
    }

    it('marca la fila de AdministratorSubscription como canceled', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1' });
      stripe.constructWebhookEvent.mockReturnValue(deletedEvent());

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administratorSubscription.updateMany).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_1' },
        data: { status: 'canceled' },
      });
    });

    it('una gestora Activa cuya suscripción se cancela definitivamente pasa a Vencida (cierra el mismo lazo que el impago)', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1' });
      prisma.administrator.findUnique.mockResolvedValue({ status: 'Activa' });
      stripe.constructWebhookEvent.mockReturnValue(deletedEvent());

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administrator.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1' }, data: { status: 'Vencida' } }),
      );
      expect(prisma.adminActivityItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ administratorId: 'admin-1', title: expect.stringContaining('Vencida') }) }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'billing', dedupeKey: 'billing:admin-1:restricted' }),
      );
    });

    it('una gestora Bloqueada sigue sin tocarse aunque Stripe borre la suscripción', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue({ administratorId: 'admin-1' });
      prisma.administrator.findUnique.mockResolvedValue({ status: 'Bloqueada' });
      stripe.constructWebhookEvent.mockReturnValue(deletedEvent());

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administrator.update).not.toHaveBeenCalled();
    });

    it('una suscripción que Domora no tiene registrada no revienta: no hay fila, no se toca Administrator', async () => {
      prisma.administratorSubscription.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(deletedEvent());

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.administrator.update).not.toHaveBeenCalled();
      expect(prisma.administrator.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('webhook: invoice.finalized — idempotencia', () => {
    const FINALIZED_AT_UNIX = 1735689600;
    const invoiceEvent = (id: string) => ({
      type: 'invoice.finalized',
      data: {
        object: {
          id,
          subtotal: 4900,
          customer: 'cus_1',
          parent: { subscription_details: { metadata: { administrator_id: 'admin-1' } } },
          lines: { data: [{ pricing: { price_details: { price: 'price_base' } } }] },
          status_transitions: { finalized_at: FINALIZED_AT_UNIX },
        },
      },
    });

    it('genera la factura fiscal la primera vez que llega el evento, con la fecha real de finalización de Stripe', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(invoiceEvent('in_1'));
      stripe.planForPriceId.mockReturnValue('BASE');

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(admins.createFiscalInvoiceFromStripe).toHaveBeenCalledTimes(1);
      expect(admins.createFiscalInvoiceFromStripe).toHaveBeenCalledWith(
        prisma, 'admin-1', 4900, 'in_1', 'BASE', new Date(FINALIZED_AT_UNIX * 1000),
      );
    });

    it('usa el plan resuelto del price de la propia factura, NO el de Administrator.plan (evita el desorden de entrega de webhooks entre invoice.finalized y customer.subscription.updated)', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(invoiceEvent('in_3'));
      stripe.planForPriceId.mockReturnValue('PREMIUM');

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(stripe.planForPriceId).toHaveBeenCalledWith('price_base');
      expect(admins.createFiscalInvoiceFromStripe).toHaveBeenCalledWith(
        prisma, 'admin-1', 4900, 'in_3', 'PREMIUM', new Date(FINALIZED_AT_UNIX * 1000),
      );
    });

    it('usa un plan genérico si el price de la línea no coincide con ninguno configurado, sin bloquear la factura', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(invoiceEvent('in_4'));
      stripe.planForPriceId.mockReturnValue(null);

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(admins.createFiscalInvoiceFromStripe).toHaveBeenCalledWith(
        prisma, 'admin-1', 4900, 'in_4', 'Domora', new Date(FINALIZED_AT_UNIX * 1000),
      );
    });

    it('recurre a la fecha de proceso si el evento no trae status_transitions.finalized_at', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue(null);
      const event = invoiceEvent('in_5');
      (event.data.object as any).status_transitions = { finalized_at: null };
      stripe.constructWebhookEvent.mockReturnValue(event);
      stripe.planForPriceId.mockReturnValue('BASE');

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(admins.createFiscalInvoiceFromStripe).toHaveBeenCalledWith(
        prisma, 'admin-1', 4900, 'in_5', 'BASE', expect.any(Date),
      );
    });

    it('NO vuelve a generarla si el stripeInvoiceId ya se procesó (reenvío del mismo evento por Stripe)', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue({ id: 'inv-existing', stripeInvoiceId: 'in_1' });
      stripe.constructWebhookEvent.mockReturnValue(invoiceEvent('in_1'));

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(admins.createFiscalInvoiceFromStripe).not.toHaveBeenCalled();
    });

    it('absorbe la carrera entre dos entregas simultáneas del mismo evento (P2002 en stripeInvoiceId) sin propagar el error', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue(invoiceEvent('in_1'));
      admins.createFiscalInvoiceFromStripe.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
    });

    it('no genera nada si no se puede resolver la gestora del evento', async () => {
      prisma.adminInvoice.findUnique.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'invoice.finalized',
        data: { object: { id: 'in_2', subtotal: 4900, customer: null, parent: null } },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(admins.createFiscalInvoiceFromStripe).not.toHaveBeenCalled();
    });
  });

  describe('webhook: invoice.payment_succeeded / invoice.payment_failed', () => {
    it('marca la factura como Pagada', async () => {
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1' } },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.adminInvoice.updateMany).toHaveBeenCalledWith({
        where: { stripeInvoiceId: 'in_1' },
        data: { status: 'Pagada' },
      });
    });

    it('registra «Pago recibido» del cliente una sola vez aunque Stripe reintente el evento', async () => {
      prisma.administratorSubscription.findFirst.mockResolvedValue({ administratorId: 'admin-1' });
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1', customer: 'cus_1', amount_paid: 14399 } },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administratorSubscription.findFirst).toHaveBeenCalledWith({ where: { stripeCustomerId: 'cus_1' }, select: { administratorId: true } });
      expect(prisma.adminActivityItem.createMany).toHaveBeenCalledWith({
        data: [{ administratorId: 'admin-1', type: 'payment_received', title: 'Pago recibido: 143,99 €', externalRef: 'stripe-invoice-paid:in_1' }],
        skipDuplicates: true,
      });
    });

    it('no registra el pago de un cliente que no reconoce', async () => {
      prisma.administratorSubscription.findFirst.mockResolvedValue(null);
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_2', customer: 'cus_x', amount_paid: 100 } },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.adminActivityItem.createMany).not.toHaveBeenCalled();
    });

    it('marca la factura como Vencida y SOLO la suscripción de esta factura como past_due (no todas las de la gestora)', async () => {
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_1',
            customer: 'cus_1',
            parent: {
              subscription_details: {
                metadata: { administrator_id: 'admin-1' },
                subscription: 'sub_old',
              },
            },
          },
        },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.adminInvoice.updateMany).toHaveBeenCalledWith({
        where: { stripeInvoiceId: 'in_1' },
        data: { status: 'Vencida' },
      });
      // Escopado por stripeSubscriptionId, no por administratorId: un evento
      // tardío de una suscripción ya cancelada no debe tocar una nueva
      // suscripción activa de la misma gestora.
      expect(prisma.administratorSubscription.updateMany).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_old' },
        data: { status: 'past_due' },
      });
    });

    it('no toca ninguna suscripción si la factura no trae subscription_details.subscription', async () => {
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_2', customer: 'cus_1' } },
      });

      await service.handleWebhookEvent(Buffer.from('{}'), 'sig');

      expect(prisma.administratorSubscription.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('webhook: eventos no manejados', () => {
    it('no lanza y no toca la base de datos para un tipo de evento fuera del switch', async () => {
      stripe.constructWebhookEvent.mockReturnValue({
        type: 'customer.updated',
        data: { object: {} },
      });

      await expect(service.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
      expect(prisma.administratorSubscription.upsert).not.toHaveBeenCalled();
      expect(prisma.adminInvoice.updateMany).not.toHaveBeenCalled();
    });
  });
});
