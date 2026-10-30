import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { PlanTier } from '../prisma/client';

/**
 * Envoltorio fino del SDK oficial de Stripe para Node (paquete `stripe`,
 * no la versión Deno/esm.sh que usa `domora-es`). Degrada en vez de
 * arrancar rota cuando falta `STRIPE_SECRET_KEY` — mismo criterio que
 * `MailService` sin `SMTP_HOST`: en producción `env.validation.ts` exige
 * la clave y aborta el arranque; fuera de producción, cada llamada real
 * falla con un 503 explícito en vez de un `TypeError` críptico.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;
  private readonly priceIds: Partial<Record<PlanTier, string>>;

  constructor(private readonly config: ConfigService) {
    // `env.validation.ts` valida estas mismas claves ya recortadas (su
    // helper `read()` hace `.trim()`) — si aquí se leyeran sin recortar,
    // un valor con un espacio o salto de línea al final (típico al copiar
    // desde un gestor de secretos) pasaría la validación de arranque
    // igualmente, pero `new Stripe(secretKey)` fallaría en cada llamada
    // real por autenticación. Se recorta aquí con el mismo criterio para
    // que "validado" y "usado" sean siempre el mismo valor.
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    this.client = secretKey ? new Stripe(secretKey) : null;
    this.priceIds = {
      BASE: this.config.get<string>('STRIPE_PRICE_BASE')?.trim() || undefined,
      STANDARD: this.config.get<string>('STRIPE_PRICE_STANDARD')?.trim() || undefined,
      PREMIUM: this.config.get<string>('STRIPE_PRICE_PREMIUM')?.trim() || undefined,
    };
    if (!secretKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY no configurada — StripeService degradado, cualquier llamada real devolverá 503.',
      );
    }
  }

  private requireClient(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'La facturación por Stripe no está configurada en este entorno.',
      );
    }
    return this.client;
  }

  priceIdFor(plan: PlanTier): string {
    const id = this.priceIds[plan];
    if (!id) {
      throw new ServiceUnavailableException(
        `No hay Price de Stripe configurado para el plan ${plan}.`,
      );
    }
    return id;
  }

  /** Plan cuyo Price coincide con el recibido en un evento del webhook — null si no coincide con ninguno de los 3 configurados. */
  planForPriceId(priceId: string): PlanTier | null {
    const entry = (Object.entries(this.priceIds) as [PlanTier, string | undefined][]).find(
      ([, id]) => id === priceId,
    );
    return entry?.[0] ?? null;
  }

  async createCustomer(params: {
    email: string;
    name: string;
    administratorId: string;
  }): Promise<string> {
    const stripe = this.requireClient();
    const customer = await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { administrator_id: params.administratorId },
    });
    return customer.id;
  }

  /** Alta de la suscripción inicial — Checkout modo `subscription`, quantity = usersMax (ver decisión de diseño #2 del plan). */
  async createSubscriptionCheckoutSession(params: {
    customerId: string;
    priceId: string;
    quantity: number;
    administratorId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const stripe = this.requireClient();
    const session = await stripe.checkout.sessions.create({
      customer: params.customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      locale: 'es',
      line_items: [{ price: params.priceId, quantity: params.quantity }],
      // automatic_tax desactivado a propósito: el único cálculo de IVA
      // español válido para la factura fiscal es el que hace
      // AdminsService.createFiscalInvoice (21% fijo, RD 1619/2012) — si
      // Stripe calculara también su propio impuesto, tendríamos dos
      // fuentes de verdad fiscal potencialmente distintas.
      subscription_data: { metadata: { administrator_id: params.administratorId } },
      metadata: { administrator_id: params.administratorId },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    return this.requireUrl(session);
  }

  /** Añadir/actualizar tarjeta sin cobrar — Checkout modo `setup`. */
  async createSetupCheckoutSession(params: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const stripe = this.requireClient();
    const session = await stripe.checkout.sessions.create({
      customer: params.customerId,
      mode: 'setup',
      payment_method_types: ['card'],
      locale: 'es',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    return this.requireUrl(session);
  }

  async createPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<string> {
    const stripe = this.requireClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return session.url;
  }

  /**
   * Cambio de plan (igual que `stripe-subscription-update` modo
   * `change_plan` en domora-es). `proration_behavior: 'none'` solo difiere
   * el COBRO de la diferencia a la próxima factura — el precio del ítem
   * de la suscripción cambia de inmediato en Stripe con esta llamada, no
   * al siguiente ciclo. `quantity` se reajusta también aquí — sin esto, un
   * cambio de plan dejaría el `quantity` (→ `usersMax`) del plan anterior
   * intacto, que puede no ser válido en el nuevo (p.ej. 300 usuarios no
   * existe como tramo en BASE) — mismo invariante que ya aplica
   * `AdminsService.update()` en el cambio de plan manual.
   */
  async changePlan(
    subscriptionId: string,
    newPriceId: string,
    quantity: number,
  ): Promise<Stripe.Subscription> {
    const stripe = this.requireClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    return stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: newPriceId, quantity }],
      proration_behavior: 'none',
    });
  }

  async cancelAtPeriodEnd(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.requireClient();
    return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }

  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.requireClient().subscriptions.retrieve(subscriptionId);
  }

  /** Fija como método de pago por defecto la tarjeta capturada en una sesión de Checkout modo `setup`. */
  async setDefaultPaymentMethodFromSetupIntent(
    customerId: string,
    setupIntentId: string,
  ): Promise<void> {
    const stripe = this.requireClient();
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;
    if (!paymentMethodId) return;
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  /** Verifica la firma HMAC del payload — nunca se procesa un evento sin pasar por aquí. */
  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const stripe = this.requireClient();
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!webhookSecret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET no configurado.');
    }
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  private requireUrl(session: Stripe.Checkout.Session): string {
    if (!session.url) {
      throw new ServiceUnavailableException('Stripe no devolvió una URL de checkout.');
    }
    return session.url;
  }
}
