-- CreateEnum
CREATE TYPE "StaffAuditAction" AS ENUM ('read', 'write', 'support_start', 'support_end', 'denied');

-- CreateTable
CREATE TABLE "support_sessions" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "ticket_ref" VARCHAR(100),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_audit_logs" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "administrator_id" UUID,
    "estate_id" UUID,
    "support_session_id" UUID,
    "action" "StaffAuditAction" NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "route" VARCHAR(300) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_sessions_staff_user_id_ended_at_idx" ON "support_sessions"("staff_user_id", "ended_at");

-- CreateIndex
CREATE INDEX "staff_audit_logs_occurred_at_idx" ON "staff_audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "staff_audit_logs_administrator_id_occurred_at_idx" ON "staff_audit_logs"("administrator_id", "occurred_at");

-- CreateIndex
CREATE INDEX "staff_audit_logs_staff_user_id_occurred_at_idx" ON "staff_audit_logs"("staff_user_id", "occurred_at");

