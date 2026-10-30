-- Foto de la finca subida por la gestora. Aditivo y opcional: no cambia ningún dato existente.
ALTER TABLE "estates"
  ADD COLUMN "photo_key" VARCHAR(500),
  ADD COLUMN "photo_content_type" VARCHAR(100),
  ADD COLUMN "photo_updated_at" TIMESTAMPTZ;
