-- CreateEnum
CREATE TYPE "LeadOrigin" AS ENUM ('web', 'referido', 'comercial', 'solicitud_alta');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('nuevo', 'contactado', 'en_prueba', 'convertido', 'descartado');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_name" VARCHAR(150),
    "contact_email" VARCHAR(200),
    "contact_phone" VARCHAR(30),
    "city" VARCHAR(120),
    "origin" "LeadOrigin" NOT NULL,
    "plan_of_interest" "PlanTier",
    "status" "LeadStatus" NOT NULL DEFAULT 'nuevo',
    "next_action" VARCHAR(300),
    "next_action_at" DATE,
    "notes" TEXT,
    "onboarding_request_id" UUID,
    "converted_administrator_id" UUID,
    "converted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_follow_ups" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "administrator_id" UUID,
    "author_user_id" UUID,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_next_actions" (
    "administrator_id" UUID NOT NULL,
    "next_action" VARCHAR(300),
    "next_action_at" DATE,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_next_actions_pkey" PRIMARY KEY ("administrator_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_onboarding_request_id_key" ON "leads"("onboarding_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_converted_administrator_id_key" ON "leads"("converted_administrator_id");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "commercial_follow_ups_lead_id_occurred_at_idx" ON "commercial_follow_ups"("lead_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "commercial_follow_ups_administrator_id_occurred_at_idx" ON "commercial_follow_ups"("administrator_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_onboarding_request_id_fkey" FOREIGN KEY ("onboarding_request_id") REFERENCES "estate_onboarding_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_administrator_id_fkey" FOREIGN KEY ("converted_administrator_id") REFERENCES "administrators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_follow_ups" ADD CONSTRAINT "commercial_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_follow_ups" ADD CONSTRAINT "commercial_follow_ups_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_follow_ups" ADD CONSTRAINT "commercial_follow_ups_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_next_actions" ADD CONSTRAINT "client_next_actions_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A follow-up belongs to exactly one lead or one despacho client (Prisma cannot express it).
ALTER TABLE "commercial_follow_ups" ADD CONSTRAINT "commercial_follow_ups_one_subject_check" CHECK (num_nonnulls("lead_id", "administrator_id") = 1);

-- Existing «Solicitudes de alta de comunidad» become leads with that origin (S13).
-- Only inserts into the new table: the requests themselves are not modified.
INSERT INTO "leads" ("id", "name", "contact_email", "origin", "status", "onboarding_request_id", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    LEFT(COALESCE(NULLIF(BTRIM(r."admin_name"), ''), 'Administración de ' || r."community_name"), 200),
    LEFT(NULLIF(BTRIM(r."admin_email"), ''), 200),
    'solicitud_alta',
    CASE r."status"
        WHEN 'contacted' THEN 'contactado'::"LeadStatus"
        WHEN 'dismissed' THEN 'descartado'::"LeadStatus"
        ELSE 'nuevo'::"LeadStatus"
    END,
    r."id",
    r."created_at",
    CURRENT_TIMESTAMP
FROM "estate_onboarding_requests" r;
