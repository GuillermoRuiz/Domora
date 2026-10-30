-- Instalaciones: estado operativo y proveedor responsable en los activos, y vínculo
-- OPCIONAL de las incidencias con una instalación. Todo aditivo y con valores por
-- defecto/NULL: no cambia ningún dato existente.
CREATE TYPE "AssetOperationalStatus" AS ENUM ('operativa', 'en_mantenimiento', 'fuera_de_servicio');

ALTER TABLE "assets"
  ADD COLUMN "operational_status" "AssetOperationalStatus" NOT NULL DEFAULT 'operativa',
  ADD COLUMN "supplier_id" UUID;

ALTER TABLE "issues"
  ADD COLUMN "asset_id" UUID;

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "assets_supplier_id_idx" ON "assets"("supplier_id");
CREATE INDEX "issues_asset_id_idx" ON "issues"("asset_id");
