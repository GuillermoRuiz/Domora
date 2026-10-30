-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');

-- CreateTable
CREATE TABLE "administrator_subscriptions" (
    "administrator_id" UUID NOT NULL,
    "stripe_customer_id" VARCHAR(255) NOT NULL,
    "stripe_subscription_id" VARCHAR(255),
    "stripe_price_id" VARCHAR(255),
    "status" "SubscriptionStatus",
    "current_period_end" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "administrator_subscriptions_pkey" PRIMARY KEY ("administrator_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "administrator_subscriptions_stripe_subscription_id_key" ON "administrator_subscriptions"("stripe_subscription_id");

-- AddForeignKey
ALTER TABLE "administrator_subscriptions" ADD CONSTRAINT "administrator_subscriptions_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: reconciliación de facturas generadas automáticamente por el
-- webhook de Stripe (invoice.finalized/payment_succeeded/payment_failed)
-- contra la fila fiscal ya creada por AdminsService.createFiscalInvoice —
-- null en las facturas emitidas manualmente (issueInvoice, sin cambios).
ALTER TABLE "admin_invoices"
    ADD COLUMN "stripe_invoice_id" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "admin_invoices_stripe_invoice_id_key" ON "admin_invoices"("stripe_invoice_id");
