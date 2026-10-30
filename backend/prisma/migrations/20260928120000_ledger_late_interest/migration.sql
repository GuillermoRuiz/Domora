-- Fase 10 (intereses de demora) de doc/contabilidad/roadmap-partida-doble.md.
-- Interés simple, días reales/365 fijo, sin anatocismo (ADR D7). Dos
-- garantías nuevas en base de datos:
--   T11: dos vigencias de tipo de la misma finca, o dos tramos liquidados
--        de la misma deuda, nunca se solapan (EXCLUDE gist).
--   DM100: un tramo de interés no puede liquidarse sobre otro recibo de
--        intereses (no interés sobre interés) ni cruzar de finca.
-- btree_gist ya existe desde 20260705120000_bookings_anti_overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "late_payment_interest_policies" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "annual_rate_pct" DECIMAL(5,2) NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "meeting_reference" VARCHAR(255),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "late_payment_interest_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_interest_accruals" (
    "id" UUID NOT NULL,
    "debt_receipt_id" UUID NOT NULL,
    "interest_receipt_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "principal_base" DECIMAL(10,2) NOT NULL,
    "annual_rate_pct" DECIMAL(5,2) NOT NULL,
    "days" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_interest_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "late_payment_interest_policies_estate_id_idx" ON "late_payment_interest_policies"("estate_id");

-- CreateIndex
CREATE INDEX "receipt_interest_accruals_debt_receipt_id_idx" ON "receipt_interest_accruals"("debt_receipt_id");

-- CreateIndex
CREATE INDEX "receipt_interest_accruals_interest_receipt_id_idx" ON "receipt_interest_accruals"("interest_receipt_id");

-- AddForeignKey
ALTER TABLE "late_payment_interest_policies" ADD CONSTRAINT "late_payment_interest_policies_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_payment_interest_policies" ADD CONSTRAINT "late_payment_interest_policies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_interest_accruals" ADD CONSTRAINT "receipt_interest_accruals_debt_receipt_id_fkey" FOREIGN KEY ("debt_receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_interest_accruals" ADD CONSTRAINT "receipt_interest_accruals_interest_receipt_id_fkey" FOREIGN KEY ("interest_receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_interest_accruals" ADD CONSTRAINT "receipt_interest_accruals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "late_payment_interest_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Sanidad numérica y de fechas ─────────────────────────────────────────

ALTER TABLE "late_payment_interest_policies"
  ADD CONSTRAINT "chk_interest_policy_dates" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  ADD CONSTRAINT "chk_interest_policy_rate" CHECK ("annual_rate_pct" >= 0),
  ADD CONSTRAINT "chk_interest_policy_grace" CHECK ("grace_days" >= 0);

ALTER TABLE "receipt_interest_accruals"
  ADD CONSTRAINT "chk_interest_accrual_dates" CHECK ("to_date" > "from_date"),
  ADD CONSTRAINT "chk_interest_accrual_amounts" CHECK (
    "principal_base" > 0 AND "annual_rate_pct" >= 0 AND "days" > 0 AND "amount" >= 0
  );

-- ── T11: sin solapes ──────────────────────────────────────────────────────
-- Dos vigencias de tipo de la misma finca no pueden pisarse.
ALTER TABLE "late_payment_interest_policies"
  ADD CONSTRAINT "excl_interest_policy_no_overlap" EXCLUDE USING gist (
    "estate_id" WITH =,
    daterange("valid_from", "valid_to", '[)') WITH &&
  );

-- Dos tramos liquidados de la MISMA deuda no pueden pisarse — la garantía
-- real de "nunca liquidar dos veces el mismo periodo".
ALTER TABLE "receipt_interest_accruals"
  ADD CONSTRAINT "excl_interest_accrual_no_overlap" EXCLUDE USING gist (
    "debt_receipt_id" WITH =,
    daterange("from_date", "to_date", '[)') WITH &&
  );

-- ── DM100: sin anatocismo, y deuda/póliza/recibo de intereses de la misma finca ──
CREATE OR REPLACE FUNCTION receipt_interest_accruals_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_debt_kind        "ReceiptKind";
  v_debt_estate       uuid;
  v_interest_kind     "ReceiptKind";
  v_interest_estate   uuid;
  v_policy_estate     uuid;
BEGIN
  SELECT "kind", "estate_id" INTO v_debt_kind, v_debt_estate
    FROM "receipts" WHERE "id" = NEW.debt_receipt_id;
  SELECT "kind", "estate_id" INTO v_interest_kind, v_interest_estate
    FROM "receipts" WHERE "id" = NEW.interest_receipt_id;
  SELECT "estate_id" INTO v_policy_estate
    FROM "late_payment_interest_policies" WHERE "id" = NEW.policy_id;

  IF v_debt_kind = 'intereses_demora' THEN
    RAISE EXCEPTION 'DM100: no se puede liquidar interés sobre un recibo que ya es de intereses (sin anatocismo).'
      USING ERRCODE = 'DM100';
  END IF;
  IF v_interest_kind <> 'intereses_demora' THEN
    RAISE EXCEPTION 'DM100: el recibo de intereses de un tramo debe ser de tipo intereses_demora.'
      USING ERRCODE = 'DM100';
  END IF;
  IF v_debt_estate IS DISTINCT FROM v_interest_estate
     OR v_debt_estate IS DISTINCT FROM v_policy_estate THEN
    RAISE EXCEPTION 'DM100: la deuda, el recibo de intereses y la política deben ser de la misma finca.'
      USING ERRCODE = 'DM100';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "receipt_interest_accruals_before_insert"
  BEFORE INSERT ON "receipt_interest_accruals"
  FOR EACH ROW EXECUTE FUNCTION receipt_interest_accruals_before_insert();

-- ── F1: accounting_purge_estate — limpia también intereses de demora ────
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
  -- Los tramos de interés citan recibos por las dos puntas (deuda e interés): fuera antes de tocar receipts.
  DELETE FROM "receipt_interest_accruals"
   WHERE "debt_receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id)
      OR "interest_receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id);
  DELETE FROM "late_payment_interest_policies" WHERE "estate_id" = p_estate_id;
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
