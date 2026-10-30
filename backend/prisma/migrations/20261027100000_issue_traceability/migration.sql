-- Fase 1 · Trazabilidad del expediente de una incidencia.
--  - Cada evento del historial dice QUÉ actuó (persona, IA, sistema, tercero), de qué tipo es y a qué artefacto apunta.
--  - Cada aviso queda registrado como `issue_reports`: canal, referencia original y contenido tal como llegó.

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('person', 'ai', 'system', 'external');

-- AlterTable
ALTER TABLE "issue_timeline_entries" ADD COLUMN     "actor_kind" "ActorKind" NOT NULL DEFAULT 'system',
ADD COLUMN     "kind" VARCHAR(40) NOT NULL DEFAULT 'note',
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "ref_id" UUID,
ADD COLUMN     "ref_type" VARCHAR(40);

-- CreateTable
CREATE TABLE "issue_reports" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "source_ref" VARCHAR(200),
    "content" TEXT NOT NULL,
    "reporter_user_id" UUID,
    "reporter_name" VARCHAR(200),
    "reporter_contact" VARCHAR(200),
    "received_at" TIMESTAMPTZ NOT NULL,
    "created_by_kind" "ActorKind" NOT NULL DEFAULT 'person',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_reports_issue_id_received_at_idx" ON "issue_reports"("issue_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "issue_reports_channel_source_ref_key" ON "issue_reports"("channel", "source_ref");

-- AddForeignKey
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill del historial: las entradas con autor son de una persona. Hasta ahora los cambios de estado,
-- presupuesto e instalación hechos por el gestor se guardaban con rol «Sistema»: se corrige a «Administrador».
-- Las entradas sin autor (eventos del pipeline de IA) conservan `system`: no se puede saber más a posteriori.
UPDATE "issue_timeline_entries" SET "actor_kind" = 'person' WHERE "author_user_id" IS NOT NULL;
UPDATE "issue_timeline_entries" SET "role" = 'Administrador' WHERE "role" = 'Sistema' AND "author_user_id" IS NOT NULL;

-- Backfill de reportes: el aviso original de cada incidencia existente (todas entraron por formulario).
INSERT INTO "issue_reports"
  ("id", "issue_id", "channel", "content", "reporter_user_id", "reporter_name", "received_at", "created_by_kind", "created_by_user_id")
SELECT
  gen_random_uuid(),
  i."id",
  'form',
  i."description",
  CASE WHEN i."source" = 'Propietario' THEN first_entry."author_user_id" END,
  i."owner_name",
  i."created_at",
  'person',
  first_entry."author_user_id"
FROM "issues" i
LEFT JOIN LATERAL (
  SELECT t."author_user_id"
  FROM "issue_timeline_entries" t
  WHERE t."issue_id" = i."id" AND t."author_user_id" IS NOT NULL
  ORDER BY t."date" ASC
  LIMIT 1
) first_entry ON TRUE
WHERE NOT EXISTS (SELECT 1 FROM "issue_reports" r WHERE r."issue_id" = i."id");
