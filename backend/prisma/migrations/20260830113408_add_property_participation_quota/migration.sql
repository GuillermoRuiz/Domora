-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "participation_quota" DECIMAL(5,2);

-- Rango 0-100 por fila. La suma ≈100% por finca (elementos comunes,
-- redondeo de datos reales de Gesfincas) se valida solo en aplicación, no
-- aquí — un CHECK agregado entre filas necesitaría un trigger, y este campo
-- todavía no tiene ningún flujo que dependa de que la suma cuadre.
ALTER TABLE "properties" ADD CONSTRAINT "chk_property_participation_quota"
  CHECK (participation_quota IS NULL OR (participation_quota >= 0 AND participation_quota <= 100));
