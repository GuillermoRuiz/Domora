-- CreateEnum
CREATE TYPE "AdminSepaMandateStatus" AS ENUM ('active', 'revoked');

-- AlterEnum
ALTER TYPE "AdminActivityType" ADD VALUE 'billing_change';

-- CreateTable
CREATE TABLE "admin_sepa_mandates" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "reference" VARCHAR(35) NOT NULL,
    "creditor_id" VARCHAR(35) NOT NULL,
    "debtor_name" VARCHAR(200) NOT NULL,
    "debtor_iban" VARCHAR(255) NOT NULL,
    "debtor_iban_masked" VARCHAR(20) NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL,
    "accepted_by_user_id" UUID,
    "mandate_text" TEXT NOT NULL,
    "text_version" VARCHAR(20) NOT NULL,
    "signed_document_path" VARCHAR(500),
    "status" "AdminSepaMandateStatus" NOT NULL DEFAULT 'active',
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sepa_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sepa_mandates_reference_key" ON "admin_sepa_mandates"("reference");

-- CreateIndex
CREATE INDEX "admin_sepa_mandates_administrator_id_signed_at_idx" ON "admin_sepa_mandates"("administrator_id", "signed_at" DESC);

-- AddForeignKey
ALTER TABLE "admin_sepa_mandates" ADD CONSTRAINT "admin_sepa_mandates_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sepa_mandates" ADD CONSTRAINT "admin_sepa_mandates_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one active SEPA mandate per despacho (partial unique index, not expressible in the Prisma schema).
CREATE UNIQUE INDEX "admin_sepa_mandates_one_active_per_administrator" ON "admin_sepa_mandates"("administrator_id") WHERE "status" = 'active';
