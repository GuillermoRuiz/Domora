# Verificación manual contra el sandbox real de Stripe

> Runbook operativo. Hasta ahora toda la verificación de `BillingService`
> era con eventos de Stripe simulados en los tests (`billing.service.spec.ts`)
> — nunca se había ejercitado el flujo real: checkout de verdad, `stripe
> listen` reenviando webhooks de verdad, tarjetas de prueba de verdad. Esto
> no sustituye a los tests (que siguen siendo la verificación rápida y
> repetible), pero es el único sitio donde se comprueban cosas que un evento
> fabricado a mano no puede: que la firma HMAC de un webhook real pasa
> `constructWebhookEvent`, que los campos que Stripe manda de verdad tienen
> la forma que el código espera, y que el ciclo completo (alta → impago →
> recuperación → cancelación) se comporta como se diseñó.

## Requisitos

- Una cuenta de Stripe en **modo test** (gratuita, sin datos reales) —
  https://dashboard.stripe.com/register
- [Stripe CLI](https://stripe.com/docs/stripe-cli) instalada (`stripe login`
  una vez, autentica contra tu cuenta).
- Backend corriendo localmente: `docker compose up --build` desde
  `backend/` (ver `docker-compose.yml`), con el seed aplicado (usuario rol B
  `admin@domora.app` / `admin123`, mismo que usa `scripts/smoke-e2e.sh`).
- Tres Prices de prueba creados en el dashboard de Stripe (modo test),
  recurrentes mensuales: Product catalog → Add product, uno por plan
  (BASE/STANDARD/PREMIUM). Copia los tres `price_...`.

## 1. Configurar el backend con las claves de test

En `backend/.env` (no se commitea — ver `.env.example`):

```
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_PRICE_BASE="price_..."
STRIPE_PRICE_STANDARD="price_..."
STRIPE_PRICE_PREMIUM="price_..."
# STRIPE_WEBHOOK_SECRET se rellena en el paso 2, con el que imprime `stripe listen`
```

Reinicia el contenedor de la API tras editar `.env`
(`docker compose up --build` de nuevo, o `docker compose restart api`).

## 2. Reenviar webhooks a local

```bash
stripe listen --forward-to localhost:3000/api/v1/billing/webhook
```

Imprime un `whsec_...` — pégalo en `STRIPE_WEBHOOK_SECRET` en `.env` y
reinicia el contenedor otra vez. Deja esta terminal abierta durante todo
el runbook: cada evento que dispares en el dashboard o con `stripe
trigger` pasa por aquí y por los logs del contenedor
(`docker compose logs -f api`), donde deberías ver cada `[BillingService]`
procesando el evento.

## 3. Alta y primer cobro (tarjeta que funciona)

1. Login como `admin@domora.app` / `admin123`, ir a **Suscripción** (rol B).
2. **Configurar pago** → `POST /billing/checkout` → completa el Checkout de
   Stripe con la tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha
   futura y CVC.
3. Verifica en la terminal de `stripe listen`: `checkout.session.completed`,
   luego `customer.subscription.updated` (`status: active`) y
   `invoice.finalized`.
4. En BD: `AdministratorSubscription.status = 'active'`,
   `Administrator.plan`/`usersMax`/`mrr` reflejan el plan elegido, y se creó
   un `AdminInvoice` con `stripeInvoiceId` — con Verifactu activo, revisa
   también que se generó su registro en la cadena.

## 4. Primer impago — arranca el período de gracia (ya NO restringe de inmediato)

Con la suscripción activa, cambia el método de pago por defecto en el
[Customer del dashboard de Stripe](https://dashboard.stripe.com/test/customers)
a la tarjeta `4000 0000 0000 0341` (se adjunta sin problema, pero **todo
cargo posterior es rechazado** — pensada justo para esto).

1. Fuerza el siguiente ciclo de facturación: en el dashboard, sobre la
   suscripción → **Actions** → **Update subscription** → adelanta
   `current_period_end`, o usa `stripe trigger invoice.payment_failed`
   (dispara un evento sintético pero con la firma real de tu cuenta —
   sigue siendo más real que los fixtures de los tests, aunque no ejercita
   Checkout).
2. Verifica en `stripe listen`: `invoice.payment_failed` y
   `customer.subscription.updated` con `status: past_due`.
3. Comprueba en BD (ID 17 — período de gracia, ya NO restringe en el
   primer fallo: es apenas el primer intento de hasta 8 reintentos que
   Stripe corre en 2 semanas por defecto):
   - `AdminInvoice.status = 'Vencida'`.
   - `AdministratorSubscription.pastDueSince` queda seteado a "ahora".
   - `Administrator.status` **sigue en `'Activa'`** — no cambia todavía.
   - Le llega a TODO el equipo de rol B de esa gestora (bandeja + email,
     si SMTP está configurado) el aviso "Tu pago falló — regularizalo
     antes de 7 días" (categoría `billing`).
4. Con el usuario rol B de esa gestora, confirma que el acceso sigue
   intacto: cualquier `POST`/`PATCH`/`DELETE` (p. ej. crear una finca)
   responde 2xx normal, NO `403 SUBSCRIPTION_EXPIRED` — la gracia todavía
   no se agotó.

## 4bis. Se agota la gracia sin pagar — ahí sí restringe

`SubscriptionGraceCronService` corre una vez al día
(`CronExpression.EVERY_DAY_AT_8AM`) y no hay endpoint para forzarlo — para
probar el vencimiento de los 7 días sin esperar una semana real:

1. Con el `pastDueSince` del paso anterior ya en BD, adelantalo a mano 7
   días hacia atrás (`UPDATE administrator_subscriptions SET
   past_due_since = now() - interval '8 days' WHERE administrator_id =
   '<id>';`) — simula que la gracia ya venció.
2. Invocá el cron una vez a mano (no hay ruta HTTP a propósito, es un job
   interno): un script puntual que resuelva `SubscriptionGraceCronService`
   del `AppModule` y llame a `.run()`, o cambiá momentáneamente el
   `@Cron` a `CronExpression.EVERY_MINUTE` en local y esperá al minuto.
3. Comprueba en BD:
   - `Administrator.status = 'Vencida'`.
   - `AdministratorSubscription.pastDueSince` vuelve a `null`.
   - Nueva fila en `AdminActivityItem` (`type: 'block'`, título "Cuenta
     pasada a Vencida automáticamente (7 días de pago pendiente sin
     regularizar)") — visible en el panel de rol A, ficha de la gestora.
   - Le llega al equipo de rol B el aviso "Tu cuenta pasó a modo solo
     lectura" (misma categoría `billing`, dedupeKey distinto — no colapsa
     con el aviso del paso 3).
4. Con el usuario rol B, confirma el efecto real: `GET /estates` (u otra
   lectura) sigue funcionando; cualquier `POST`/`PATCH`/`DELETE` responde
   `403 SUBSCRIPTION_EXPIRED`.

## 5. Recuperación

Vuelve a poner la tarjeta `4242 4242 4242 4242` como método de pago por
defecto del Customer y reintenta el cobro fallido (dashboard → invoice
pendiente → **Retry payment**, o espera al reintento automático de Stripe).

- `stripe listen` debe mostrar `invoice.payment_succeeded` y
  `customer.subscription.updated` (`status: active`).
- En BD: `Administrator.status` vuelve a `'Activa'` sola,
  `AdministratorSubscription.pastDueSince` queda en `null`, con otra fila
  en `AdminActivityItem` ("Cuenta reactivada automáticamente…"). Si la
  recuperación llega DURANTE la gracia (antes de llegar a §4bis), nunca
  llegó a restringirse — solo se limpia el reloj.
- Le llega al equipo de rol B el aviso "Pago confirmado — tu cuenta volvió
  a la normalidad" (categoría `billing`).
- El rol B recupera acceso de escritura sin que nadie de Domora haya
  tocado nada a mano.

## 6. Cancelación definitiva

Cancela la suscripción desde el dashboard (o `stripe trigger
customer.subscription.deleted`, o `POST /billing/cancel` + esperar a
`current_period_end`, o cancelarla inmediatamente desde el propio
dashboard para no esperar).

- `AdministratorSubscription.status = 'canceled'`.
- Si la gestora seguía `'Activa'` en ese momento, pasa a `'Vencida'` (mismo
  lazo que el impago — ver §4). Si ya estaba `'Vencida'` o en un estado
  manual (`Periodo_de_gracia`/`Bloqueada`), no cambia nada más.

## 7. Qué NO cubre este runbook

- **`Bloqueada`**: es y debe seguir siendo un estado manual (panel de rol
  A) — ningún evento de Stripe lo activa ni lo desactiva, así que no hay
  nada de Stripe que probar aquí. Verificar aparte, sin Stripe de por
  medio.
- **Idempotencia real de Stripe** (el mismo evento entregado dos veces):
  `stripe trigger` no lo reproduce por sí solo. Para forzarlo, reenvía el
  mismo evento desde el dashboard (Developers → Events → el evento en
  cuestión → **Resend**) y confirma que no se duplica ni el `AdminInvoice`
  ni la fila de `AdminActivityItem`.
- **Producción real**: este runbook es contra Stripe en modo test. El
  primer cobro real en producción (`STRIPE_SECRET_KEY=sk_live_...`,
  aprovisionado como describe `doc/deploy-azure.md`) debería repetirse una
  vez, con una tarjeta real propia, antes de anunciar el cobro a clientes.
