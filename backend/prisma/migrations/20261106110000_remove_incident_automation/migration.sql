-- Incidencias pasan a gestionarse exclusivamente de forma manual.
-- Se conservan los jobs y tablas IA compartidos por contabilidad, juntas y
-- el asistente; solo se retiran los artefactos exclusivos de incidencias.

UPDATE "agenda_tasks"
SET
  "status" = 'CANCELADA',
  "outcome" = 'superseded',
  "cancelled_at" = COALESCE("cancelled_at", CURRENT_TIMESTAMP),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "kind" IN (
  'approve_provider_message',
  'confirm_appointment',
  'review_failed_delivery',
  'review_provider_reply',
  'review_duplicate'
)
AND "status" IN ('PENDIENTE', 'EN_CURSO', 'EN_ESPERA');

DELETE FROM "ai_jobs"
WHERE "kind" IN ('incident', 'send', 'reply', 'issue_wait_due');

ALTER TABLE "ai_jobs" DROP COLUMN IF EXISTS "issue_id" CASCADE;

UPDATE "issue_waits"
SET
  "ended_at" = COALESCE("ended_at", CURRENT_TIMESTAMP),
  "end_reason" = COALESCE("end_reason", 'superseded')
WHERE "ref_type" = 'ai_message'
AND "ended_at" IS NULL;

DROP TABLE IF EXISTS "ai_messages";
DROP TABLE IF EXISTS "ai_incidents";
DROP TABLE IF EXISTS "automation_rules";
DROP TABLE IF EXISTS "ai_policies";
DROP TABLE IF EXISTS "administrator_features";
