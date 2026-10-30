-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "position" VARCHAR(100) NOT NULL,
    "national_id" VARCHAR(20),
    "email" VARCHAR(200),
    "phone" VARCHAR(30),
    "contract_type" VARCHAR(50) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "schedule" VARCHAR(200),
    "monthly_cost" DECIMAL(10,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'Activo',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_documents" (
    "id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_members_administrator_id_idx" ON "staff_members"("administrator_id");

-- CreateIndex
CREATE INDEX "staff_members_estate_id_idx" ON "staff_members"("estate_id");

-- CreateIndex
CREATE INDEX "staff_documents_staff_member_id_idx" ON "staff_documents"("staff_member_id");

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
