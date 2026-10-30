-- Ubicación de la finca (WGS84) para el mapa de «Datos generales».
ALTER TABLE "estates"
  ADD COLUMN "latitude" DECIMAL(9,6),
  ADD COLUMN "longitude" DECIMAL(9,6),
  ADD COLUMN "geo_source" VARCHAR(20),
  ADD COLUMN "geo_resolved_at" TIMESTAMPTZ,
  ADD CONSTRAINT "estates_coordinates_pair" CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT "estates_coordinates_range" CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
