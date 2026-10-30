-- PR #6 (feature/catastro-propiedades), renombrada al completar la PR contra
-- main el 2026-10-01 — originalmente fechada 20260920120000. Puramente
-- aditiva (columnas nullable, un indice no-unico, un CHECK), sin
-- dependencia de nada tocado por las migraciones del diario de partida
-- doble que quedaron en medio.
-- AlterTable
ALTER TABLE "estates" ADD COLUMN     "province" VARCHAR(100),
ADD COLUMN     "postal_code" VARCHAR(10),
ADD COLUMN     "cadastral_reference" VARCHAR(14);

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "built_area_m2" DECIMAL(8,2),
ADD COLUMN     "catastro_synced_at" TIMESTAMPTZ;

-- CreateIndex
-- No es UNIQUE a propósito: el importador de ficheros ya pudo escribir
-- referencias catastrales repetidas dentro de una finca, y un índice único
-- haría fallar `prisma migrate deploy` al arrancar el contenedor. La
-- idempotencia de la importación desde el Catastro se garantiza en aplicación
-- (bloqueo de la fila de la finca + omitir las referencias que ya existen).
CREATE INDEX "properties_estate_id_cadastral_reference_idx" ON "properties"("estate_id", "cadastral_reference");

-- Superficie no negativa (mismo criterio de rango por fila que
-- chk_property_participation_quota).
ALTER TABLE "properties" ADD CONSTRAINT "chk_property_built_area"
  CHECK (built_area_m2 IS NULL OR built_area_m2 >= 0);
