-- Acta subida: una junta puede tener un acta ya hecha (PDF/DOCX) en lugar de la generada en Domora.
CREATE TYPE "ActaOrigin" AS ENUM ('generated', 'uploaded');

ALTER TABLE "meetings"
  ADD COLUMN "acta_origin" "ActaOrigin" NOT NULL DEFAULT 'generated',
  ADD COLUMN "acta_upload_s3_key" VARCHAR(500),
  ADD COLUMN "acta_upload_file_name" VARCHAR(255),
  ADD COLUMN "acta_upload_mime_type" VARCHAR(100),
  ADD COLUMN "acta_upload_size_bytes" INTEGER,
  ADD COLUMN "acta_upload_sha256" VARCHAR(64),
  ADD COLUMN "acta_uploaded_at" TIMESTAMPTZ;
