-- Las partidas de extracto antiguas no tienen cuenta bancaria y son datos de
-- prueba: se vacían junto con su conciliación contra el libro de caja.
DELETE FROM "reconciliations";
UPDATE "movements" SET "reconciled" = false WHERE "reconciled";
DELETE FROM "bank_extract_entries";

-- AlterTable
ALTER TABLE "bank_extract_entries" ADD COLUMN     "bank_account_id" UUID NOT NULL,
ADD COLUMN     "reconciliation_group_id" UUID,
ADD COLUMN     "statement_id" UUID,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "period_from" DATE,
    "period_to" DATE,
    "opening_balance" DECIMAL(12,2),
    "closing_balance" DECIMAL(12,2),
    "entries_count" INTEGER NOT NULL,
    "imported_by_user_id" UUID,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_groups" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "method" "ReconciliationMatchMethod" NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_lines" (
    "group_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,

    CONSTRAINT "reconciliation_lines_pkey" PRIMARY KEY ("group_id","journal_line_id")
);

-- CreateIndex
CREATE INDEX "bank_statements_estate_id_imported_at_idx" ON "bank_statements"("estate_id", "imported_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_bank_account_id_file_hash_key" ON "bank_statements"("bank_account_id", "file_hash");

-- CreateIndex
CREATE INDEX "reconciliation_groups_bank_account_id_idx" ON "reconciliation_groups"("bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_lines_journal_line_id_key" ON "reconciliation_lines"("journal_line_id");

-- CreateIndex
CREATE INDEX "bank_extract_entries_bank_account_id_date_idx" ON "bank_extract_entries"("bank_account_id", "date");

-- CreateIndex
CREATE INDEX "bank_extract_entries_reconciliation_group_id_idx" ON "bank_extract_entries"("reconciliation_group_id");

-- AddForeignKey
ALTER TABLE "bank_extract_entries" ADD CONSTRAINT "bank_extract_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_extract_entries" ADD CONSTRAINT "bank_extract_entries_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_extract_entries" ADD CONSTRAINT "bank_extract_entries_reconciliation_group_id_fkey" FOREIGN KEY ("reconciliation_group_id") REFERENCES "reconciliation_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_groups" ADD CONSTRAINT "reconciliation_groups_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_groups" ADD CONSTRAINT "reconciliation_groups_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "reconciliation_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- Conciliación bancaria sobre el diario (fase 8b). Código DM080.
-- Un grupo de conciliación junta partidas del extracto y líneas del diario
-- de la MISMA cuenta bancaria que suman lo mismo.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reconciliation_group_check(p_group uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  g          RECORD;
  v_chart    uuid;
  v_entries  numeric;
  v_n_entries int;
  v_lines    numeric;
  v_n_lines  int;
  v_foreign  int;
BEGIN
  SELECT "id", "bank_account_id" INTO g FROM "reconciliation_groups" WHERE "id" = p_group;
  IF NOT FOUND THEN
    RETURN; -- deshecha o purgada
  END IF;
  SELECT "chart_account_id" INTO v_chart FROM "bank_accounts" WHERE "id" = g.bank_account_id;

  SELECT count(*), coalesce(sum("amount"), 0),
         count(*) FILTER (WHERE "bank_account_id" <> g.bank_account_id)
    INTO v_n_entries, v_entries, v_foreign
    FROM "bank_extract_entries" WHERE "reconciliation_group_id" = p_group;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'DM080: Una partida del extracto es de otra cuenta bancaria.'
      USING ERRCODE = 'DM080';
  END IF;

  SELECT count(*), coalesce(sum(jl."debit" - jl."credit"), 0),
         count(*) FILTER (WHERE jl."account_id" <> v_chart)
    INTO v_n_lines, v_lines, v_foreign
    FROM "reconciliation_lines" rl JOIN "journal_lines" jl ON jl."id" = rl."journal_line_id"
   WHERE rl."group_id" = p_group;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'DM080: Una línea del diario no es de la cuenta bancaria que se concilia.'
      USING ERRCODE = 'DM080';
  END IF;
  IF v_n_entries = 0 OR v_n_lines = 0 THEN
    RAISE EXCEPTION 'DM080: Una conciliación necesita al menos una partida del extracto y una línea del diario.'
      USING ERRCODE = 'DM080';
  END IF;
  IF v_entries <> v_lines THEN
    RAISE EXCEPTION 'DM080: El extracto (% €) y el diario (% €) no suman lo mismo.', v_entries, v_lines
      USING ERRCODE = 'DM080';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION reconciliation_groups_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM reconciliation_group_check(NEW.id);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "reconciliation_groups_consistency"
  AFTER INSERT ON "reconciliation_groups"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION reconciliation_groups_after_write();

CREATE OR REPLACE FUNCTION reconciliation_lines_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM reconciliation_group_check(CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "reconciliation_lines_consistency"
  AFTER INSERT OR DELETE ON "reconciliation_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION reconciliation_lines_after_write();

CREATE OR REPLACE FUNCTION bank_extract_entries_group_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reconciliation_group_id IS NOT NULL THEN
    PERFORM reconciliation_group_check(NEW.reconciliation_group_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.reconciliation_group_id IS NOT NULL
     AND OLD.reconciliation_group_id IS DISTINCT FROM NEW.reconciliation_group_id THEN
    PERFORM reconciliation_group_check(OLD.reconciliation_group_id);
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "bank_extract_entries_group_consistency"
  AFTER INSERT OR UPDATE OF "reconciliation_group_id" ON "bank_extract_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bank_extract_entries_group_check();

-- La partida de extracto y su cuenta son de la misma finca.
CREATE OR REPLACE FUNCTION bank_extract_entries_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estate uuid;
BEGIN
  SELECT "estate_id" INTO v_estate FROM "bank_accounts" WHERE "id" = NEW.bank_account_id;
  IF v_estate IS DISTINCT FROM NEW.estate_id THEN
    RAISE EXCEPTION 'La cuenta bancaria del extracto no es de esta finca.'
      USING ERRCODE = 'DM080';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "bank_extract_entries_before_insert"
  BEFORE INSERT ON "bank_extract_entries"
  FOR EACH ROW EXECUTE FUNCTION bank_extract_entries_before_insert();

-- ── F1 ampliada: extractos y conciliaciones ────────────────────────────
CREATE OR REPLACE FUNCTION accounting_purge_estate(p_estate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('domora.journal_purge', 'on', true);
  DELETE FROM "reconciliation_lines"
   WHERE "group_id" IN (SELECT "id" FROM "reconciliation_groups" WHERE "estate_id" = p_estate_id);
  DELETE FROM "reconciliations" WHERE "estate_id" = p_estate_id;
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
