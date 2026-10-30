-- CreateEnum
CREATE TYPE "SupplierContractRenewalType" AS ENUM ('manual', 'tacita');

-- CreateEnum
CREATE TYPE "SupplierDocumentType" AS ENUM ('Contrato', 'Seguro', 'Certificado', 'Presupuesto', 'Otro');

-- AlterEnum
ALTER TYPE "AlertSourceType" ADD VALUE 'supplier_contract';

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'Activo';

-- CreateTable
CREATE TABLE "supplier_contracts" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "service_type" VARCHAR(100) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "renewal_type" "SupplierContractRenewalType" NOT NULL,
    "review_frequency" VARCHAR(50),
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "supplier_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_documents" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "contract_id" UUID,
    "document_type" "SupplierDocumentType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "expires_at" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_contracts_supplier_id_idx" ON "supplier_contracts"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_contracts_estate_id_idx" ON "supplier_contracts"("estate_id");

-- CreateIndex
CREATE INDEX "supplier_documents_supplier_id_idx" ON "supplier_documents"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_documents_contract_id_idx" ON "supplier_documents"("contract_id");

-- AddForeignKey
ALTER TABLE "supplier_contracts" ADD CONSTRAINT "supplier_contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supplier_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
