-- Fecha límite propia de la tarea, separada de cuándo se hace (start_at/end_at). NULL = vence al acabar su bloque: las tareas
-- existentes conservan su comportamiento y no se infiere ningún plazo histórico.
ALTER TABLE "agenda_tasks" ADD COLUMN "due_at" TIMESTAMPTZ;
