-- AlterTable
ALTER TABLE "property_membership_invites" ADD COLUMN     "external_owner_id" UUID;

-- CreateIndex
CREATE INDEX "property_membership_invites_external_owner_id_idx" ON "property_membership_invites"("external_owner_id");

-- AddForeignKey
ALTER TABLE "property_membership_invites" ADD CONSTRAINT "property_membership_invites_external_owner_id_fkey" FOREIGN KEY ("external_owner_id") REFERENCES "external_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una invitación de Propietario siempre va ligada a un titular importado, y
-- solo esas lo están. Prisma no expresa CHECKs: se mantiene aquí a mano.
ALTER TABLE "property_membership_invites" ADD CONSTRAINT "property_membership_invites_owner_requires_external_owner"
  CHECK (("role_type" = 'Propietario') = ("external_owner_id" IS NOT NULL));
