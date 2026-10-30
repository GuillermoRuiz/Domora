/*
  Warnings:

  - Added the required column `invitee_email` to the `property_membership_invites` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- invitee_email se agrega nullable primero porque las invitaciones creadas
-- antes de esta migración no capturaban ningún email (el enlace se
-- compartía a mano) — se backfillea con un valor evidentemente placeholder
-- y recién entonces se vuelve NOT NULL.
ALTER TABLE "property_membership_invites" ADD COLUMN     "invitee_email" VARCHAR(255),
ADD COLUMN     "last_sent_at" TIMESTAMPTZ,
ADD COLUMN     "reminder_sent_at" TIMESTAMPTZ,
ADD COLUMN     "revoked_at" TIMESTAMPTZ,
ADD COLUMN     "revoked_by_user_id" UUID;

UPDATE "property_membership_invites" SET "invitee_email" = 'desconocido@invitacion-anterior.local' WHERE "invitee_email" IS NULL;

ALTER TABLE "property_membership_invites" ALTER COLUMN "invitee_email" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "property_membership_invites" ADD CONSTRAINT "property_membership_invites_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
