-- Additive only. Legacy dates and costs remain unknown (NULL), without backfill.
CREATE TYPE "EstateOfficeRole" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY');
CREATE TYPE "ContractCostFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'ONE_OFF', 'OTHER');

ALTER TABLE "issues" ADD COLUMN "resolved_at" TIMESTAMPTZ,
  ADD COLUMN "closed_at" TIMESTAMPTZ;
ALTER TABLE "issue_timeline_entries" ADD COLUMN "from_status" "IssueStatus",
  ADD COLUMN "to_status" "IssueStatus",
  ADD CONSTRAINT "issue_transition_pair" CHECK (
    (from_status IS NULL AND to_status IS NULL) OR
    (from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status)
  );
ALTER TABLE "supplier_contracts" ADD COLUMN "cost_amount" DECIMAL(12,2),
  ADD COLUMN "cost_frequency" "ContractCostFrequency",
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  ADD CONSTRAINT "supplier_contract_cost_nonnegative" CHECK (cost_amount IS NULL OR cost_amount >= 0),
  ADD CONSTRAINT "supplier_contract_currency_iso_shape" CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE "receipts" ADD COLUMN "issued_at" TIMESTAMPTZ;
ALTER TABLE "data_access_log" ADD COLUMN "metadata" JSONB;

CREATE TABLE "estate_office_terms" (
  "id" UUID NOT NULL,
  "estate_id" UUID NOT NULL,
  "role" "EstateOfficeRole" NOT NULL DEFAULT 'PRESIDENT',
  "property_id" UUID,
  "user_id" UUID,
  "external_owner_id" UUID,
  "holder_name_snapshot" VARCHAR(200) NOT NULL,
  "starts_at" DATE NOT NULL,
  "ends_at" DATE,
  "appointed_by_meeting_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "estate_office_terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "estate_office_terms_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "estate_office_terms_valid_dates" CHECK (ends_at IS NULL OR starts_at < ends_at),
  CONSTRAINT "estate_office_terms_holder_exclusive" CHECK (user_id IS NULL OR external_owner_id IS NULL),
  CONSTRAINT "estate_office_terms_holder_name" CHECK (length(trim(holder_name_snapshot)) > 0)
);
CREATE INDEX "estate_office_terms_estate_id_role_starts_at_idx" ON "estate_office_terms" ("estate_id", "role", "starts_at");

-- Already required by bookings and interest-policy migrations. Exclusion also
-- protects finite/future mandates and concurrent writers, unlike a partial
-- unique index on ends_at IS NULL. Half-open dates permit same-day succession.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "estate_office_terms" ADD CONSTRAINT "estate_president_no_overlap"
  EXCLUDE USING gist (
    estate_id WITH =,
    daterange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (role = 'PRESIDENT');

-- No holder/actor FKs: historical references and snapshots survive user,
-- external-owner, property and meeting removal. Service validates integrity
-- and estate scope before writing, without cascading deletion of history.
