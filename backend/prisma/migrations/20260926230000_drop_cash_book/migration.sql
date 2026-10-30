-- ═══════════════════════════════════════════════════════════════════════
-- Fase 8c: se elimina el libro de caja (`movements`) y su conciliación
-- antigua. El diario es la única fuente de verdad: tesorería, presupuesto,
-- centros de coste, alertas y resumen leen de él. Los datos eran de prueba.
-- ═══════════════════════════════════════════════════════════════════════

-- DropForeignKey
ALTER TABLE "movements" DROP CONSTRAINT "movements_account_id_fkey";

-- DropForeignKey
ALTER TABLE "movements" DROP CONSTRAINT "movements_cost_centre_id_fkey";

-- DropForeignKey
ALTER TABLE "movements" DROP CONSTRAINT "movements_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "movements" DROP CONSTRAINT "movements_estate_id_fkey";

-- DropForeignKey
ALTER TABLE "movements" DROP CONSTRAINT "movements_supplier_id_fkey";

-- DropForeignKey
ALTER TABLE "reconciliations" DROP CONSTRAINT "reconciliations_bank_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "reconciliations" DROP CONSTRAINT "reconciliations_estate_id_fkey";

-- DropForeignKey
ALTER TABLE "reconciliations" DROP CONSTRAINT "reconciliations_matched_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "reconciliations" DROP CONSTRAINT "reconciliations_movement_id_fkey";

-- AlterTable
ALTER TABLE "chart_accounts" DROP COLUMN "parent_code",
DROP COLUMN "type";

-- DropTable
DROP TABLE "movements";

-- DropTable
DROP TABLE "reconciliations";

-- DropEnum
DROP TYPE "ChartAccountType";

-- DropEnum
DROP TYPE "MovementType";


-- ── F1: la purga ya no toca la conciliación antigua ───────────────────
CREATE OR REPLACE FUNCTION accounting_purge_estate(p_estate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('domora.journal_purge', 'on', true);
  DELETE FROM "reconciliation_lines"
   WHERE "group_id" IN (SELECT "id" FROM "reconciliation_groups" WHERE "estate_id" = p_estate_id);
  DELETE FROM "bank_extract_entries" WHERE "estate_id" = p_estate_id;
  DELETE FROM "reconciliation_groups" WHERE "estate_id" = p_estate_id;
  DELETE FROM "bank_statements" WHERE "estate_id" = p_estate_id;
  DELETE FROM "journal_lines" WHERE "estate_id" = p_estate_id;
  DELETE FROM "receipt_returns" WHERE "estate_id" = p_estate_id;
  UPDATE "payment_agreement_installments" SET "collection_id" = NULL
   WHERE "collection_id" IN (SELECT "id" FROM "collections" WHERE "estate_id" = p_estate_id);
  DELETE FROM "collections" WHERE "estate_id" = p_estate_id;
  -- Las líneas de remesa las citan cobros y devoluciones: se borran aquí.
  DELETE FROM "remesa_lines" WHERE "remesa_id" IN (SELECT "id" FROM "remesas" WHERE "estate_id" = p_estate_id);
  DELETE FROM "remesas" WHERE "estate_id" = p_estate_id;
  DELETE FROM "suspense_items" WHERE "estate_id" = p_estate_id;
  DELETE FROM "receipt_lines" WHERE "receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id);
  UPDATE "payment_agreement_installments" SET "receipt_id" = NULL
   WHERE "receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id);
  DELETE FROM "payment_agreement_receipts"
   WHERE "receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id);
  DELETE FROM "receipts" WHERE "estate_id" = p_estate_id;
  DELETE FROM "receipt_sequences" WHERE "estate_id" = p_estate_id;
  DELETE FROM "tax_settlements" WHERE "estate_id" = p_estate_id;
  DELETE FROM "payroll_records" WHERE "estate_id" = p_estate_id;
  DELETE FROM "supplier_payments" WHERE "estate_id" = p_estate_id;
  DELETE FROM "supplier_invoice_lines"
   WHERE "invoice_id" IN (SELECT "id" FROM "supplier_invoices" WHERE "estate_id" = p_estate_id);
  DELETE FROM "supplier_invoices" WHERE "estate_id" = p_estate_id;
  DELETE FROM "journal_entry_attachments"
   WHERE "entry_id" IN (SELECT "id" FROM "journal_entries" WHERE "estate_id" = p_estate_id);
  DELETE FROM "journal_entries" WHERE "estate_id" = p_estate_id;
  DELETE FROM "journal_sequences" WHERE "estate_id" = p_estate_id;
  DELETE FROM "bank_accounts" WHERE "estate_id" = p_estate_id;
  UPDATE "chart_accounts" SET "parent_id" = NULL
   WHERE "estate_id" = p_estate_id AND "parent_id" IS NOT NULL;
  DELETE FROM "chart_accounts" WHERE "estate_id" = p_estate_id;
  DELETE FROM "accounting_settings" WHERE "estate_id" = p_estate_id;
  PERFORM set_config('domora.journal_purge', 'off', true);
END
$$;
