-- Privacidad y notificaciones por membresía de propiedad.
--
-- Fila creada de forma perezosa (lazy) desde el servicio — sin backfill:
-- su ausencia equivale a los DEFAULT de cada columna.

-- CreateEnum
CREATE TYPE "DirectMessagePolicy" AS ENUM ('nobody', 'neighbors', 'anyone_linked');

-- CreateEnum
CREATE TYPE "NotificationSetting" AS ENUM ('none', 'push_only', 'email_only', 'email_push');

-- CreateTable
CREATE TABLE "property_membership_settings" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "visible_in_directory" BOOLEAN NOT NULL DEFAULT true,
    "show_phone_in_directory" BOOLEAN NOT NULL DEFAULT false,
    "show_email_in_directory" BOOLEAN NOT NULL DEFAULT false,
    "visible_in_bookings" BOOLEAN NOT NULL DEFAULT true,
    "allow_direct_messages" "DirectMessagePolicy" NOT NULL DEFAULT 'neighbors',
    "notify_issues" "NotificationSetting" NOT NULL DEFAULT 'email_push',
    "notify_receipts" "NotificationSetting" NOT NULL DEFAULT 'email_push',
    "notify_tickets" "NotificationSetting" NOT NULL DEFAULT 'email_push',
    "notify_communications" "NotificationSetting" NOT NULL DEFAULT 'email_push',
    "notify_bookings" "NotificationSetting" NOT NULL DEFAULT 'push_only',
    "notify_direct_messages" "NotificationSetting" NOT NULL DEFAULT 'email_push',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "property_membership_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_membership_settings_membership_id_key" ON "property_membership_settings"("membership_id");

-- AddForeignKey
ALTER TABLE "property_membership_settings" ADD CONSTRAINT "property_membership_settings_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "property_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
