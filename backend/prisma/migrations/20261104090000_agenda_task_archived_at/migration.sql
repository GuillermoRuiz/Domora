-- Las tareas de una incidencia borrada se archivan en vez de borrarse: el historial de la incidencia las referencia.
ALTER TABLE "agenda_tasks" ADD COLUMN "archived_at" TIMESTAMPTZ;
