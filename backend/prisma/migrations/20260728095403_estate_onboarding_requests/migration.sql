-- CreateEnum
CREATE TYPE "EstateOnboardingStatus" AS ENUM ('pending', 'contacted', 'dismissed');

-- AlterTable
ALTER TABLE "data_access_log" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "estate_onboarding_requests" (
    "id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "property_id" UUID,
    "community_name" VARCHAR(200) NOT NULL,
    "community_address" VARCHAR(255),
    "admin_name" VARCHAR(200),
    "admin_email" VARCHAR(255),
    "status" "EstateOnboardingStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_user_id" UUID,

    CONSTRAINT "estate_onboarding_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estate_onboarding_requests_status_idx" ON "estate_onboarding_requests"("status");

-- AddForeignKey
ALTER TABLE "estate_onboarding_requests" ADD CONSTRAINT "estate_onboarding_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estate_onboarding_requests" ADD CONSTRAINT "estate_onboarding_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estate_onboarding_requests" ADD CONSTRAINT "estate_onboarding_requests_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
