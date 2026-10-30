-- Al fusionar un duplicado de una incidencia de ZONA COMÚN, sus avisos (`issue_reports`) pasan a la incidencia principal: así quien
-- avisó queda asociado a ella (recibe sus actualizaciones públicas y puede añadir notas y fotos) sin una entidad nueva de «seguidor».
-- `origin_issue_id` conserva la trazabilidad —«este vecino avisó originalmente de la incidencia X, que se fusionó con Y»—: la incidencia
-- duplicada sigue existiendo (cerrada) y su historial no se toca. Nulo = el aviso nunca cambió de incidencia. Aditivo: sin datos que migrar.
ALTER TABLE "issue_reports" ADD COLUMN "origin_issue_id" UUID;
CREATE INDEX "issue_reports_origin_issue_id_idx" ON "issue_reports"("origin_issue_id");
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_origin_issue_id_fkey" FOREIGN KEY ("origin_issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
