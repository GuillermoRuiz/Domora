-- Stop AI workers first; export audit/message/document metadata before dropping.
DROP TABLE IF EXISTS ai_weekly_snapshots CASCADE;
DROP TABLE IF EXISTS ai_reconciliation_suggestions CASCADE;
DROP TABLE IF EXISTS ai_invoice_documents CASCADE;
DROP TABLE IF EXISTS ai_requests CASCADE;
DROP TABLE IF EXISTS ai_batches CASCADE;
DROP TABLE IF EXISTS ai_audit CASCADE;
DROP TABLE IF EXISTS ai_messages CASCADE;
DROP TABLE IF EXISTS ai_incidents CASCADE;
DROP TABLE IF EXISTS ai_policies CASCADE;
DROP TABLE IF EXISTS ai_jobs CASCADE;
DROP FUNCTION IF EXISTS ai_check_tenant();
