-- Entitlements por gestora, el reloj de las esperas fuera del worker de IA, retención del resultado del modelo y
-- atribución honesta de las asignaciones automáticas.
--  - `administrator_features`: capacidades contratadas (p. ej. `incident_ai`). Sin filas = ninguna gestora la tiene
--    (falla cerrado); lo que incluye cada plan se decide en `PLAN_FEATURE_DEFAULTS`, no aquí.
--  - `issue_waits.due_handled_at`: el barrido de incidencias procesa los vencimientos (ya no hay un job de IA por espera).
--  - `ai_requests.result_purged_at`: `result` se puede vaciar (configurable) cuando ya está materializado en su entidad.
--  - `issue_providers.assigned_by_user_id` pasa a ser opcional y se añade `assigned_by_kind`: un envío automático de
--    Domora no se atribuye a ninguna persona (antes se usaba la última que había tocado la política).
--  Las filas anteriores conservan su valor (`person`); no se pueden distinguir con certeza las automáticas antiguas.

ALTER TABLE "ai_requests" ADD COLUMN "result_purged_at" TIMESTAMPTZ;

ALTER TABLE "issue_providers" ALTER COLUMN "assigned_by_user_id" DROP NOT NULL;
ALTER TABLE "issue_providers" ADD COLUMN "assigned_by_kind" VARCHAR(10) NOT NULL DEFAULT 'person';
ALTER TABLE "issue_providers" ADD CONSTRAINT "issue_providers_assigned_by_chk"
  CHECK ("assigned_by_kind" IN ('person', 'ai', 'system')
         AND ("assigned_by_kind" <> 'person' OR "assigned_by_user_id" IS NOT NULL));

CREATE TABLE "administrator_features" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "administrator_id" UUID NOT NULL,
  "feature" VARCHAR(40) NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "source" VARCHAR(20) NOT NULL,
  "valid_until" TIMESTAMPTZ,
  "note" VARCHAR(300),
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "administrator_features_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "administrator_features_administrator_fk" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "administrator_features_source_chk" CHECK ("source" IN ('addon', 'trial', 'agreement', 'grandfathered', 'override'))
);
CREATE UNIQUE INDEX "administrator_features_administrator_id_feature_key" ON "administrator_features"("administrator_id", "feature");

ALTER TABLE "issue_waits" ADD COLUMN "due_handled_at" TIMESTAMPTZ;
CREATE INDEX "issue_waits_due_at_ended_at_due_handled_at_idx" ON "issue_waits"("due_at", "ended_at", "due_handled_at");

-- Los vencimientos que ya procesó un job antiguo no se repiten; los que aún no se habían procesado los recoge el barrido.
UPDATE "issue_waits" w
   SET "due_handled_at" = now()
 WHERE w."due_at" IS NOT NULL AND w."due_at" <= now() AND w."ended_at" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "ai_jobs" j
      WHERE j."kind" = 'issue_wait_due' AND j."entity_id" = w."id" AND j."status" IN ('pending', 'running')
   );
-- Esos jobs dejan de existir: el reloj es del workflow (barrido), no de la IA.
UPDATE "ai_jobs" SET "status" = 'completed' WHERE "kind" = 'issue_wait_due' AND "status" IN ('pending', 'running');
