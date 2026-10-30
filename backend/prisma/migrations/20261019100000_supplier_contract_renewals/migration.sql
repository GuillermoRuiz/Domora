-- CreateTable
CREATE TABLE "supplier_contract_renewals" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "renewed_at" DATE NOT NULL,
    "previous_end_date" DATE,
    "new_end_date" DATE NOT NULL,
    "cost_amount" DECIMAL(12,2),
    "cost_frequency" "ContractCostFrequency",
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "kind" "SupplierContractRenewalType" NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "renewed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_contract_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_contract_renewals_contract_id_idx" ON "supplier_contract_renewals"("contract_id");

-- CreateIndex
CREATE INDEX "supplier_contract_renewals_estate_id_renewed_at_idx" ON "supplier_contract_renewals"("estate_id", "renewed_at" DESC);

-- AddForeignKey
ALTER TABLE "supplier_contract_renewals" ADD CONSTRAINT "supplier_contract_renewals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supplier_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
