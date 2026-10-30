-- Fase 9 de doc/contabilidad/roadmap-partida-doble.md: saldos iniciales.
-- Ver ledger/opening/opening-balances.service.ts.

-- CreateEnum
CREATE TYPE "OpeningBalanceSetStatus" AS ENUM ('Borrador', 'Contabilizado', 'Sustituido');

-- CreateEnum
CREATE TYPE "OpeningDifferenceRole" AS ENUM ('reserve_fund', 'retained');

-- CreateEnum
CREATE TYPE "JournalSide" AS ENUM ('debit', 'credit');

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "no_prior_balances_confirmed_at" TIMESTAMPTZ,
ADD COLUMN     "no_prior_balances_confirmed_by_user_id" UUID;

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "opening_invoice_id" UUID,
ADD COLUMN     "opening_set_id" UUID;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "opening_debt_id" UUID,
ADD COLUMN     "opening_set_id" UUID;

-- CreateTable
CREATE TABLE "opening_balance_sets" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "status" "OpeningBalanceSetStatus" NOT NULL DEFAULT 'Borrador',
    "difference" DECIMAL(12,2),
    "difference_role" "OpeningDifferenceRole",
    "difference_accepted" BOOLEAN NOT NULL DEFAULT false,
    "difference_accepted_by_user_id" UUID,
    "entry_id" UUID,
    "supersedes_id" UUID,
    "posted_at" TIMESTAMPTZ,
    "posted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opening_balance_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_bank_balances" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "statement_balance" DECIMAL(12,2),

    CONSTRAINT "opening_bank_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_property_debts" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "origin_year" INTEGER NOT NULL,
    "concept" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE,

    CONSTRAINT "opening_property_debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_property_advances" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "concept" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "opening_property_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_supplier_invoices" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" VARCHAR(60) NOT NULL,
    "concept" VARCHAR(300) NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "amount" DECIMAL(12,2) NOT NULL,
    "payable_role" "AccountRole" NOT NULL DEFAULT 'suppliers_payable',

    CONSTRAINT "opening_supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_other_balances" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "role" "AccountRole" NOT NULL,
    "concept" VARCHAR(255) NOT NULL,
    "side" "JournalSide" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "opening_other_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_sets_entry_id_key" ON "opening_balance_sets"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_sets_supersedes_id_key" ON "opening_balance_sets"("supersedes_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_bank_balances_set_id_bank_account_id_key" ON "opening_bank_balances"("set_id", "bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_opening_invoice_id_key" ON "supplier_invoices"("opening_invoice_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_opening_set_id_idx" ON "supplier_invoices"("opening_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_opening_debt_id_key" ON "receipts"("opening_debt_id");

-- CreateIndex
CREATE INDEX "receipts_opening_set_id_idx" ON "receipts"("opening_set_id");

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_no_prior_balances_confirmed_by_user_id_fkey" FOREIGN KEY ("no_prior_balances_confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_opening_set_id_fkey" FOREIGN KEY ("opening_set_id") REFERENCES "opening_balance_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_opening_invoice_id_fkey" FOREIGN KEY ("opening_invoice_id") REFERENCES "opening_supplier_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_sets" ADD CONSTRAINT "opening_balance_sets_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_sets" ADD CONSTRAINT "opening_balance_sets_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_sets" ADD CONSTRAINT "opening_balance_sets_difference_accepted_by_user_id_fkey" FOREIGN KEY ("difference_accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_sets" ADD CONSTRAINT "opening_balance_sets_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_sets" ADD CONSTRAINT "opening_balance_sets_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "opening_balance_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_bank_balances" ADD CONSTRAINT "opening_bank_balances_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "opening_balance_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_bank_balances" ADD CONSTRAINT "opening_bank_balances_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_property_debts" ADD CONSTRAINT "opening_property_debts_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "opening_balance_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_property_debts" ADD CONSTRAINT "opening_property_debts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_property_advances" ADD CONSTRAINT "opening_property_advances_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "opening_balance_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_property_advances" ADD CONSTRAINT "opening_property_advances_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_supplier_invoices" ADD CONSTRAINT "opening_supplier_invoices_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "opening_balance_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_supplier_invoices" ADD CONSTRAINT "opening_supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_other_balances" ADD CONSTRAINT "opening_other_balances_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "opening_balance_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_opening_set_id_fkey" FOREIGN KEY ("opening_set_id") REFERENCES "opening_balance_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_opening_debt_id_fkey" FOREIGN KEY ("opening_debt_id") REFERENCES "opening_property_debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- Garantías (códigos DM09x — ver src/ledger/journal/journal-db-errors.ts).
-- ═══════════════════════════════════════════════════════════════════════

-- O1: a lo sumo un Borrador y a lo sumo un Contabilizado por finca — DOS
-- índices, no uno: mientras se corrige un set ya contabilizado, el
-- Borrador nuevo (supersedesId) convive con el Contabilizado viejo hasta
-- que `repost` lo sustituye. El histórico (Sustituido) no cuenta en
-- ninguno de los dos.
CREATE UNIQUE INDEX "opening_balance_sets_one_draft"
  ON "opening_balance_sets"("estate_id")
  WHERE "status" = 'Borrador';

CREATE UNIQUE INDEX "opening_balance_sets_one_posted"
  ON "opening_balance_sets"("estate_id")
  WHERE "status" = 'Contabilizado';

-- O2: no se puede contabilizar (pasar a Contabilizado) con una diferencia
-- sin aceptar explícitamente (ADR, D17). Diferido: la diferencia se calcula
-- y se guarda en la misma transacción que el cambio de estado, así que hay
-- que esperar a que ambos escriban antes de comprobar.
CREATE OR REPLACE FUNCTION opening_balance_sets_difference_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT "status", "difference", "difference_accepted" INTO r
    FROM "opening_balance_sets" WHERE "id" = NEW.id;
  IF r.status = 'Contabilizado'
     AND r.difference IS NOT NULL AND r.difference <> 0
     AND NOT r.difference_accepted THEN
    RAISE EXCEPTION 'DM090: La diferencia de % € del asiento de apertura no se ha aceptado explícitamente.', r.difference
      USING ERRCODE = 'DM090';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "opening_balance_sets_difference_check"
  AFTER INSERT OR UPDATE ON "opening_balance_sets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION opening_balance_sets_difference_check();

-- O3: solo un set Contabilizado a la vez puede terminar en el entry_id de
-- un mismo asiento de apertura (ya lo garantiza el UNIQUE de la columna);
-- aquí solo se exige que sea de tipo 'opening' y de la finca correcta,
-- igual que hacen issueEntry/entry en recibos y facturas.
CREATE OR REPLACE FUNCTION opening_balance_sets_entry_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  e RECORD;
BEGIN
  SELECT "estate_id", "entry_id" INTO r FROM "opening_balance_sets" WHERE "id" = NEW.id;
  IF r.entry_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT "estate_id", "entry_type" INTO e FROM "journal_entries" WHERE "id" = r.entry_id;
  IF NOT FOUND OR e.estate_id <> r.estate_id OR e.entry_type <> 'opening' THEN
    RAISE EXCEPTION 'DM091: El asiento del set de saldos iniciales no es un asiento de apertura de esta finca.'
      USING ERRCODE = 'DM091';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "opening_balance_sets_entry_check"
  AFTER INSERT OR UPDATE ON "opening_balance_sets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION opening_balance_sets_entry_check();

-- O4: las facturas nacidas de un saldo inicial (opening_set_id informado)
-- eximen del desglose de líneas 6xx habitual — no hay gasto nuevo que
-- clasificar. Mismo criterio que receipts_after_write_check con
-- kind='saldo_anterior' (migración ledger_receipts).
CREATE OR REPLACE FUNCTION supplier_invoices_after_write_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r       RECORD;
  v_count int;
  v_sum   numeric;
  v_wh    numeric;
BEGIN
  PERFORM supplier_invoice_open_item_check(NEW.id);
  -- Un trigger diferido ve NEW tal como era al insertar: se relee.
  SELECT "number", "total", "withholding_amount", "entry_id", "opening_set_id" INTO r
    FROM "supplier_invoices" WHERE "id" = NEW.id;
  IF NOT FOUND OR TG_OP <> 'INSERT' THEN
    RETURN NULL;
  END IF;
  IF r.opening_set_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*), coalesce(sum("amount"), 0) INTO v_count, v_sum
    FROM "supplier_invoice_lines" WHERE "invoice_id" = NEW.id;
  IF v_count = 0 OR v_sum <> r.total THEN
    RAISE EXCEPTION 'DM052: Las líneas de la factura % (% €) no suman su total (% €).', r.number, v_sum, r.total
      USING ERRCODE = 'DM052';
  END IF;
  IF EXISTS (
    (SELECT "account_id", "cost_centre_id", "amount" FROM "supplier_invoice_lines" WHERE "invoice_id" = NEW.id
     EXCEPT ALL
     SELECT "account_id", "cost_centre_id", "debit" FROM "journal_lines"
      WHERE "entry_id" = r.entry_id AND "debit" > 0)
    UNION ALL
    (SELECT "account_id", "cost_centre_id", "debit" FROM "journal_lines"
      WHERE "entry_id" = r.entry_id AND "debit" > 0
     EXCEPT ALL
     SELECT "account_id", "cost_centre_id", "amount" FROM "supplier_invoice_lines" WHERE "invoice_id" = NEW.id)
  ) THEN
    RAISE EXCEPTION 'DM052: El asiento de la factura % no coincide con sus líneas de gasto.', r.number
      USING ERRCODE = 'DM052';
  END IF;
  SELECT coalesce(sum(jl."credit"), 0) INTO v_wh
    FROM "journal_lines" jl JOIN "chart_accounts" a ON a."id" = jl."account_id"
   WHERE jl."entry_id" = r.entry_id AND a."system_role" = 'withholding_payable';
  IF v_wh <> r.withholding_amount THEN
    RAISE EXCEPTION 'DM052: La retención contabilizada de la factura % (% €) no es la de la factura (% €).', r.number, v_wh, r.withholding_amount
      USING ERRCODE = 'DM052';
  END IF;
  RETURN NULL;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- F1 ampliada: la purga también limpia los saldos iniciales.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION accounting_purge_estate(p_estate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('domora.journal_purge', 'on', true);
  DELETE FROM "reconciliation_lines"
   WHERE "group_id" IN (SELECT "id" FROM "reconciliation_groups" WHERE "estate_id" = p_estate_id);
  DELETE FROM "bank_extract_entries" WHERE "estate_id" = p_estate_id;
  DELETE FROM "reconciliation_groups" WHERE "estate_id" = p_estate_id;
  DELETE FROM "bank_statements" WHERE "estate_id" = p_estate_id;
  -- Sueltan receipts/supplier_invoices antes de borrar los sets: sus FK son
  -- ON DELETE SET NULL, pero mejor explícito que depender del orden del plan.
  UPDATE "receipts" SET "opening_set_id" = NULL, "opening_debt_id" = NULL
   WHERE "estate_id" = p_estate_id;
  UPDATE "supplier_invoices" SET "opening_set_id" = NULL, "opening_invoice_id" = NULL
   WHERE "estate_id" = p_estate_id;
  DELETE FROM "opening_balance_sets" WHERE "estate_id" = p_estate_id;
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
