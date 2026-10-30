-- AlterTable
ALTER TABLE "admin_invoices" ALTER COLUMN "tax_rate" DROP DEFAULT;

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "attachment_file_name" VARCHAR(255),
ADD COLUMN     "attachment_mime_type" VARCHAR(100),
ADD COLUMN     "attachment_s3_key" VARCHAR(500);
