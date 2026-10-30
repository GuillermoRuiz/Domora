-- Fase 2 · Cimientos del workflow de la incidencia.
--  - `ai_jobs.issue_id`: qué trabajo tiene Domora pendiente en cada incidencia (el `entity_id` es polimórfico).
--  - `issue_waits`: a quién espera el expediente fuera de Domora (proveedor, propietario…).
-- La situación de la incidencia se deriva de `agenda_tasks` + `ai_jobs` + `issue_waits` + `supplier_visits`.

-- CreateEnum
CREATE TYPE "WaitParty" AS ENUM ('provider', 'owner', 'other');

-- CreateEnum
CREATE TYPE "WaitEndReason" AS ENUM ('fulfilled', 'cancelled', 'expired', 'superseded');

-- AlterTable
ALTER TABLE "ai_jobs" ADD COLUMN     "issue_id" UUID;

-- CreateTable
CREATE TABLE "issue_waits" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "party" "WaitParty" NOT NULL,
    "supplier_id" UUID,
    "party_label" VARCHAR(200),
    "kind" VARCHAR(40) NOT NULL,
    "ref_type" VARCHAR(40),
    "ref_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL,
    "due_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "end_reason" "WaitEndReason",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_waits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_waits_issue_id_ended_at_idx" ON "issue_waits"("issue_id", "ended_at");

-- CreateIndex
CREATE INDEX "ai_jobs_issue_id_status_idx" ON "ai_jobs"("issue_id", "status");

-- Como mucho UNA espera abierta por (incidencia, tipo, referencia). Prisma no expresa índices parciales.
CREATE UNIQUE INDEX "issue_waits_open_key" ON "issue_waits"("issue_id", "kind", COALESCE("ref_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "ended_at" IS NULL;

-- AddForeignKey
ALTER TABLE "issue_waits" ADD CONSTRAINT "issue_waits_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_waits" ADD CONSTRAINT "issue_waits_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill de `ai_jobs.issue_id`: los jobs `incident` apuntan a la incidencia; `send` y `reply`, a un mensaje.
UPDATE "ai_jobs" j SET "issue_id" = j."entity_id"
WHERE j."kind" = 'incident' AND EXISTS (SELECT 1 FROM "issues" i WHERE i."id" = j."entity_id");

UPDATE "ai_jobs" j SET "issue_id" = m."issue_id"
FROM "ai_messages" m
WHERE j."kind" IN ('send', 'reply') AND m."id" = j."entity_id";

-- Backfill de esperas: una consulta ya enviada al proveedor, sin respuesta posterior, en una incidencia activa.
-- Sin plazo (`due_at` nulo): no se programa ningún temporizador con carácter retroactivo.
INSERT INTO "issue_waits"
  ("id", "issue_id", "party", "supplier_id", "party_label", "kind", "ref_type", "ref_id", "started_at")
SELECT
  gen_random_uuid(),
  m."issue_id",
  'provider',
  m."supplier_id",
  s."name",
  'provider_reply',
  'ai_message',
  m."id",
  COALESCE(m."sent_at", m."created_at")
FROM "ai_messages" m
JOIN "issues" i ON i."id" = m."issue_id" AND i."deleted_at" IS NULL AND i."status" IN ('Abierta', 'En reparación', 'Pendiente proveedor')
JOIN "suppliers" s ON s."id" = m."supplier_id"
WHERE m."direction" = 'outbound'
  AND m."status" IN ('sent', 'unknown')
  AND NOT EXISTS (
    SELECT 1 FROM "ai_messages" r
    WHERE r."issue_id" = m."issue_id" AND r."direction" = 'inbound' AND r."created_at" > COALESCE(m."sent_at", m."created_at")
  );
