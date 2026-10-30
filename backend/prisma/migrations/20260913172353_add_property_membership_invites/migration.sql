-- CreateTable
CREATE TABLE "property_membership_invites" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "role_type" "MembershipRoleType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "used_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_membership_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_membership_invites_token_hash_key" ON "property_membership_invites"("token_hash");

-- CreateIndex
CREATE INDEX "property_membership_invites_property_id_idx" ON "property_membership_invites"("property_id");

-- AddForeignKey
ALTER TABLE "property_membership_invites" ADD CONSTRAINT "property_membership_invites_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_membership_invites" ADD CONSTRAINT "property_membership_invites_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_membership_invites" ADD CONSTRAINT "property_membership_invites_used_by_user_id_fkey" FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
