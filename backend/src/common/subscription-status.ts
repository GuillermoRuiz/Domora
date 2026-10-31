/**
 * Lista blanca, no negra: de los 8 valores de `SubscriptionStatus`
 * (`active|trialing|past_due|canceled|incomplete|incomplete_expired|
 * unpaid|paused`), solo estos cuatro representan una suscripción que
 * realmente cobra o puede volver a cobrar sin que el cliente tenga que
 * empezar de cero. `incomplete_expired` es terminal por definición de
 * Stripe (la ventana de 23h para el primer pago venció, no se puede
 * reanudar) y `unpaid`/`incomplete` tampoco están cobrando — tratarlos como
 * "activa" bloquearía sin salida un nuevo intento de checkout o una
 * corrección manual desde soporte. `canceled` se excluye aparte porque
 * `customer.subscription.deleted` (BillingService.onSubscriptionDeleted) lo
 * marca así pero NUNCA borra `stripeSubscriptionId` — comprobar solo su
 * presencia consideraría activa una suscripción que Stripe ya dio por
 * terminada.
 *
 * Única definición: la comparten BillingService (requireSubscription,
 * createCheckoutSession) y AdminsService (assertNoActiveStripeSubscription),
 * que no pueden importarse entre sí sin crear una dependencia circular de
 * módulos — por eso vive aquí como función suelta, no como método de
 * ningún servicio.
 */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused']);

export function isActiveStripeSubscription<
  T extends { stripeSubscriptionId: string | null; status: string | null },
>(sub: T | null | undefined): sub is T & { stripeSubscriptionId: string } {
  return (
    !!sub?.stripeSubscriptionId &&
    !!sub.status &&
    ACTIVE_STATUSES.has(sub.status)
  );
}

/**
 * Deriva el `Administrator.status` (AdminStatus: el que de verdad lee
 * `SubscriptionStatusGuard`) a partir del `SubscriptionStatus` que manda
 * Stripe en `customer.subscription.updated`/`.deleted`. Antes de esto,
 * ningún webhook tocaba `Administrator.status`: un impago dejaba
 * `AdministratorSubscription.status = 'past_due'` y la factura en
 * `Vencida`, pero la gestora conservaba acceso de escritura completo hasta
 * que alguien de Domora la bloqueaba a mano — el lazo de morosidad estaba
 * abierto.
 *
 * Deliberadamente conservador: solo se mueve automáticamente ENTRE 'Activa'
 * y 'Vencida' (el ida-y-vuelta que Stripe puede confirmar por sí solo). Si
 * la gestora está en 'Periodo_de_gracia' (cortesía manual de Domora) o
 * 'Bloqueada' (bloqueo manual), esta función no toca nada — igual que
 * `AdminsService.update()` ya trata el bloqueo/desbloqueo como una decisión
 * humana explícita, con su propia entrada de actividad. Sin esto, un evento
 * de Stripe podría deshacer en silencio una decisión de negocio que tomó
 * una persona.
 *
 * `'past_due'` NO está en esta lista a propósito (ver ID 17, cierre del
 * período de gracia): es apenas el PRIMER intento fallido de hasta 8
 * reintentos que Stripe corre en 2 semanas por defecto (Smart Retries) —
 * restringir de inmediato en el primer fallo es más agresivo que cualquier
 * comparable de SaaS (8-30 días de gracia típicos). `BillingService` lo
 * trata aparte: arranca un período de gracia de 7 días
 * (`AdministratorSubscription.pastDueSince`,
 * `SubscriptionGraceCronService`) en vez de restringir aquí mismo. Los 3
 * estados que SÍ quedan abajo son los que Stripe solo reporta DESPUÉS de
 * agotar su propia cascada de reintentos — no se les da gracia encima de
 * la que ya dio Stripe.
 *
 * Devuelve `null` cuando no hace falta ningún cambio (para que el llamador
 * no dispare una escritura de más).
 */
const RESTRICT_STRIPE_STATUSES = new Set([
  'unpaid',
  'canceled',
  'incomplete_expired',
]);
const RECOVER_STRIPE_STATUSES = new Set(['active', 'trialing']);

export function deriveAdminStatusFromStripe(
  currentStatus: string,
  stripeStatus: string,
): 'Activa' | 'Vencida' | null {
  if (currentStatus !== 'Activa' && currentStatus !== 'Vencida') return null;
  if (RESTRICT_STRIPE_STATUSES.has(stripeStatus)) {
    return currentStatus === 'Vencida' ? null : 'Vencida';
  }
  if (RECOVER_STRIPE_STATUSES.has(stripeStatus)) {
    return currentStatus === 'Activa' ? null : 'Activa';
  }
  // 'incomplete'/'paused': transitorios, no se actúa automáticamente.
  return null;
}

/**
 * true si `stripeStatus` es uno de los que SÍ pueden derivar un cambio de
 * `Administrator.status` (recuperación o restricción terminal) — a
 * diferencia de `deriveAdminStatusFromStripe`, que devuelve `null` tanto
 * cuando el estado no se reconoce (`'incomplete'`/`'paused'`/un `'past_due'`
 * repetido) como cuando SÍ se reconoce pero no cambia nada (p. ej. ya
 * estaba `'Vencida'` y llega otro `'canceled'`). `BillingService` lo usa
 * para saber cuándo soltar `AdministratorSubscription.pastDueSince` — en el
 * primer caso no hay que tocarlo, en el segundo sí, aunque
 * `Administrator.status` no haya cambiado.
 */
export function resolvesPastDueGrace(stripeStatus: string): boolean {
  return (
    RESTRICT_STRIPE_STATUSES.has(stripeStatus) ||
    RECOVER_STRIPE_STATUSES.has(stripeStatus)
  );
}

/**
 * Stripe states in which a subscription is dead for good and role A may
 * detach it with «Pasar a facturación manual» (odd/tasks/role-a-panel.md
 * T14): every other state (active, trialing, past_due, unpaid, incomplete,
 * paused) can still charge or be resumed, so detaching it would leave Stripe
 * billing a despacho that Domora reads as manually billed.
 */
const DETACHABLE_STATUSES = new Set(['canceled', 'incomplete_expired']);

export function isDetachableStripeSubscription<
  T extends { stripeSubscriptionId: string | null; status: string | null },
>(
  sub: T | null | undefined,
): sub is T & { stripeSubscriptionId: string; status: string } {
  return (
    !!sub?.stripeSubscriptionId &&
    !!sub.status &&
    DETACHABLE_STATUSES.has(sub.status)
  );
}

/**
 * `AdminActivityItem.externalRef` of the activity entry written when role A
 * detaches a subscription. It doubles as a tombstone: `stripeSubscriptionId`
 * is cleared on detach, so a late or retried Stripe event for that
 * subscription would otherwise be taken for a new one (`BillingService`
 * resolves it by `metadata.administrator_id`) and link it again. The column
 * is unique, so the lookup is one index read.
 */
export function detachedSubscriptionRef(subscriptionId: string): string {
  return `stripe-detached:${subscriptionId}`;
}
