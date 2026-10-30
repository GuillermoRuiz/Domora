-- Reconcile the published legacy AI schema with the canonical migration chain.
-- The legacy files were recovered from Git and their hashes matched the local
-- _prisma_migrations records. No historical migration is edited or renamed.
-- No rows, tables or columns are deleted and no unknown data is backfilled.
-- This file is also safe after a fresh replay of the canonical chain.
BEGIN;

-- Prisma already supplies these UUIDs and updatedAt values. Remove only the
-- extra legacy database defaults, matching 20261010140000_ai_workflows.
ALTER TABLE "ai_audit" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_batches" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ai_incidents" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ai_invoice_documents" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_jobs" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_messages" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_policies" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ai_reconciliation_suggestions" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_requests" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_weekly_snapshots" ALTER COLUMN "id" DROP DEFAULT;

-- Keep the legacy required-array invariant in fresh databases too. If an
-- existing database contains NULL arrays this transaction fails without
-- replacing them with invented values.
ALTER TABLE "ai_reconciliation_suggestions"
  ALTER COLUMN "entry_ids" SET NOT NULL,
  ALTER COLUMN "line_ids" SET NOT NULL,
  ALTER COLUMN "invoice_ids" SET NOT NULL;

-- Adopt existing unique indexes as constraints on fresh databases. Legacy
-- databases already have these constraints; uniqueness is never weakened.
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('ai_batches', 'ai_batches_remote_id_key'),
    ('ai_incidents', 'ai_incidents_conversation_token_hash_key'),
    ('ai_jobs', 'ai_jobs_dedupe_key_key'),
    ('ai_messages', 'ai_messages_dedupe_key_key'),
    ('ai_reconciliation_suggestions', 'ai_reconciliation_suggestions_candidate_key_key'),
    ('ai_requests', 'ai_requests_dedupe_key_key')
  ) AS existing_unique(table_name, constraint_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = item.table_name::regclass AND conname = item.constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE USING INDEX %I', item.table_name, item.constraint_name, item.constraint_name);
    END IF;
  END LOOP;
END $$;

-- Equivalent legacy checks retain their meaning and receive canonical names.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_incidents'::regclass AND conname = 'ai_incidents_check')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_incidents'::regclass AND conname = 'ai_incident_canonical_not_self_check') THEN
    ALTER TABLE "ai_incidents" RENAME CONSTRAINT "ai_incidents_check" TO "ai_incident_canonical_not_self_check";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_policies'::regclass AND conname = 'ai_policies_future_spending_limit_cents_check')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_policies'::regclass AND conname = 'ai_policies_future_spending_limit_check') THEN
    ALTER TABLE "ai_policies" RENAME CONSTRAINT "ai_policies_future_spending_limit_cents_check" TO "ai_policies_future_spending_limit_check";
  END IF;
END $$;

-- Both versions forbid deleting referenced issues; use the canonical RESTRICT
-- action. Replacement is atomic and the same references remain validated.
ALTER TABLE "ai_incidents"
  DROP CONSTRAINT "ai_incident_issue_fk",
  ADD CONSTRAINT "ai_incident_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  DROP CONSTRAINT "ai_incident_canonical_fk",
  ADD CONSTRAINT "ai_incident_canonical_fk" FOREIGN KEY ("canonical_issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_messages"
  DROP CONSTRAINT "ai_message_issue_fk",
  ADD CONSTRAINT "ai_message_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
