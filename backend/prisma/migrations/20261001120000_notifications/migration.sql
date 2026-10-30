-- PR #7 (fix/stripe-billing-produccion), renombrada al completar la PR contra
-- main el 2026-10-01 — originalmente fechada 20260921100000. Puramente
-- aditiva (2 tablas nuevas, 2 enums nuevos, FKs a users), sin dependencia de
-- nada tocado por las migraciones del diario de partida doble ni por la del
-- Catastro (PR #6) que quedaron en medio.
-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('adhesion', 'onboarding', 'issue', 'direct_message', 'inspection', 'meeting', 'communication');

-- CreateEnum
CREATE TYPE "NotificationEmailStatus" AS ENUM ('skipped', 'sent', 'failed');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "link" VARCHAR(300) NOT NULL,
    "estate_id" UUID,
    "property_id" UUID,
    "dedupe_key" VARCHAR(120),
    "read_at" TIMESTAMPTZ,
    "email_status" "NotificationEmailStatus" NOT NULL DEFAULT 'skipped',
    "email_error" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("user_id","category")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
-- Colapso de avisos: como mucho UN aviso no leído por (usuario, clave). Índice
-- parcial escrito a mano (Prisma no modela `WHERE`); mismo precedente que
-- `inspection_types_code_global_key`.
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_unread_key" ON "notifications"("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL AND "read_at" IS NULL;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
