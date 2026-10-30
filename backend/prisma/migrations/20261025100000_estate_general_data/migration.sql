-- Datos generales de la finca (pestaña de solo lectura, editados en «Editar finca»).
ALTER TABLE "estates"
  ADD COLUMN "year_built" INTEGER,
  ADD COLUMN "main_use" VARCHAR(50),
  ADD COLUMN "internal_ref" VARCHAR(50),
  ADD COLUMN "tax_regime" VARCHAR(150),
  ADD COLUMN "applicable_law" VARCHAR(150) DEFAULT 'Ley de Propiedad Horizontal',
  ADD COLUMN "notes" VARCHAR(2000),
  ADD COLUMN "parcel_area_m2" DECIMAL(10,2);
