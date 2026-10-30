-- Privacidad de la IA y dominio mínimo de la incidencia.
--  - `WaitParty.insurer`: el expediente puede esperar a una aseguradora.
--  - `issues.resolution_route`: vía de gestión decidida por una persona (null = sin decidir).
--  - `ai_messages.attachment_photo_ids`: fotos que una PERSONA autorizó adjuntar al proveedor (antes salían solas).
--  - `ai_batches.remote_files_deleted_at` / `ai_requests.payload_purged_at`: limpieza de lo que ya no hace falta.
--  - La visibilidad del historial para el propietario pasa de lista negra a lista blanca: se marca como interno
--    todo lo que no esté expresamente permitido (los tipos permitidos están en `issue-event-kinds.ts`).

ALTER TYPE "WaitParty" ADD VALUE IF NOT EXISTS 'insurer';

ALTER TABLE "issues" ADD COLUMN "resolution_route" VARCHAR(30);

ALTER TABLE "ai_messages" ADD COLUMN "attachment_photo_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "ai_batches" ADD COLUMN "remote_files_deleted_at" TIMESTAMPTZ;

ALTER TABLE "ai_requests" ADD COLUMN "payload_purged_at" TIMESTAMPTZ;

-- La visibilidad del historial (`issue_timeline_entries.internal`) se aplica en 20261028130000_issue_event_visibility, después de
-- 20261028120000_owner_issues_unify_tickets, que es quien añade la columna en `main`.
