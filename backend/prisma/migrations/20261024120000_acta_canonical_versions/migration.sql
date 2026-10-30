-- Acta canónica: datos reales de la reunión y versiones de documento reproducibles.
-- Todo es nullable / con valor por defecto: las juntas y actas anteriores no cambian y NO se
-- reconstruyen snapshots que nunca existieron.
CREATE TYPE "MeetingConvocation" AS ENUM ('primera', 'segunda');
CREATE TYPE "ActaVersionStatus" AS ENUM ('draft', 'readyForSignature', 'signed', 'superseded');

ALTER TABLE "meetings"
  ADD COLUMN "actual_start_at" TIMESTAMPTZ,
  ADD COLUMN "actual_end_at" TIMESTAMPTZ,
  ADD COLUMN "effective_convocation" "MeetingConvocation";

ALTER TABLE "meeting_acta_versions"
  ADD COLUMN "status" "ActaVersionStatus" NOT NULL DEFAULT 'draft',
  ADD COLUMN "generated_at" TIMESTAMPTZ,
  ADD COLUMN "source_snapshot" JSONB,
  ADD COLUMN "document_model" JSONB,
  ADD COLUMN "narrative" JSONB,
  ADD COLUMN "version_hash" VARCHAR(64),
  ADD COLUMN "pdf_s3_key" TEXT,
  ADD COLUMN "prepared_at" TIMESTAMPTZ;

CREATE INDEX "meeting_acta_versions_meeting_id_status_idx" ON "meeting_acta_versions"("meeting_id", "status");
