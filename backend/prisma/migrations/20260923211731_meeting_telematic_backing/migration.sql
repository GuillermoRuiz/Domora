-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "telematic_backing_confirmed_at" TIMESTAMPTZ,
ADD COLUMN     "telematic_backing_confirmed_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_telematic_backing_confirmed_by_user_id_fkey" FOREIGN KEY ("telematic_backing_confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
