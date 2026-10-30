-- CreateEnum
CREATE TYPE "ReserveFundUseReason" AS ENUM ('conservacion', 'reparacion', 'rehabilitacion', 'accesibilidad', 'eficiencia_energetica', 'seguro_danos', 'mantenimiento_permanente', 'otro');

-- CreateTable
CREATE TABLE "reserve_fund_applications" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" "ReserveFundUseReason" NOT NULL,
    "concept" VARCHAR(255) NOT NULL,
    "meeting_reference" VARCHAR(255) NOT NULL,
    "related_supplier_invoice_id" UUID,
    "related_payroll_id" UUID,
    "entry_id" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" VARCHAR(255),
    "cancel_entry_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserve_fund_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reserve_fund_applications_entry_id_key" ON "reserve_fund_applications"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "reserve_fund_applications_cancel_entry_id_key" ON "reserve_fund_applications"("cancel_entry_id");

-- CreateIndex
CREATE INDEX "reserve_fund_applications_estate_id_date_idx" ON "reserve_fund_applications"("estate_id", "date");

-- AddForeignKey
ALTER TABLE "reserve_fund_applications" ADD CONSTRAINT "reserve_fund_applications_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_fund_applications" ADD CONSTRAINT "reserve_fund_applications_related_supplier_invoice_id_fkey" FOREIGN KEY ("related_supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_fund_applications" ADD CONSTRAINT "reserve_fund_applications_related_payroll_id_fkey" FOREIGN KEY ("related_payroll_id") REFERENCES "payroll_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_fund_applications" ADD CONSTRAINT "reserve_fund_applications_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_fund_applications" ADD CONSTRAINT "reserve_fund_applications_cancel_entry_id_fkey" FOREIGN KEY ("cancel_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- Uso del fondo de reserva (117 → 746), fase de cierre del roadmap de
-- partida doble — art. 9.1.f LPH: el fondo tiene "una finalidad totalmente
-- independiente" del presupuesto ordinario, así que motivo y acta son
-- obligatorios (traza de cumplimiento), no opcionales como en las
-- políticas de interés. Códigos DM110-DM111.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "reserve_fund_applications" ADD CONSTRAINT "reserve_fund_applications_chk" CHECK ("amount" > 0);

CREATE OR REPLACE FUNCTION reserve_fund_applications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una liberación del fondo de reserva no se borra: deshazla.'
      USING ERRCODE = 'DM110';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     OR NEW.cancelled_at IS NULL
     OR NEW.cancel_entry_id IS NULL
     OR NEW.estate_id <> OLD.estate_id
     OR NEW.date <> OLD.date
     OR NEW.amount <> OLD.amount
     OR NEW.reason <> OLD.reason
     OR NEW.concept <> OLD.concept
     OR NEW.meeting_reference <> OLD.meeting_reference
     OR NEW.related_supplier_invoice_id IS DISTINCT FROM OLD.related_supplier_invoice_id
     OR NEW.related_payroll_id IS DISTINCT FROM OLD.related_payroll_id
     OR NEW.entry_id <> OLD.entry_id THEN
    RAISE EXCEPTION 'Una liberación del fondo de reserva solo cambia para marcarla como deshecha, una vez.'
      USING ERRCODE = 'DM110';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "reserve_fund_applications_guard"
  BEFORE UPDATE OR DELETE ON "reserve_fund_applications"
  FOR EACH ROW EXECUTE FUNCTION reserve_fund_applications_guard();

-- El importe es lo que su asiento carga a la 117 (y abona a la 746, por construcción del asiento).
CREATE OR REPLACE FUNCTION reserve_fund_applications_after_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r        RECORD;
  v_estate uuid;
  v_debit  numeric;
BEGIN
  SELECT * INTO r FROM "reserve_fund_applications" WHERE "id" = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT "estate_id" INTO v_estate FROM "journal_entries" WHERE "id" = r.entry_id;
  IF v_estate IS DISTINCT FROM r.estate_id THEN
    RAISE EXCEPTION 'DM111: La liberación y su asiento son de fincas distintas.'
      USING ERRCODE = 'DM111';
  END IF;
  v_debit := payroll_role_sum(r.entry_id, 'reserve_fund'::"AccountRole", 'debit');
  IF v_debit <> r.amount THEN
    RAISE EXCEPTION 'DM111: La liberación de % € no coincide con lo que su asiento carga a la 117 (% €).', r.amount, v_debit
      USING ERRCODE = 'DM111';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "reserve_fund_applications_consistency"
  AFTER INSERT ON "reserve_fund_applications"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION reserve_fund_applications_after_insert_check();

-- ── F1 ampliada: la purga borra también las liberaciones del fondo de reserva ──
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
  DELETE FROM "reserve_fund_applications" WHERE "estate_id" = p_estate_id;
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
