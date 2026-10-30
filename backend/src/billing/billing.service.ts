import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminActivityType, BillingInterval, Prisma, type PlanTier } from '../prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins/admins.service';
import { StripeService } from './stripe.service';
import { resolveFrontendBaseUrl } from '../common/frontend-url';
import { deriveAdminStatusFromStripe, detachedSubscriptionRef, isActiveStripeSubscription, resolvesPastDueGrace } from '../common/subscription-status';
import { PLAN_TIERS } from '../admins/plans.catalog';
import { monthlyAmountFromPrice } from '../platform-metrics/mrr';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ChangePlanDto } from './dto/billing.dto';

/** Las 3 fases del aviso de morosidad — ver ID 17 (período de gracia). */
type BillingNotifyPhase = 'warning' | 'restricted' | 'recovered';

const BILLING_NOTIFY_COPY: Record<BillingNotifyPhase, { title: string; body: string }> = {
  warning: {
    title: 'Tu pago falló — regularizalo antes de 7 días',
    body: 'No pudimos cobrar tu suscripción. Actualiza tu método de pago o tu cuenta pasará a solo lectura.',
  },
  restricted: {
    title: 'Tu cuenta pasó a modo solo lectura',
    body: 'Tu suscripción sigue sin cobrarse. Puedes seguir consultando tus datos, pero no crear ni modificar nada hasta regularizar el pago.',
  },
  recovered: {
    title: 'Pago confirmado — tu cuenta volvió a la normalidad',
    body: 'Recibimos tu pago. Ya puedes crear y modificar todo con normalidad.',
  },
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly admins: AdminsService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private frontendBaseUrl(): string {
    return resolveFrontendBaseUrl(this.config);
  }

  private successUrl(): string {
    return `${this.frontendBaseUrl()}/b/subscription?billing=success`;
  }

  private cancelUrl(): string {
    return `${this.frontendBaseUrl()}/b/subscription?billing=canceled`;
  }

  /** Resuelve la gestora del usuario autenticado — nunca se acepta un administratorId del cliente. */
  private async requireAdmin(user: AuthenticatedUser) {
    if (!user.administratorId) {
      throw new ForbiddenException('Usuario sin gestora asociada.');
    }
    const admin = await this.prisma.administrator.findFirst({
      where: { id: user.administratorId, deletedAt: null },
      include: { billing: true, subscription: true },
    });
    if (!admin) {
      throw new NotFoundException('Gestora no encontrada.');
    }
    return admin;
  }

  /**
   * `status === 'canceled'` cuenta como "sin suscripción" a efectos de
   * cambiar de plan o volver a cancelar: `customer.subscription.deleted`
   * (onSubscriptionDeleted) marca este estado pero NUNCA borra
   * `stripeSubscriptionId` — comprobar solo su presencia dejaría intentar
   * estas operaciones sobre una suscripción que Stripe ya considera
   * terminada, y el error real vendría de la API de Stripe en vez de este
   * mensaje claro. Recibe la relación ya cargada por `requireAdmin` — nunca
   * vuelve a consultarla.
   */
  private requireSubscription(sub: { stripeSubscriptionId: string | null; status: string | null } | null) {
    if (!isActiveStripeSubscription(sub)) {
      throw new ConflictException('Todavía no tienes una suscripción activa en Stripe.');
    }
    return sub;
  }

  /**
   * Crea el customer de Stripe la primera vez y lo cachea — nunca se vuelve
   * a crear uno nuevo para la misma gestora. La comprobación inicial es
   * check-then-create (barata, evita llamar a Stripe en el caso común),
   * pero la escritura final es un `upsert` a propósito: si dos peticiones
   * concurrentes (doble clic, dos pestañas) pasan ambas la comprobación,
   * el `create` plano revienta la segunda con un conflicto de PK; el
   * `upsert` con `update: {}` deja que la que pierda la carrera se quede
   * con la fila que ya escribió la otra, en vez de un 500 sin manejar. El
   * customer de Stripe "perdedor" queda huérfano en Stripe (aceptable,
   * es solo un registro de más ahí) — lo que no es aceptable es que la app
   * se caiga por una condición de carrera de un doble clic.
   */
  private async ensureCustomer(
    admin: Prisma.AdministratorGetPayload<{ include: { billing: true; subscription: true } }>,
  ) {
    if (admin.subscription) return admin.subscription;

    // Solo en la rama de creación (reutilizar un customer ya cacheado no
    // necesita esto): sin datos de facturación, el customer de Stripe se
    // crearía con email vacío, y más adelante createFiscalInvoiceFromStripe
    // fallaría igualmente al llegar el primer invoice.finalized — mejor
    // bloquearlo aquí, en el único sitio donde se crea un customer nuevo
    // de verdad, que duplicar la misma comprobación en cada método público
    // que pueda acabar llamando a esta función.
    //
    // Comprueba los campos, no solo que la fila exista: AdminsService.create()
    // ya crea siempre un AdminBilling (con `address: ''` y, si no se dio
    // contactEmail en el alta, `email: ''`), así que `!admin.billing` nunca
    // es cierto en la práctica — un `!admin.billing` a secas dejaría pasar
    // exactamente el caso vacío que este guard existe para bloquear.
    const billing = admin.billing;
    if (!billing?.address || !billing?.email) {
      throw new ConflictException(
        'Completa los datos de facturación (razón social, CIF y domicilio) antes de dar de alta el método de pago.',
      );
    }

    const customerId = await this.stripe.createCustomer({
      email: billing.email,
      name: billing.businessName || admin.name,
      administratorId: admin.id,
    });
    return this.prisma.administratorSubscription.upsert({
      where: { administratorId: admin.id },
      update: {},
      create: { administratorId: admin.id, stripeCustomerId: customerId },
    });
  }

  async createCheckoutSession(user: AuthenticatedUser): Promise<{ url: string }> {
    const admin = await this.requireAdmin(user);
    // La comprobación de datos de facturación completos vive en
    // ensureCustomer() (única fuente de verdad, ver su comentario) — sin
    // esto, una suscripción de Stripe podía activarse antes de que la
    // gestora tuviera CIF/razón social/domicilio cargados, y cuando llegara
    // el primer invoice.finalized, createFiscalInvoiceFromStripe fallaría
    // con dinero ya cobrado por Stripe pero sin su registro fiscal
    // (Verifactu) correspondiente.
    const sub = await this.ensureCustomer(admin);
    // Evita una segunda suscripción activa para la misma gestora si el
    // botón "Configurar pago" se pulsa dos veces antes de que el webhook
    // confirme la primera (p.ej. webhook mal configurado o simplemente
    // lento) — sin esto, Stripe llegaría a cobrar dos suscripciones y el
    // upsert por administratorId en onCheckoutSessionCompleted perdería
    // la referencia a la primera, que quedaría cobrando para siempre sin
    // forma de cancelarla desde Domora.
    if (isActiveStripeSubscription(sub)) {
      throw new ConflictException(
        'Ya tienes una suscripción activa en Stripe. Gestiónala desde el portal de facturación.',
      );
    }
    const priceId = this.stripe.priceIdFor(admin.plan);
    const url = await this.stripe.createSubscriptionCheckoutSession({
      customerId: sub.stripeCustomerId,
      priceId,
      quantity: admin.usersMax,
      administratorId: admin.id,
      successUrl: this.successUrl(),
      cancelUrl: this.cancelUrl(),
    });
    return { url };
  }

  async createSetupPaymentMethodSession(user: AuthenticatedUser): Promise<{ url: string }> {
    const admin = await this.requireAdmin(user);
    const sub = await this.ensureCustomer(admin);
    const url = await this.stripe.createSetupCheckoutSession({
      customerId: sub.stripeCustomerId,
      successUrl: this.successUrl(),
      cancelUrl: this.cancelUrl(),
    });
    return { url };
  }

  /**
   * Portal de cliente de Stripe. El `customerId` se resuelve SIEMPRE aquí,
   * desde la fila que ya pertenece a la gestora del usuario autenticado —
   * nunca se acepta uno enviado por el cliente. Es la corrección explícita
   * del IDOR que sí tiene `stripe-customer-portal` en domora-es (confía en
   * el `stripe_customer_id` que manda el propio front).
   */
  async openPortal(user: AuthenticatedUser): Promise<{ url: string }> {
    const admin = await this.requireAdmin(user);
    if (!admin.subscription) {
      throw new ConflictException('Todavía no tienes una suscripción de Stripe asociada.');
    }
    const url = await this.stripe.createPortalSession({
      customerId: admin.subscription.stripeCustomerId,
      returnUrl: `${this.frontendBaseUrl()}/b/subscription`,
    });
    return { url };
  }

  /**
   * Cambio de plan — `proration_behavior: 'none'` en Stripe: no se cobra
   * nada de más ahora, pero el precio del ítem SÍ cambia de inmediato en
   * Stripe (solo el importe cobrado queda diferido a la próxima factura,
   * no el plan en sí). No se escribe `Administrator.plan` aquí: lo hace
   * `onSubscriptionUpdated` cuando llega el webhook de confirmación —
   * típicamente en segundos, no en el próximo ciclo — para que la BD
   * nunca muestre un plan que Stripe todavía no ha confirmado.
   *
   * `quantity` se reajusta siempre al primer tramo del plan nuevo — mismo
   * invariante que ya aplica AdminsService.update() en el cambio de plan
   * manual (`data.usersMax = firstTier.max`). Sin esto, un downgrade
   * dejaría en Stripe el `quantity` del plan anterior, que puede no
   * corresponder a ningún tramo válido del nuevo (p.ej. 300 usuarios no
   * existe en BASE) — onSubscriptionUpdated lo persistiría tal cual.
   */
  async changePlan(user: AuthenticatedUser, dto: ChangePlanDto): Promise<void> {
    const admin = await this.requireAdmin(user);
    const sub = this.requireSubscription(admin.subscription);
    const newPriceId = this.stripe.priceIdFor(dto.plan);
    const quantity = PLAN_TIERS[dto.plan][0].max;
    await this.stripe.changePlan(sub.stripeSubscriptionId, newPriceId, quantity);
  }

  async cancelSubscription(user: AuthenticatedUser): Promise<void> {
    const admin = await this.requireAdmin(user);
    const sub = this.requireSubscription(admin.subscription);
    await this.stripe.cancelAtPeriodEnd(sub.stripeSubscriptionId);
  }

  // ── Webhook ──────────────────────────────────────────────────────────

  /** Único punto de entrada de eventos de Stripe — nunca se procesa nada sin pasar por `constructWebhookEvent` (verifica la firma). */
  async handleWebhookEvent(payload: Buffer, signature: string): Promise<void> {
    const event = this.stripe.constructWebhookEvent(payload, signature);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.finalized':
        await this.onInvoiceFinalized(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await this.onInvoicePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event.data.object);
        break;
      default:
        // Resto de eventos: ignorados a propósito, no forman parte del
        // ciclo de facturación de Domora.
        break;
    }
  }

  /** current_period_end vive en el item de la suscripción en esta versión de la API, no en la suscripción misma. */
  private periodEnd(subscription: Stripe.Subscription): Date | null {
    const seconds = subscription.items.data[0]?.current_period_end;
    return seconds ? new Date(seconds * 1000) : null;
  }

  /**
   * `unit_amount * quantity` en euros llevado a mes (una cuota anual cuenta
   * 1/12) y el intervalo de facturación — compartido entre
   * onCheckoutSessionCompleted y onSubscriptionUpdated.
   */
  private mrrFromItem(item: Stripe.SubscriptionItem | undefined): { mrr?: Prisma.Decimal; billingInterval?: BillingInterval } {
    const recurring = item?.price.recurring;
    const monthly = monthlyAmountFromPrice({
      unitAmount: item?.price.unit_amount,
      quantity: item?.quantity,
      interval: recurring?.interval,
      intervalCount: recurring?.interval_count,
    });
    return {
      ...(monthly !== undefined && { mrr: new Prisma.Decimal(monthly) }),
      ...(recurring && { billingInterval: recurring.interval === 'year' ? BillingInterval.year : BillingInterval.month }),
    };
  }

  private async onCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    if (session.mode === 'setup') {
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const setupIntentId =
        typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
      if (customerId && setupIntentId) {
        await this.stripe.setDefaultPaymentMethodFromSetupIntent(customerId, setupIntentId);
      }
      return;
    }
    if (session.mode !== 'subscription') return;

    const administratorId = session.metadata?.['administrator_id'];
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!administratorId || !subscriptionId || !customerId) {
      this.logger.warn(`checkout.session.completed sin metadata suficiente (session ${session.id}).`);
      return;
    }
    if (await this.wasDetached(subscriptionId)) return;

    // El guard de createCheckoutSession (comprobar-y-luego-actuar) no es
    // atómico: dos checkouts casi simultáneos (dos pestañas) pueden pasar
    // ambos la comprobación y completarse los dos, generando DOS
    // suscripciones de Stripe reales y pagadas para la misma gestora. No se
    // puede prevenir del todo sin un bloqueo distribuido, y el upsert de
    // abajo SÍ sobrescribe igualmente el stripeSubscriptionId anterior por
    // el más reciente (es lo correcto: refleja lo último que Stripe
    // confirma) — lo que este log añade es la única pista de que la
    // suscripción anterior sigue cobrando huérfana y hay que cancelarla a
    // mano desde el dashboard de Stripe, no evita el propio overwrite.
    // Ninguna depende del resultado de la otra — una consulta a la propia
    // BD (por administratorId) y una llamada a la API de Stripe (por
    // subscriptionId) — así que van en paralelo: este webhook conviene
    // confirmarlo rápido, Stripe reintenta si tarda.
    const [previous, subscription] = await Promise.all([
      this.prisma.administratorSubscription.findUnique({ where: { administratorId } }),
      this.stripe.retrieveSubscription(subscriptionId),
    ]);
    if (isActiveStripeSubscription(previous) && previous.stripeSubscriptionId !== subscriptionId) {
      this.logger.error(
        `Doble checkout detectado para la gestora ${administratorId}: la suscripción ${previous.stripeSubscriptionId} ya estaba activa y ahora se registra también ${subscriptionId}. Ambas están cobrando en Stripe — hay que cancelar una manualmente desde el dashboard de Stripe.`,
      );
    }

    const item = subscription.items.data[0];
    const amount = this.mrrFromItem(item);
    const subData = {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: item?.price.id ?? null,
      status: subscription.status,
      currentPeriodEnd: this.periodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };

    const phase = await this.prisma.$transaction(async (tx) => {
      await tx.administratorSubscription.upsert({
        where: { administratorId },
        update: subData,
        create: { administratorId, ...subData },
      });
      // Cierra también aquí el lazo de morosidad: una gestora Vencida cuya
      // suscripción anterior había quedado 'canceled'/'incomplete_expired'
      // (única forma de que createCheckoutSession la deje pasar de nuevo —
      // ver isActiveStripeSubscription) puede volver a suscribirse desde
      // cero. Stripe no manda `customer.subscription.updated` al CREAR una
      // suscripción (solo `.created`, que este webhook no escucha) — sin
      // esto, la gestora seguiría en Vencida pese a pagar, hasta que algún
      // evento posterior no relacionado la tocara por casualidad.
      return this.applyAdminStatusFromStripe(
        tx,
        administratorId,
        subscription.status,
        amount,
      );
    });
    if (phase) await this.notifyBillingPhase(administratorId, phase);
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const existing = await this.prisma.administratorSubscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    // Stripe no garantiza el orden de entrega entre checkout.session.completed
    // (que normalmente crea esta fila) y customer.subscription.updated — si
    // este evento llega antes, se auto-repara creando la fila aquí mismo a
    // partir de los metadatos que ya lleva la propia suscripción
    // (`subscription_data.metadata` en createSubscriptionCheckoutSession),
    // en vez de descartar el evento sin más.
    // Not ours by id: it may be a subscription role A detached («Pasar a
    // facturación manual»), whose id was cleared. Linking it again by its
    // metadata would turn the despacho back into a canceled Stripe client.
    if (!existing && (await this.wasDetached(subscription.id))) return;
    const administratorId = existing?.administratorId ?? subscription.metadata?.['administrator_id'];
    if (!administratorId) {
      this.logger.warn(
        `customer.subscription.updated para una suscripción no registrada y sin metadata resoluble (${subscription.id}).`,
      );
      return;
    }

    const item = subscription.items.data[0];
    const priceId = item?.price.id;
    const plan = priceId ? this.stripe.planForPriceId(priceId) : null;
    const quantity = item?.quantity;
    const amount = this.mrrFromItem(item);
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    // Refleja en Administrator el plan/cupo/importe REAL vigente en
    // Stripe — el cambio de plan (proration_behavior: 'none') y la
    // ampliación de unidades solo son efectivos cuando Stripe lo confirma
    // aquí, no en el momento en que BillingController los solicitó. Misma
    // `$transaction` que onCheckoutSessionCompleted: sin ella, un fallo
    // entre las dos escrituras dejaría Administrator desincronizado del
    // AdministratorSubscription que se supone que refleja.
    const subData = {
      stripePriceId: priceId ?? existing?.stripePriceId ?? null,
      status: subscription.status,
      currentPeriodEnd: this.periodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        // Conditional on the subscription still being the linked one: role A
        // may have detached it («Pasar a facturación manual») after the read
        // above. An upsert by administratorId would then write this
        // subscription's state back onto the detached row (and restrict the
        // despacho), so nothing at all is changed.
        const linked = await tx.administratorSubscription.updateMany({
          where: { administratorId, stripeSubscriptionId: subscription.id },
          data: subData,
        });
        if (linked.count === 0) return { applied: false as const };
      } else {
        await tx.administratorSubscription.upsert({
          where: { administratorId },
          update: subData,
          create: {
            administratorId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            ...subData,
            stripePriceId: priceId ?? null,
          },
        });
      }
      const phase = await this.applyAdminStatusFromStripe(
        tx,
        administratorId,
        subscription.status,
        {
          plan,
          usersMax: quantity,
          ...amount,
        },
      );
      return { applied: true as const, phase };
    });
    if (!outcome.applied) {
      this.logger.log(`customer.subscription.updated ignorado: la suscripción ${subscription.id} se desvinculó mientras se procesaba.`);
      return;
    }
    if (outcome.phase) await this.notifyBillingPhase(administratorId, outcome.phase);

    // «Solicitud de baja»: solo en la transición a cancelar al cierre del periodo.
    if (subscription.cancel_at_period_end && !existing?.cancelAtPeriodEnd) {
      const periodEnd = item?.current_period_end;
      await this.recordBusinessEvent(
        administratorId,
        AdminActivityType.cancellation_requested,
        periodEnd
          ? `Solicitud de baja: la suscripción termina el ${formatDate(new Date(periodEnd * 1000))}`
          : 'Solicitud de baja',
        `stripe-cancel:${subscription.id}:${periodEnd ?? 'sin-fecha'}`,
      );
    }
  }

  /** Transición compartida Activa→Vencida — la usan tanto un estado terminal de Stripe como el cron de gracia agotada (`restrictForExpiredGrace`), para no duplicar el update+actividad en dos sitios. */
  private async restrictAdministrator(
    tx: Prisma.TransactionClient,
    administratorId: string,
    reason: string,
  ): Promise<void> {
    await tx.administrator.update({
      where: { id: administratorId },
      data: { status: 'Vencida' },
    });
    await tx.administratorSubscription.updateMany({
      where: { administratorId, pastDueSince: { not: null } },
      data: { pastDueSince: null },
    });
    await tx.adminActivityItem.create({
      data: {
        administratorId,
        type: 'block',
        title: `Cuenta pasada a Vencida automáticamente (${reason})`,
        authorUserId: null,
      },
    });
  }

  /** Transición compartida Vencida→Activa — contraparte de `restrictAdministrator`. */
  private async reactivateAdministrator(
    tx: Prisma.TransactionClient,
    administratorId: string,
  ): Promise<void> {
    await tx.administrator.update({
      where: { id: administratorId },
      data: { status: 'Activa' },
    });
    await tx.administratorSubscription.updateMany({
      where: { administratorId, pastDueSince: { not: null } },
      data: { pastDueSince: null },
    });
    await tx.adminActivityItem.create({
      data: {
        administratorId,
        type: 'block',
        title: 'Cuenta reactivada automáticamente (pago confirmado en Stripe)',
        authorUserId: null,
      },
    });
  }

  /**
   * Cierra el lazo de morosidad (bug reportado: ningún webhook tocaba
   * `Administrator.status`, que es el campo que de verdad lee
   * `SubscriptionStatusGuard` — un impago dejaba a la gestora con acceso de
   * escritura completo hasta que alguien de Domora la bloqueaba a mano).
   * Se llama desde `onCheckoutSessionCompleted`, `onSubscriptionUpdated` y
   * `onSubscriptionDeleted`.
   *
   * `'past_due'` NO restringe de inmediato (ver ID 17, período de gracia):
   * arranca `AdministratorSubscription.pastDueSince` la primera vez (si la
   * gestora estaba `'Activa'`) y devuelve la fase `'warning'` para que el
   * llamador avise — `SubscriptionGraceCronService` es quien de verdad
   * restringe, 7 días después, si para entonces sigue sin cobrarse.
   *
   * `extra` son los otros campos de `Administrator` que el llamador ya
   * quería escribir en la misma operación (plan/cupo/importe) — se
   * escriben en un `update` aparte, solo si hay algo que cambiar.
   *
   * Devuelve la fase de aviso a disparar DESPUÉS de que la transacción
   * confirme (nunca dentro: un rollback no debe haber mandado ya un email) —
   * `null` si no hay nada que avisar.
   */
  private async applyAdminStatusFromStripe(
    tx: Prisma.TransactionClient,
    administratorId: string,
    stripeStatus: string,
    extra: { plan?: PlanTier | null; usersMax?: number; mrr?: Prisma.Decimal; billingInterval?: BillingInterval },
  ): Promise<BillingNotifyPhase | null> {
    const admin = await tx.administrator.findUnique({
      where: { id: administratorId },
      select: { status: true },
    });
    let phase: BillingNotifyPhase | null = null;

    if (admin) {
      if (stripeStatus === 'past_due') {
        if (admin.status === 'Activa') {
          const sub = await tx.administratorSubscription.findUnique({
            where: { administratorId },
            select: { pastDueSince: true },
          });
          if (!sub?.pastDueSince) {
            await tx.administratorSubscription.update({
              where: { administratorId },
              data: { pastDueSince: new Date() },
            });
            phase = 'warning';
          }
        }
        // admin.status !== 'Activa': ya está 'Vencida' (gracia agotada o
        // estado terminal previo) o en un estado manual — un reintento más
        // de Stripe no cambia nada aquí.
      } else if (resolvesPastDueGrace(stripeStatus)) {
        const newStatus = deriveAdminStatusFromStripe(admin.status, stripeStatus);
        if (newStatus === 'Vencida') {
          await this.restrictAdministrator(tx, administratorId, `Stripe: ${stripeStatus}`);
          phase = 'restricted';
        } else if (newStatus === 'Activa') {
          await this.reactivateAdministrator(tx, administratorId);
          phase = 'recovered';
        } else {
          // Administrator.status ya estaba donde corresponde (p. ej. ya
          // 'Vencida' y llega otro 'canceled'), pero el período de gracia,
          // si había uno abierto, ya no aplica.
          await tx.administratorSubscription.updateMany({
            where: { administratorId, pastDueSince: { not: null } },
            data: { pastDueSince: null },
          });
        }
      }
    }

    if (extra.plan || extra.usersMax !== undefined || extra.mrr !== undefined || extra.billingInterval) {
      await tx.administrator.update({
        where: { id: administratorId },
        data: {
          ...(extra.plan && { plan: extra.plan }),
          ...(extra.usersMax !== undefined && { usersMax: extra.usersMax }),
          ...(extra.mrr !== undefined && { mrr: extra.mrr }),
          ...(extra.billingInterval && { billingInterval: extra.billingInterval }),
        },
      });
    }

    return phase;
  }

  /** Copy + destinatarios de las 3 fases del aviso de morosidad — después de que la transacción que las originó ya haya confirmado. */
  private async notifyBillingPhase(
    administratorId: string,
    phase: BillingNotifyPhase,
  ): Promise<void> {
    const userIds = await this.notifications.administratorTeamUserIds(administratorId);
    const copy = BILLING_NOTIFY_COPY[phase];
    await this.notifications.notify({
      userIds,
      category: 'billing',
      title: copy.title,
      body: copy.body,
      link: '/b/subscription',
      dedupeKey: `billing:${administratorId}:${phase}`,
    });
  }

  /**
   * Llamado por `SubscriptionGraceCronService` cuando se agotan los 7 días
   * de gracia sin que Stripe haya cobrado — misma transición que un estado
   * terminal de Stripe (`restrictAdministrator`), para no duplicarla.
   */
  async restrictForExpiredGrace(administratorId: string): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.restrictAdministrator(tx, administratorId, '7 días de pago pendiente sin regularizar'),
    );
    await this.notifyBillingPhase(administratorId, 'restricted');
  }

  private async onSubscriptionDeleted(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const existing = await this.prisma.administratorSubscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    const phase = await this.prisma.$transaction(async (tx) => {
      await tx.administratorSubscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: 'canceled' },
      });
      if (!existing) return null;
      return this.applyAdminStatusFromStripe(
        tx,
        existing.administratorId,
        subscription.status,
        {},
      );
    });
    if (existing && phase) await this.notifyBillingPhase(existing.administratorId, phase);
  }

  /** `invoice.parent.subscription_details` en vez de un `invoice.subscription` plano — así lo modela esta versión de la API. */
  private async administratorIdFromInvoice(invoice: Stripe.Invoice): Promise<string | null> {
    const metaId = invoice.parent?.subscription_details?.metadata?.['administrator_id'];
    if (metaId) return metaId;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return null;
    const sub = await this.prisma.administratorSubscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    return sub?.administratorId ?? null;
  }

  /**
   * Resuelve el nombre del plan a partir del price de la PROPIA línea de
   * esta factura — nunca desde `Administrator.plan`. Stripe no garantiza
   * el orden de entrega entre `invoice.finalized` y
   * `customer.subscription.updated`: si un cambio de plan coincide con la
   * renovación, `admin.plan` podría no haberse actualizado todavía cuando
   * llega este evento, y el texto de una factura fiscal ya emitida es
   * inmutable — no se puede corregir después sin una rectificativa. El
   * importe (`invoice.subtotal`) siempre es correcto porque viene directo
   * de Stripe; aquí solo se resuelve el nombre descriptivo del plan con
   * esa misma fuente de verdad. "Genérico" como último recurso: no vale la
   * pena bloquear la generación de la factura (el importe SÍ es correcto)
   * solo porque el texto descriptivo no se pudo resolver.
   */
  private planLabelFromInvoice(invoice: Stripe.Invoice): string {
    const priceId = invoice.lines.data[0]?.pricing?.price_details?.price;
    const plan = priceId ? this.stripe.planForPriceId(priceId) : null;
    return plan ?? 'Domora';
  }

  /**
   * Genera la factura fiscal (numeración + Verifactu) para el ciclo que
   * Stripe acaba de finalizar. Idempotente por `stripeInvoiceId`: Stripe
   * entrega los eventos al menos una vez, así que un reenvío del mismo
   * evento no debe generar una segunda factura ni una segunda entrada en
   * la cadena Verifactu.
   */
  private async onInvoiceFinalized(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.id) {
      this.logger.warn('invoice.finalized sin id — evento descartado.');
      return;
    }
    const already = await this.prisma.adminInvoice.findUnique({
      where: { stripeInvoiceId: invoice.id },
    });
    if (already) return;

    const administratorId = await this.administratorIdFromInvoice(invoice);
    if (!administratorId) {
      this.logger.warn(`invoice.finalized sin gestora resoluble (invoice ${invoice.id}).`);
      return;
    }

    // Un invoice de Stripe con base <= 0 (cupón del 100%, crédito de
    // cuenta, proración a cero) no representa ninguna operación real que
    // declarar — generar igualmente una factura fiscal y su alta Verifactu
    // para un importe nulo sería un registro sin sustento económico. Se
    // omite en vez de generar una factura a 0€: no hay nada que
    // reintentar aquí, así que se confirma la recepción a Stripe (return
    // normal, no error) para que no siga reenviando el evento.
    if (invoice.subtotal <= 0) {
      this.logger.log(
        `invoice.finalized con subtotal <= 0 (${invoice.subtotal}) para la gestora ${administratorId} (invoice ${invoice.id}) — no se genera factura fiscal.`,
      );
      return;
    }

    const planLabel = this.planLabelFromInvoice(invoice);
    // `finalized_at` es el instante real en que Stripe fijó este invoice,
    // no cuándo este proceso llega a procesar el evento (que puede ser
    // horas después si el backend estuvo caído y Stripe reintentó) — solo
    // debería faltar si el evento no fuera realmente un `invoice.finalized`.
    const issuedAt = invoice.status_transitions.finalized_at
      ? new Date(invoice.status_transitions.finalized_at * 1000)
      : new Date();

    try {
      await this.prisma.$transaction((tx) =>
        this.admins.createFiscalInvoiceFromStripe(
          tx,
          administratorId,
          invoice.subtotal,
          invoice.id!,
          planLabel,
          issuedAt,
        ),
      );
    } catch (error) {
      // Carrera entre dos entregas del mismo evento: la comprobación de
      // arriba no es atómica con la inserción, así que un P2002 en
      // stripe_invoice_id significa que la otra entrega ganó — no es un
      // fallo real.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      // Cualquier otro error aquí significa que Stripe YA cobró este
      // ciclo pero Domora no pudo generar su contrapartida fiscal
      // (Verifactu) — el caso previsto es AdminBilling incompleto, ahora
      // bloqueado en origen por createCheckoutSession, pero si ocurre
      // igualmente (p.ej. se borraron los datos de facturación después de
      // dar de alta la suscripción) es un error real, no una carrera, y
      // debe quedar registrado como tal — no como el mismo warn informativo
      // que el resto de casos "sin metadata". Se relanza para que Stripe
      // siga reintentando (una respuesta 200 aquí equivaldría a darlo por
      // resuelto sin haberlo estado).
      this.logger.error(
        `No se pudo generar la factura fiscal para el invoice de Stripe ${invoice.id} (gestora ${administratorId}) — el cobro ya se realizó en Stripe: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /** Best-effort: si `invoice.finalized` todavía no se procesó, `updateMany` no encuentra fila y no falla — la reconciliación llega cuando ese evento aterrice. */
  private async onInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.id) return;
    await this.prisma.adminInvoice.updateMany({
      where: { stripeInvoiceId: invoice.id },
      data: { status: 'Pagada' },
    });
    // «Pago recibido» de Actividad reciente (rol A). Por el cliente de Stripe y
    // no por la factura fiscal: `invoice.finalized` puede no haber llegado aún.
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId || invoice.amount_paid == null) return;
    const sub = await this.prisma.administratorSubscription.findFirst({
      where: { stripeCustomerId: customerId },
      select: { administratorId: true },
    });
    if (!sub) return;
    await this.recordBusinessEvent(
      sub.administratorId,
      AdminActivityType.payment_received,
      `Pago recibido: ${formatEuros(invoice.amount_paid / 100)}`,
      `stripe-invoice-paid:${invoice.id}`,
    );
  }

  /**
   * True when role A detached this subscription with «Pasar a facturación
   * manual» (`AdminsService.switchToManualBilling`): its activity entry is the
   * tombstone. Events for it are then ignored, except the invoice ones, which
   * record money Stripe really charged and are resolved by customer.
   * `customer.subscription.deleted` and `invoice.payment_failed` need no
   * check: they only touch the row by `stripeSubscriptionId`, which no longer
   * matches.
   */
  private async wasDetached(subscriptionId: string): Promise<boolean> {
    const tombstone = await this.prisma.adminActivityItem.findUnique({
      where: { externalRef: detachedSubscriptionRef(subscriptionId) },
      select: { id: true },
    });
    if (tombstone) this.logger.log(`Evento de Stripe ignorado: la suscripción ${subscriptionId} se desvinculó al pasar a facturación manual.`);
    return !!tombstone;
  }

  /** Activity entry for a business event of a despacho; idempotent by `externalRef` because Stripe retries webhooks. */
  private async recordBusinessEvent(administratorId: string, type: AdminActivityType, title: string, externalRef: string): Promise<void> {
    await this.prisma.adminActivityItem.createMany({
      data: [{ administratorId, type, title, externalRef }],
      skipDuplicates: true,
    });
  }

  private async onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.id) return;
    await this.prisma.adminInvoice.updateMany({
      where: { stripeInvoiceId: invoice.id },
      data: { status: 'Vencida' },
    });
    // Escopado por stripeSubscriptionId de la PROPIA factura (igual que
    // onSubscriptionDeleted), no por administratorId: una gestora puede
    // cancelar una suscripción con impagos y dar de alta otra que sí cobra
    // bien — un evento tardío o reintentado del fallo de la primera no debe
    // marcar como past_due la suscripción nueva, que no tiene nada que ver.
    const subDetails = invoice.parent?.subscription_details;
    const subscriptionId =
      typeof subDetails?.subscription === 'string'
        ? subDetails.subscription
        : subDetails?.subscription?.id;
    if (subscriptionId) {
      await this.prisma.administratorSubscription.updateMany({
        where: { stripeSubscriptionId: subscriptionId },
        data: { status: 'past_due' },
      });
    }
  }
}

const EUROS = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «143,99 €» with a plain space, as the activity titles are read as text. */
function formatEuros(value: number): string {
  return `${EUROS.format(value)} €`;
}

/** dd/mm/aaaa of a Stripe timestamp, in UTC like Stripe's periods. */
function formatDate(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}
