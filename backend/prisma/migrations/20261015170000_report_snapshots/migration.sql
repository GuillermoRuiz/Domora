-- Canonical, private, expiring composite report snapshots. Not an audit table.
CREATE TABLE "report_snapshots" (
  "id" UUID NOT NULL,
  "administrator_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "report_key" VARCHAR(100) NOT NULL,
  "estate_ids" UUID[] NOT NULL,
  "input_hash" VARCHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "generated_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_snapshots_expiry" CHECK ("expires_at" > "generated_at"),
  CONSTRAINT "report_snapshots_composites" CHECK ("report_key" IN ('meeting-finance', 'monthly-executive')),
  CONSTRAINT "report_snapshots_scope" CHECK (cardinality("estate_ids") > 0),
  CONSTRAINT "report_snapshots_hash" CHECK ("input_hash" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "report_snapshots_administrator_id_expires_at_idx" ON "report_snapshots" ("administrator_id", "expires_at");
