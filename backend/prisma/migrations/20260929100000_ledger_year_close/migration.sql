-- Fase 11 (cierre de ejercicio real) de doc/contabilidad/roadmap-partida-doble.md.
-- Campos de dotación al cierre (modo year_end_allocation/both) y auditoría
-- de cierre/reapertura. El cierre en sí no necesita ninguna garantía nueva
-- en base de datos: reutiliza por completo T1-T10 ya existentes (un asiento
-- de cierre es un asiento como cualquier otro) — solo hace falta la
-- sanidad de estos dos campos nuevos.

-- CreateEnum
CREATE TYPE "ReserveAllocationRule" AS ENUM ('fixed_amount', 'pct_of_result', 'top_up_to_legal_minimum');

-- AlterEnum (auditoría de cierre/reapertura de ejercicio en ActivityLog)
ALTER TYPE "ActivitySubjectType" ADD VALUE 'fiscal_year';

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "default_reserve_allocation_rule" "ReserveAllocationRule",
ADD COLUMN     "default_reserve_allocation_value" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "fiscal_years" ADD COLUMN     "closed_by_user_id" UUID,
ADD COLUMN     "reopen_reason" TEXT,
ADD COLUMN     "reopened_at" TIMESTAMPTZ,
ADD COLUMN     "reserve_allocation_rule" "ReserveAllocationRule",
ADD COLUMN     "reserve_allocation_value" DECIMAL(12,2);

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Sanidad de la dotación: sin valor solo se admite en top_up_to_legal_minimum ──
ALTER TABLE "fiscal_years"
  ADD CONSTRAINT "chk_fiscal_year_reserve_allocation_value" CHECK (
    "reserve_allocation_rule" IS NULL
    OR "reserve_allocation_rule" = 'top_up_to_legal_minimum'
    OR "reserve_allocation_value" IS NOT NULL
  ),
  ADD CONSTRAINT "chk_fiscal_year_reserve_allocation_nonneg" CHECK (
    "reserve_allocation_value" IS NULL OR "reserve_allocation_value" >= 0
  );

ALTER TABLE "accounting_settings"
  ADD CONSTRAINT "chk_settings_reserve_allocation_value" CHECK (
    "default_reserve_allocation_rule" IS NULL
    OR "default_reserve_allocation_rule" = 'top_up_to_legal_minimum'
    OR "default_reserve_allocation_value" IS NOT NULL
  ),
  ADD CONSTRAINT "chk_settings_reserve_allocation_nonneg" CHECK (
    "default_reserve_allocation_value" IS NULL OR "default_reserve_allocation_value" >= 0
  );
