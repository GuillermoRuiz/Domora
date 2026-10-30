-- CreateEnum
CREATE TYPE "TaxSettlementKind" AS ENUM ('modelo111', 'seguridad_social');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "excluded_from_347" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tax_settlements" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "kind" "TaxSettlementKind" NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "bank_account_id" UUID,
    "reference" VARCHAR(40),
    "entry_id" UUID NOT NULL,
    "undone_at" TIMESTAMPTZ,
    "undo_reason" VARCHAR(255),
    "undo_entry_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_settlements_entry_id_key" ON "tax_settlements"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_settlements_undo_entry_id_key" ON "tax_settlements"("undo_entry_id");

-- CreateIndex
CREATE INDEX "tax_settlements_estate_id_kind_period_idx" ON "tax_settlements"("estate_id", "kind", "period");

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_undo_entry_id_fkey" FOREIGN KEY ("undo_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- Ingresos del modelo 111 y pagos a la Seguridad Social (fase 7b).
-- Códigos DM070–DM071.
-- ═══════════════════════════════════════════════════════════════════════

-- Sugerencia inicial del art. 33.5 del RGAT: los proveedores de suministros
-- y seguros quedan fuera del 347 (la gestora puede cambiarlo).
UPDATE "suppliers" SET "excluded_from_347" = true WHERE "category" IN ('Suministros', 'Seguros');

ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_chk" CHECK (
      "amount" > 0
  AND (
        ("kind" = 'modelo111' AND "period" ~ '^\d{4}-T[1-4]$')
     OR ("kind" = 'seguridad_social' AND "period" ~ '^\d{4}-(0[1-9]|1[0-2])$')
  )
);

CREATE OR REPLACE FUNCTION tax_settlements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los ingresos de impuestos no se borran: deshazlo.'
      USING ERRCODE = 'DM070';
  END IF;
  IF OLD.undone_at IS NOT NULL
     OR NEW.undone_at IS NULL
     OR NEW.undo_entry_id IS NULL
     OR NEW.estate_id <> OLD.estate_id
     OR NEW.kind <> OLD.kind
     OR NEW.period <> OLD.period
     OR NEW.date <> OLD.date
     OR NEW.amount <> OLD.amount
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.entry_id <> OLD.entry_id THEN
    RAISE EXCEPTION 'Un ingreso de impuestos solo cambia para marcarlo como deshecho, una vez.'
      USING ERRCODE = 'DM070';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "tax_settlements_guard"
  BEFORE UPDATE OR DELETE ON "tax_settlements"
  FOR EACH ROW EXECUTE FUNCTION tax_settlements_guard();

-- El importe es lo que su asiento carga a la 4751 (111) o a la 476 (Seguridad Social).
CREATE OR REPLACE FUNCTION tax_settlements_after_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t       RECORD;
  v_estate uuid;
  v_debit numeric;
BEGIN
  SELECT * INTO t FROM "tax_settlements" WHERE "id" = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT "estate_id" INTO v_estate FROM "journal_entries" WHERE "id" = t.entry_id;
  IF v_estate IS DISTINCT FROM t.estate_id THEN
    RAISE EXCEPTION 'DM071: El ingreso y su asiento son de fincas distintas.'
      USING ERRCODE = 'DM071';
  END IF;
  v_debit := payroll_role_sum(t.entry_id,
    CASE WHEN t.kind = 'modelo111' THEN 'withholding_payable'::"AccountRole" ELSE 'social_security_payable'::"AccountRole" END,
    'debit');
  IF v_debit <> t.amount THEN
    RAISE EXCEPTION 'DM071: El ingreso de % € no coincide con lo que su asiento salda (% €).', t.amount, v_debit
      USING ERRCODE = 'DM071';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "tax_settlements_consistency"
  AFTER INSERT ON "tax_settlements"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tax_settlements_after_insert_check();

-- ── F1 ampliada: la purga borra también los ingresos de impuestos ──────
CREATE OR REPLACE FUNCTION accounting_purge_estate(p_estate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('domora.journal_purge', 'on', true);
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
