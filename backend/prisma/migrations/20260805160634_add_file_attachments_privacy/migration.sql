-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "target_property_id" UUID;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "proof_file_name" VARCHAR(255),
ADD COLUMN     "proof_mime_type" VARCHAR(100),
ADD COLUMN     "proof_s3_key" VARCHAR(500);

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "file_name" VARCHAR(255),
ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "s3_key" VARCHAR(500);

-- CreateIndex
CREATE INDEX "documents_target_property_id_idx" ON "documents"("target_property_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_target_property_id_fkey" FOREIGN KEY ("target_property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
