-- Estado previo a completar la tarea: desmarcarla lo restaura (en vez de volver siempre a PENDIENTE).
ALTER TABLE "agenda_tasks" ADD COLUMN "status_before_completion" "AgendaTaskStatus";
