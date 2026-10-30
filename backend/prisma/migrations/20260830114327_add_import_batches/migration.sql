-- CreateEnum
CREATE TYPE "ImportSourcePlatform" AS ENUM ('GESFINCAS_NET', 'GENERIC');

-- CreateEnum
CREATE TYPE "ImportScope" AS ENUM ('current_state', 'historical_accounting');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('uploading', 'validating', 'ready', 'importing', 'completed', 'failed', 'rolled_back');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "source_platform" "ImportSourcePlatform" NOT NULL,
    "scope" "ImportScope" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL,
    "raw_file_key" VARCHAR(500),
    "mapping" JSONB,
    "summary" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_records" (
    "id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_estate_id_idx" ON "import_batches"("estate_id");

-- CreateIndex
CREATE INDEX "imported_records_import_batch_id_idx" ON "imported_records"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "imported_records_import_batch_id_entityType_entityId_key" ON "imported_records"("import_batch_id", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_records" ADD CONSTRAINT "imported_records_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
