-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('Abierto', 'Cerrado');

-- AlterEnum
ALTER TYPE "AlertSourceType" ADD VALUE 'budget_item';

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "cost_centre_id" UUID;

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Activo',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centre_budgets" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "cost_centre_id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "budgeted" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "cost_centre_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'Abierto',
    "approved_at" TIMESTAMPTZ,
    "approved_note" TEXT,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_centres_administrator_id_idx" ON "cost_centres"("administrator_id");

-- CreateIndex
CREATE INDEX "cost_centres_estate_id_idx" ON "cost_centres"("estate_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_estate_id_name_key" ON "cost_centres"("estate_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centre_budgets_estate_id_cost_centre_id_fiscal_year_key" ON "cost_centre_budgets"("estate_id", "cost_centre_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_estate_id_year_key" ON "fiscal_years"("estate_id", "year");

-- CreateIndex
CREATE INDEX "movements_estate_id_cost_centre_id_idx" ON "movements"("estate_id", "cost_centre_id");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centre_budgets" ADD CONSTRAINT "cost_centre_budgets_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centre_budgets" ADD CONSTRAINT "cost_centre_budgets_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
