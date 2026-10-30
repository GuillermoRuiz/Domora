-- CreateEnum
CREATE TYPE "PayrollKind" AS ENUM ('mensual', 'extra', 'finiquito', 'otros');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('Registrada', 'Pagada', 'Anulada');

-- CreateTable
CREATE TABLE "payroll_records" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "kind" "PayrollKind" NOT NULL DEFAULT 'mensual',
    "accrual_date" DATE NOT NULL,
    "gross_salary" DECIMAL(10,2) NOT NULL,
    "employee_ss" DECIMAL(10,2) NOT NULL,
    "employer_ss" DECIMAL(10,2) NOT NULL,
    "irpf_withholding" DECIMAL(10,2) NOT NULL,
    "net_pay" DECIMAL(10,2) NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'Registrada',
    "entry_id" UUID,
    "paid_date" DATE,
    "payment_entry_id" UUID,
    "payment_bank_id" UUID,
    "cancel_entry_id" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" VARCHAR(255),
    "notes" VARCHAR(255),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_entry_id_key" ON "payroll_records"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_payment_entry_id_key" ON "payroll_records"("payment_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_cancel_entry_id_key" ON "payroll_records"("cancel_entry_id");

-- CreateIndex
CREATE INDEX "payroll_records_estate_id_period_idx" ON "payroll_records"("estate_id", "period");

-- CreateIndex
CREATE INDEX "payroll_records_staff_member_id_idx" ON "payroll_records"("staff_member_id");

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_payment_entry_id_fkey" FOREIGN KEY ("payment_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_cancel_entry_id_fkey" FOREIGN KEY ("cancel_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- Nóminas registradas a mano (fase 7c). Códigos DM060–DM062.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_amounts_chk" CHECK (
      "gross_salary" > 0
  AND "employee_ss" >= 0
  AND "employer_ss" >= 0
  AND "irpf_withholding" >= 0
  AND "net_pay" >= 0
  AND "net_pay" = "gross_salary" - "employee_ss" - "irpf_withholding"
  AND "period" ~ '^\d{4}-(0[1-9]|1[0-2])$'
  AND (("status" = 'Pagada') = ("paid_date" IS NOT NULL AND "payment_entry_id" IS NOT NULL))
  AND ("status" <> 'Anulada' OR "cancel_entry_id" IS NOT NULL)
);

-- Una nómina por empleado, mes y tipo, entre las no anuladas.
CREATE UNIQUE INDEX "payroll_records_staff_period_kind_key"
  ON "payroll_records" ("staff_member_id", "period", "kind")
  WHERE "status" <> 'Anulada';

CREATE OR REPLACE FUNCTION payroll_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estate uuid;
BEGIN
  SELECT "estate_id" INTO v_estate FROM "staff_members" WHERE "id" = NEW.staff_member_id;
  IF v_estate IS DISTINCT FROM NEW.estate_id THEN
    RAISE EXCEPTION 'El empleado no es de esta finca.'
      USING ERRCODE = 'DM062';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "payroll_records_before_insert"
  BEFORE INSERT ON "payroll_records"
  FOR EACH ROW EXECUTE FUNCTION payroll_before_insert();

-- Una nómina registrada no se reescribe ni se borra: cambian el pago (y su
-- deshacer) y la anulación.
CREATE OR REPLACE FUNCTION payroll_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las nóminas registradas no se borran: anúlala.'
      USING ERRCODE = 'DM060';
  END IF;
  IF NEW.estate_id <> OLD.estate_id
     OR NEW.staff_member_id <> OLD.staff_member_id
     OR NEW.period <> OLD.period
     OR NEW.kind <> OLD.kind
     OR NEW.accrual_date <> OLD.accrual_date
     OR NEW.gross_salary <> OLD.gross_salary
     OR NEW.employee_ss <> OLD.employee_ss
     OR NEW.employer_ss <> OLD.employer_ss
     OR NEW.irpf_withholding <> OLD.irpf_withholding
     OR NEW.net_pay <> OLD.net_pay
     OR (OLD.entry_id IS NOT NULL AND NEW.entry_id IS DISTINCT FROM OLD.entry_id)
     OR (OLD.cancel_entry_id IS NOT NULL AND NEW.cancel_entry_id IS DISTINCT FROM OLD.cancel_entry_id)
     OR (OLD.status = 'Anulada' AND NEW.status <> 'Anulada') THEN
    RAISE EXCEPTION 'Los datos de una nómina registrada no se modifican: anúlala y registra otra.'
      USING ERRCODE = 'DM060';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "payroll_records_guard"
  BEFORE UPDATE OR DELETE ON "payroll_records"
  FOR EACH ROW EXECUTE FUNCTION payroll_guard();

-- El asiento de la nómina tiene exactamente sus importes, cuenta a cuenta;
-- el del pago salda el neto.
CREATE OR REPLACE FUNCTION payroll_role_sum(p_entry uuid, p_role "AccountRole", p_side text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(CASE WHEN p_side = 'debit' THEN jl."debit" ELSE jl."credit" END), 0)
    FROM "journal_lines" jl JOIN "chart_accounts" a ON a."id" = jl."account_id"
   WHERE jl."entry_id" = p_entry AND a."system_role" = p_role;
$$;

CREATE OR REPLACE FUNCTION payroll_after_write_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM "payroll_records" WHERE "id" = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF r.entry_id IS NULL THEN
    RAISE EXCEPTION 'DM061: La nómina % de % no tiene asiento.', r.kind, r.period
      USING ERRCODE = 'DM061';
  END IF;
  IF payroll_role_sum(r.entry_id, 'wages', 'debit') <> r.gross_salary
     OR payroll_role_sum(r.entry_id, 'employer_ss', 'debit') <> r.employer_ss
     OR payroll_role_sum(r.entry_id, 'social_security_payable', 'credit') <> r.employee_ss + r.employer_ss
     OR payroll_role_sum(r.entry_id, 'withholding_payable', 'credit') <> r.irpf_withholding
     OR payroll_role_sum(r.entry_id, 'salaries_payable', 'credit') <> r.net_pay THEN
    RAISE EXCEPTION 'DM061: El asiento de la nómina de % no coincide con sus importes.', r.period
      USING ERRCODE = 'DM061';
  END IF;
  IF r.payment_entry_id IS NOT NULL
     AND payroll_role_sum(r.payment_entry_id, 'salaries_payable', 'debit') <> r.net_pay THEN
    RAISE EXCEPTION 'DM061: El pago de la nómina de % no salda su neto (% €).', r.period, r.net_pay
      USING ERRCODE = 'DM061';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "payroll_records_consistency"
  AFTER INSERT OR UPDATE ON "payroll_records"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payroll_after_write_check();

-- ── F1 ampliada: la purga borra también las nóminas ────────────────────
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
