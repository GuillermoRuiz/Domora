import {
  deriveAdminStatusFromStripe,
  isActiveStripeSubscription,
  resolvesPastDueGrace,
} from './subscription-status';

describe('isActiveStripeSubscription', () => {
  it.each(['active', 'trialing', 'past_due', 'paused'])(
    'considera activa una suscripción con stripeSubscriptionId y status "%s"',
    (status) => {
      expect(
        isActiveStripeSubscription({ stripeSubscriptionId: 'sub_1', status }),
      ).toBe(true);
    },
  );

  it.each(['canceled', 'incomplete', 'incomplete_expired', 'unpaid'])(
    'NO considera activa una suscripción con status "%s"',
    (status) => {
      expect(
        isActiveStripeSubscription({ stripeSubscriptionId: 'sub_1', status }),
      ).toBe(false);
    },
  );

  it('sin stripeSubscriptionId nunca es activa, aunque el status lo sea', () => {
    expect(
      isActiveStripeSubscription({
        stripeSubscriptionId: null,
        status: 'active',
      }),
    ).toBe(false);
  });

  it('sin status no es activa', () => {
    expect(
      isActiveStripeSubscription({
        stripeSubscriptionId: 'sub_1',
        status: null,
      }),
    ).toBe(false);
  });

  it('null/undefined no son activas', () => {
    expect(isActiveStripeSubscription(null)).toBe(false);
    expect(isActiveStripeSubscription(undefined)).toBe(false);
  });
});

describe('deriveAdminStatusFromStripe', () => {
  describe('desde Activa', () => {
    it.each(['unpaid', 'canceled', 'incomplete_expired'])(
      'un estado terminal de Stripe ("%s") cierra el lazo: pasa a Vencida',
      (stripeStatus) => {
        expect(deriveAdminStatusFromStripe('Activa', stripeStatus)).toBe(
          'Vencida',
        );
      },
    );

    // ID 17 — período de gracia: 'past_due' ya NO restringe aquí (es apenas
    // el primer intento fallido de hasta 8 reintentos que Stripe corre en 2
    // semanas). BillingService.applyAdminStatusFromStripe lo trata aparte,
    // arrancando un período de gracia de 7 días en vez de llamar a esta
    // función para ese caso.
    it('un primer "past_due" NO cierra el lazo aquí — lo maneja el período de gracia de BillingService', () => {
      expect(deriveAdminStatusFromStripe('Activa', 'past_due')).toBeNull();
    });

    it.each(['active', 'trialing'])(
      'si ya está Activa y Stripe confirma "%s", no hay nada que cambiar',
      (s) => {
        expect(deriveAdminStatusFromStripe('Activa', s)).toBeNull();
      },
    );

    it.each(['incomplete', 'paused'])(
      'estados transitorios de Stripe ("%s") no mueven nada',
      (s) => {
        expect(deriveAdminStatusFromStripe('Activa', s)).toBeNull();
      },
    );
  });

  describe('desde Vencida', () => {
    it.each(['active', 'trialing'])(
      'el pago se recupera ("%s") → vuelve a Activa',
      (stripeStatus) => {
        expect(deriveAdminStatusFromStripe('Vencida', stripeStatus)).toBe(
          'Activa',
        );
      },
    );

    it.each(['past_due', 'unpaid', 'canceled'])(
      'sigue fallando ("%s") → se queda en Vencida (null, no reescribe)',
      (s) => {
        expect(deriveAdminStatusFromStripe('Vencida', s)).toBeNull();
      },
    );
  });

  describe('Periodo de gracia y Bloqueada — solo las cambia una persona, nunca un webhook', () => {
    it.each(['past_due', 'active', 'canceled', 'trialing'])(
      'en Periodo_de_gracia, ningún status de Stripe ("%s") la mueve automáticamente',
      (s) => {
        expect(deriveAdminStatusFromStripe('Periodo_de_gracia', s)).toBeNull();
      },
    );

    it.each(['past_due', 'active', 'canceled', 'trialing'])(
      'Bloqueada NUNCA se desbloquea sola por un evento de Stripe ("%s") — evita deshacer en silencio un bloqueo manual',
      (s) => {
        expect(deriveAdminStatusFromStripe('Bloqueada', s)).toBeNull();
      },
    );
  });
});

describe('resolvesPastDueGrace', () => {
  it.each(['unpaid', 'canceled', 'incomplete_expired', 'active', 'trialing'])(
    '"%s" sí puede resolver una gracia abierta (recuperación o restricción terminal)',
    (s) => {
      expect(resolvesPastDueGrace(s)).toBe(true);
    },
  );

  it.each(['past_due', 'incomplete', 'paused'])(
    '"%s" NO resuelve nada por sí solo — un past_due repetido no debe soltar el reloj de gracia',
    (s) => {
      expect(resolvesPastDueGrace(s)).toBe(false);
    },
  );
});
