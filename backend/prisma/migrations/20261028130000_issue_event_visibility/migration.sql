-- Visibilidad del historial de una incidencia: `issue_timeline_entries.internal`.
-- La columna la añade en `main` 20261028120000_owner_issues_unify_tickets (notas internas de la gestión), que se ejecuta ANTES que
-- esta migración; por eso aquí solo se garantiza su existencia (`IF NOT EXISTS`) y se aplica la lista blanca de tipos de evento
-- visibles para quien avisó (debe coincidir con REQUESTER_VISIBLE_EVENT_KINDS en `issue-event-kinds.ts`): todo lo demás es interno.
ALTER TABLE "issue_timeline_entries" ADD COLUMN IF NOT EXISTS "internal" BOOLEAN NOT NULL DEFAULT false;

UPDATE "issue_timeline_entries"
   SET "internal" = true
 WHERE "internal" = false
   AND (
        "kind" NOT IN ('note', 'status_changed', 'asset_linked', 'budget_updated', 'report_received',
                       'notification_sent', 'requester_informed', 'visit_scheduled', 'appointment_confirmed')
        -- Notas escritas por el sistema o la IA (antes del catálogo de tipos): también internas.
        OR ("kind" = 'note' AND "actor_kind" IN ('ai', 'system'))
       );
