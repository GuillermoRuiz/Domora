-- CreateTable
CREATE TABLE "amenity_blackouts" (
    "id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenity_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "amenity_blackouts_amenity_id_start_date_end_date_idx" ON "amenity_blackouts"("amenity_id", "start_date", "end_date");

-- AddForeignKey
ALTER TABLE "amenity_blackouts" ADD CONSTRAINT "amenity_blackouts_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
