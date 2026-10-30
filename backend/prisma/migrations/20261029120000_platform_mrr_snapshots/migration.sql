-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('month', 'year');

-- AlterTable
ALTER TABLE "administrators" ADD COLUMN     "billing_interval" "BillingInterval" NOT NULL DEFAULT 'month';

-- CreateTable
CREATE TABLE "client_mrr_snapshots" (
    "month" DATE NOT NULL,
    "administrator_id" UUID NOT NULL,
    "mrr" DECIMAL(10,2) NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_mrr_snapshots_pkey" PRIMARY KEY ("month","administrator_id")
);

-- CreateIndex
CREATE INDEX "client_mrr_snapshots_administrator_id_idx" ON "client_mrr_snapshots"("administrator_id");

-- AddForeignKey
ALTER TABLE "client_mrr_snapshots" ADD CONSTRAINT "client_mrr_snapshots_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

