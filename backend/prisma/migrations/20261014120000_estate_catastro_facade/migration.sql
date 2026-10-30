ALTER TABLE "estates"
  ADD COLUMN "catastro_facade_url" VARCHAR(1000),
  ADD COLUMN "catastro_facade_resolved_at" TIMESTAMPTZ;
