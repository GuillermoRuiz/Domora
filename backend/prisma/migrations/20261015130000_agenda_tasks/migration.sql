-- Agenda de tareas de la gestora (módulo "Tareas"). Puramente aditiva: 9
-- tablas nuevas, 5 enums nuevos, una columna nueva en `administrators` y un
-- valor nuevo en NotificationCategory ('task', para los recordatorios). No
-- toca datos existentes.
--
-- Generada con `prisma migrate diff` y completada a mano con los CHECK de
-- integridad y el índice parcial de recordatorios (Prisma no los modela) —
-- mismo criterio que las migraciones del diario contable.

-- CreateEnum
CREATE TYPE "AgendaTaskType" AS ENUM ('SEGUIMIENTO', 'CORREO', 'COMUNICACION', 'LLAMADA', 'JUNTA', 'PRESUPUESTO', 'INCIDENCIA', 'DOCUMENTACION', 'COBRO_PAGO', 'VISITA', 'MANTENIMIENTO', 'PROVEEDOR', 'CONTABILIDAD', 'CONTRATO', 'SEGURO', 'LEGAL', 'ADMINISTRATIVA', 'OTRA');

-- CreateEnum
CREATE TYPE "AgendaTaskPriority" AS ENUM ('URGENTE', 'ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "AgendaTaskStatus" AS ENUM ('PENDIENTE', 'EN_CURSO', 'EN_ESPERA', 'COMPLETADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "AgendaRecurrenceFreq" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AgendaLinkType" AS ENUM ('issue', 'meeting', 'supplier', 'document');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'task';

-- AlterTable
ALTER TABLE "administrators" ADD COLUMN     "agenda_labels_initialized_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "agenda_tasks" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "estate_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "assigned_to_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "type" "AgendaTaskType" NOT NULL DEFAULT 'OTRA',
    "priority" "AgendaTaskPriority" NOT NULL DEFAULT 'MEDIA',
    "status" "AgendaTaskStatus" NOT NULL DEFAULT 'PENDIENTE',
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Europe/Madrid',
    "reminder_minutes_before" INTEGER,
    "recurrence_freq" "AgendaRecurrenceFreq",
    "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
    "recurrence_until" TIMESTAMPTZ,
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "source_ref" VARCHAR(120),
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agenda_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_task_labels" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_task_label_links" (
    "task_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "agenda_task_label_links_pkey" PRIMARY KEY ("task_id","label_id")
);

-- CreateTable
CREATE TABLE "agenda_task_checklist_items" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "text" VARCHAR(300) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_task_comments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_user_id" UUID,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_task_attachments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_task_links" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_type" "AgendaLinkType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_task_occurrences" (
    "task_id" UUID NOT NULL,
    "occurrence_start" TIMESTAMPTZ NOT NULL,
    "status" "AgendaTaskStatus" NOT NULL,
    "resolved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_occurrences_pkey" PRIMARY KEY ("task_id","occurrence_start")
);

-- CreateTable
CREATE TABLE "agenda_task_reminders" (
    "task_id" UUID NOT NULL,
    "occurrence_start" TIMESTAMPTZ NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_task_reminders_pkey" PRIMARY KEY ("task_id","occurrence_start")
);

-- CreateIndex
CREATE INDEX "agenda_tasks_administrator_id_start_at_idx" ON "agenda_tasks"("administrator_id", "start_at");

-- CreateIndex
CREATE INDEX "agenda_tasks_administrator_id_estate_id_start_at_idx" ON "agenda_tasks"("administrator_id", "estate_id", "start_at");

-- CreateIndex
CREATE INDEX "agenda_tasks_administrator_id_assigned_to_user_id_start_at_idx" ON "agenda_tasks"("administrator_id", "assigned_to_user_id", "start_at");

-- CreateIndex
CREATE INDEX "agenda_tasks_administrator_id_status_end_at_idx" ON "agenda_tasks"("administrator_id", "status", "end_at");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_tasks_administrator_id_source_source_ref_key" ON "agenda_tasks"("administrator_id", "source", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_task_labels_administrator_id_name_key" ON "agenda_task_labels"("administrator_id", "name");

-- CreateIndex
CREATE INDEX "agenda_task_label_links_label_id_idx" ON "agenda_task_label_links"("label_id");

-- CreateIndex
CREATE INDEX "agenda_task_checklist_items_task_id_position_idx" ON "agenda_task_checklist_items"("task_id", "position");

-- CreateIndex
CREATE INDEX "agenda_task_comments_task_id_created_at_idx" ON "agenda_task_comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "agenda_task_attachments_task_id_idx" ON "agenda_task_attachments"("task_id");

-- CreateIndex
CREATE INDEX "agenda_task_links_entity_type_entity_id_idx" ON "agenda_task_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_task_links_task_id_entity_type_entity_id_key" ON "agenda_task_links"("task_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "agenda_task_reminders_occurrence_start_idx" ON "agenda_task_reminders"("occurrence_start");

-- AddForeignKey
ALTER TABLE "agenda_tasks" ADD CONSTRAINT "agenda_tasks_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_tasks" ADD CONSTRAINT "agenda_tasks_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_tasks" ADD CONSTRAINT "agenda_tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_tasks" ADD CONSTRAINT "agenda_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_labels" ADD CONSTRAINT "agenda_task_labels_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_label_links" ADD CONSTRAINT "agenda_task_label_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_label_links" ADD CONSTRAINT "agenda_task_label_links_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "agenda_task_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_checklist_items" ADD CONSTRAINT "agenda_task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_comments" ADD CONSTRAINT "agenda_task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_comments" ADD CONSTRAINT "agenda_task_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_attachments" ADD CONSTRAINT "agenda_task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_attachments" ADD CONSTRAINT "agenda_task_attachments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_links" ADD CONSTRAINT "agenda_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_occurrences" ADD CONSTRAINT "agenda_task_occurrences_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_task_reminders" ADD CONSTRAINT "agenda_task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agenda_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Integridad que Prisma no modela ------------------------------------------

ALTER TABLE "agenda_tasks"
  ADD CONSTRAINT "agenda_tasks_end_after_start_chk" CHECK ("end_at" >= "start_at"),
  ADD CONSTRAINT "agenda_tasks_recurrence_interval_chk" CHECK ("recurrence_interval" BETWEEN 1 AND 365),
  ADD CONSTRAINT "agenda_tasks_reminder_chk" CHECK ("reminder_minutes_before" IS NULL OR "reminder_minutes_before" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "agenda_tasks_recurrence_chk" CHECK ("recurrence_freq" IS NOT NULL OR "recurrence_until" IS NULL),
  -- Una tarea dura como máximo 31 días: la consulta de calendario acota por ahí
  -- (start_at >= desde − 32 días) en lugar de recorrer todo el histórico del tenant.
  ADD CONSTRAINT "agenda_tasks_max_duration_chk" CHECK ("end_at" - "start_at" <= interval '31 days');

-- Consulta de calendario: las series (pocas) necesitan su propio índice, porque
-- su inicio puede ser arbitrariamente antiguo y no admiten cota inferior. Con
-- él, el OR "puntuales ∪ series" se resuelve con dos índices acotados; sin él,
-- Postgres recorre todo el histórico del tenant (medido: 73 ms → 1,7 ms con 150 000
-- tareas por gestora).
CREATE INDEX "agenda_tasks_recurring_idx" ON "agenda_tasks"("administrator_id", "start_at")
  WHERE "recurrence_freq" IS NOT NULL;

-- Recordatorios: el cron (cada minuto, sin filtrar por gestora) solo mira tareas
-- con recordatorio. El predicado NO incluye el estado a propósito: Prisma envía
-- los estados como parámetros (CAST($n AS enum), que Postgres no pliega a
-- constante), así que un predicado sobre el estado jamás se demostraría
-- implicado y el índice no se usaría. El estado se filtra sobre las pocas filas leídas.
CREATE INDEX "agenda_tasks_reminder_idx" ON "agenda_tasks"("start_at")
  WHERE "reminder_minutes_before" IS NOT NULL;
