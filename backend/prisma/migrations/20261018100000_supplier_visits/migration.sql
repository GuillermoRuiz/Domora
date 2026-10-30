-- CreateEnum
CREATE TYPE "SupplierVisitStatus" AS ENUM ('planificada', 'realizada', 'cancelada');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "contact_name" VARCHAR(200);

-- CreateTable
CREATE TABLE "supplier_visits" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "purpose" VARCHAR(200) NOT NULL,
    "status" "SupplierVisitStatus" NOT NULL DEFAULT 'planificada',
    "notes" TEXT,
    "asset_id" UUID,
    "issue_id" UUID,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "supplier_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_visits_supplier_id_scheduled_at_idx" ON "supplier_visits"("supplier_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "supplier_visits_estate_id_scheduled_at_idx" ON "supplier_visits"("estate_id", "scheduled_at");

-- AddForeignKey
ALTER TABLE "supplier_visits" ADD CONSTRAINT "supplier_visits_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_visits" ADD CONSTRAINT "supplier_visits_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_visits" ADD CONSTRAINT "supplier_visits_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
