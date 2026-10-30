-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "dedupe_key" VARCHAR(240) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ,
    "lease_token" UUID,
    "last_error" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_policies" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL DEFAULT '*',
    "autonomy" INTEGER NOT NULL DEFAULT 1,
    "supplier_id" UUID,
    "cc_administrator" BOOLEAN NOT NULL DEFAULT true,
    "duplicate_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "future_spending_limit_cents" INTEGER,
    "updated_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incidents" (
    "issue_id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "state" VARCHAR(40) NOT NULL DEFAULT 'created',
    "canonical_issue_id" UUID,
    "duplicate_decision" JSONB,
    "classification" JSONB,
    "appointment" JSONB,
    "supplier_id" UUID,
    "conversation_token_hash" VARCHAR(64),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_incidents_pkey" PRIMARY KEY ("issue_id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "dedupe_key" VARCHAR(240) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "supplier_id" UUID NOT NULL,
    "address" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "reply_to" VARCHAR(255),
    "message_id" VARCHAR(255),
    "raw_email" JSONB,
    "interpretation" JSONB,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "approval_source" VARCHAR(40),
    "send_started_at" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_audit" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "workflow" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_batches" (
    "id" UUID NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'preparing',
    "remote_id" VARCHAR(100),
    "input_file_id" VARCHAR(100),
    "output_file_id" VARCHAR(100),
    "error_file_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "dedupe_key" VARCHAR(240) NOT NULL,
    "batch_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "result" JSONB,
    "usage" JSONB,
    "last_error" VARCHAR(100),
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_invoice_documents" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "extraction" JSONB,
    "invoice_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_invoice_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reconciliation_suggestions" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "candidate_key" VARCHAR(100) NOT NULL,
    "entry_ids" UUID[],
    "line_ids" UUID[],
    "invoice_ids" UUID[],
    "status" VARCHAR(30) NOT NULL DEFAULT 'suggested',
    "evidence" JSONB NOT NULL,
    "ai_review" JSONB,
    "group_id" UUID,
    "reviewed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_reconciliation_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_weekly_snapshots" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "week_key" VARCHAR(10) NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL,
    "snapshot" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "intelligence" JSONB,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "ai_weekly_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_dedupe_key_key" ON "ai_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "ai_jobs_status_available_at_idx" ON "ai_jobs"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_policies_estate_id_category_key" ON "ai_policies"("estate_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ai_incidents_conversation_token_hash_key" ON "ai_incidents"("conversation_token_hash");

-- CreateIndex
CREATE INDEX "ai_incidents_estate_id_state_idx" ON "ai_incidents"("estate_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_dedupe_key_key" ON "ai_messages"("dedupe_key");

-- CreateIndex
CREATE INDEX "ai_messages_estate_id_issue_id_created_at_idx" ON "ai_messages"("estate_id", "issue_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_audit_estate_id_entity_id_created_at_idx" ON "ai_audit"("estate_id", "entity_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_batches_remote_id_key" ON "ai_batches"("remote_id");

-- CreateIndex
CREATE INDEX "ai_batches_status_idx" ON "ai_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_requests_dedupe_key_key" ON "ai_requests"("dedupe_key");

-- CreateIndex
CREATE INDEX "ai_requests_status_next_attempt_at_idx" ON "ai_requests"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ai_requests_batch_id_idx" ON "ai_requests"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_invoice_documents_estate_id_file_hash_key" ON "ai_invoice_documents"("estate_id", "file_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ai_reconciliation_suggestions_candidate_key_key" ON "ai_reconciliation_suggestions"("candidate_key");

-- CreateIndex
CREATE INDEX "ai_reconciliation_suggestions_estate_id_status_idx" ON "ai_reconciliation_suggestions"("estate_id", "status");

-- CreateIndex
CREATE INDEX "ai_weekly_snapshots_estate_id_completed_at_idx" ON "ai_weekly_snapshots"("estate_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_weekly_snapshots_estate_id_week_key_key" ON "ai_weekly_snapshots"("estate_id", "week_key");

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incident_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incident_canonical_fk" FOREIGN KEY ("canonical_issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_message_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_audit" ADD CONSTRAINT "ai_audit_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_request_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "ai_batches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_invoice_documents" ADD CONSTRAINT "ai_invoice_documents_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_reconciliation_suggestions" ADD CONSTRAINT "ai_reconciliation_suggestions_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_weekly_snapshots" ADD CONSTRAINT "ai_weekly_snapshots_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- CheckConstraint (Prisma no modela CHECK: se añaden a mano, igual que en el SQL original de la PR)
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_autonomy_check" CHECK ("autonomy" BETWEEN 0 AND 3);
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_duplicate_threshold_check" CHECK ("duplicate_threshold" BETWEEN 0.5 AND 1);
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_future_spending_limit_check" CHECK ("future_spending_limit_cents" IS NULL OR "future_spending_limit_cents" >= 0);
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incident_canonical_not_self_check" CHECK ("canonical_issue_id" IS NULL OR "canonical_issue_id" <> "issue_id");

