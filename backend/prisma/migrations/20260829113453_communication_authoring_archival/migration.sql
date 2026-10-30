-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityVerb" ADD VALUE 'deleted';
ALTER TYPE "ActivityVerb" ADD VALUE 'archived';

-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "active_until" TIMESTAMPTZ,
ADD COLUMN     "archived_by_admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "author_user_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "last_edited_at" TIMESTAMPTZ,
ADD COLUMN     "last_edited_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_last_edited_by_user_id_fkey" FOREIGN KEY ("last_edited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
