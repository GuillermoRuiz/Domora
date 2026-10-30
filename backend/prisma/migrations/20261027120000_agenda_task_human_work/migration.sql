-- Fase 3 · Tareas humanas de la agenda abiertas por Domora.
-- `agenda_tasks` sigue siendo trabajo que tiene que hacer una PERSONA. Una tarea de decisión (aprobar un envío,
-- confirmar una cita…) lleva su incidencia, su tipo de acción y un `payload`/`result_ref` validados por tipo en código.
-- Las abre Domora, no una persona: `created_by_user_id` pasa a ser opcional y `created_by_kind` dice quién fue.

-- CreateEnum
CREATE TYPE "TaskCreatorKind" AS ENUM ('person', 'ai', 'system');

-- DropForeignKey
ALTER TABLE "agenda_tasks" DROP CONSTRAINT "agenda_tasks_created_by_user_id_fkey";

-- AlterTable
ALTER TABLE "agenda_tasks" ADD COLUMN     "created_by_kind" "TaskCreatorKind" NOT NULL DEFAULT 'person',
ADD COLUMN     "issue_id" UUID,
ADD COLUMN     "kind" VARCHAR(60),
ADD COLUMN     "outcome" VARCHAR(30),
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "result_ref" JSONB,
ALTER COLUMN "created_by_user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "agenda_tasks_issue_id_status_idx" ON "agenda_tasks"("issue_id", "status");

-- AddForeignKey
ALTER TABLE "agenda_tasks" ADD CONSTRAINT "agenda_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_tasks" ADD CONSTRAINT "agenda_tasks_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
