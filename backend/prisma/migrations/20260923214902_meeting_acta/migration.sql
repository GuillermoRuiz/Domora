-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "acta_distributed_at" TIMESTAMPTZ,
ADD COLUMN     "acta_s3_key" TEXT,
ADD COLUMN     "acta_signed_at" TIMESTAMPTZ,
ADD COLUMN     "acta_signed_by_presidente_user_id" UUID,
ADD COLUMN     "acta_signed_by_secretario_user_id" UUID,
ADD COLUMN     "celebrated_at" TIMESTAMPTZ;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_acta_signed_by_presidente_user_id_fkey" FOREIGN KEY ("acta_signed_by_presidente_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_acta_signed_by_secretario_user_id_fkey" FOREIGN KEY ("acta_signed_by_secretario_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
