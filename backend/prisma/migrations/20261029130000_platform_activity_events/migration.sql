-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminActivityType" ADD VALUE 'payment_received';
ALTER TYPE "AdminActivityType" ADD VALUE 'cancellation_requested';

-- AlterTable
ALTER TABLE "admin_activity_log" ADD COLUMN     "external_ref" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "admin_activity_log_external_ref_key" ON "admin_activity_log"("external_ref");

-- CreateIndex
CREATE INDEX "admin_activity_log_type_occurred_at_idx" ON "admin_activity_log"("type", "occurred_at" DESC);

