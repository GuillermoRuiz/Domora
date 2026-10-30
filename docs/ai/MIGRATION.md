# Proposed Prisma/PostgreSQL migration

`migrations/20261003120000_ai_workflows/migration.sql` -> `backend/prisma/migrations/20261003120000_ai_workflows/migration.sql`. Never executed against reference/local application DB. Only isolated in-memory PG fixture used.

Ten additive tables originally: AiJob, AiPolicy, AiIncident, AiMessage, AiAudit, AiBatch, AiRequest, AiInvoiceDocument, AiReconciliationSuggestion, AiWeeklySnapshot. They support leases/policies/analysis/conversations/audit/Batch/extraction/review/publication. No original records updated or backfilled, no new core columns/status enum.

Dependencies: existing Estate/Property/Issue/Supplier/SupplierInvoice/BankAccount/BankExtractEntry/JournalLine mappings; gen_random_uuid already used by migrations. Supplier estateId column is camel-case. Unique keys cover job/event/request/hash/candidate/week idempotency. FKs, tenant triggers and checks enforce scopes, autonomy/confidence/limits and no self-canonical link. Complete proposed Prisma schema includes parent inverse relations; docs/prisma-additions.prisma is reference excerpt only.

Review against current production revision in a separate integration checkout. Build a disposable real PG DB from ALL existing migrations, apply proposed SQL, generate Client and run integration suite. Only then reviewed staging `prisma migrate deploy`; never run from the read-only reference or infer a production diff blindly.

`rollback.sql` removes only new AI tables/function, destroying their messages/audit/state. Backup and retention review required. No original incident/invoice/journal/bank deletion. Disable workers/revert source first, preserve linked original documents. Follow team's Prisma release/history process, never delete migration history blindly.

UPDATE (2026-11-06): `20261106110000_remove_incident_automation` dropped `ai_policies`, `ai_incidents`, `ai_messages`, `automation_rules` and `administrator_features` and the column `ai_jobs.issue_id`; incidents no longer use AI. `ai_jobs`, `ai_requests`, `ai_audit`, `ai_batches`, `ai_invoice_documents`, `ai_reconciliation_suggestions`, `ai_weekly_snapshots` and `ai_worker_heartbeats` remain (Accounting, Meetings, Assistant). `rollback.sql` below predates this and should not be run against a database that has the newer migration applied.
