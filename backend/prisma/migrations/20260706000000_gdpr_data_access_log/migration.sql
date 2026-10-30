-- Fase 13 (RGPD/LOPDGDD, art. 32): registro de accesos a datos personales
-- sensibles (IBANs, morosidad, ficheros SEPA). Append-only por política —
-- la aplicación nunca hace UPDATE/DELETE sobre esta tabla.

CREATE TABLE "data_access_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "resource" VARCHAR(100) NOT NULL,
    "resource_id" UUID,
    "action" VARCHAR(30) NOT NULL,
    "detail" VARCHAR(255),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_access_log_actor_user_id_occurred_at_idx"
  ON "data_access_log"("actor_user_id", "occurred_at" DESC);
CREATE INDEX "data_access_log_resource_resource_id_idx"
  ON "data_access_log"("resource", "resource_id");
