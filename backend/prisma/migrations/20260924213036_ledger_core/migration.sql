-- CreateEnum
CREATE TYPE "AccountNature" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('bank', 'cash', 'owners_receivable', 'suppliers_payable', 'creditors_payable', 'withholding_payable', 'social_security_payable', 'salaries_payable', 'suspense', 'reserve_fund', 'retained', 'prior_losses', 'result', 'income_ordinary', 'income_extraordinary', 'reserve_applied', 'income_rentals', 'income_recharges', 'interest_income', 'bank_fees', 'bad_debts', 'wages', 'employer_ss');

-- CreateEnum
CREATE TYPE "JournalEntryType" AS ENUM ('opening', 'standard', 'regularization', 'result_allocation', 'closing', 'year_opening');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('manual', 'treasury', 'receipt_issue', 'receipt_cancel', 'collection', 'collection_undo', 'remesa_collection', 'receipt_return', 'advance_application', 'suspense_application', 'interest_accrual', 'supplier_invoice', 'supplier_invoice_cancel', 'supplier_payment', 'supplier_payment_undo', 'tax_settlement', 'payroll', 'reserve_use', 'opening_balance', 'year_close', 'year_reopen', 'import');

-- AlterTable
ALTER TABLE "chart_accounts" ADD COLUMN     "allows_cost_centre" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archived_at" TIMESTAMPTZ,
ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nature" "AccountNature",
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "postable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requires_property" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requires_supplier" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "system_role" "AccountRole";

-- Rellena la naturaleza de las cuentas que ya existían (datos de prueba del
-- libro de caja) a partir del grupo del código, y la hace obligatoria.
UPDATE "chart_accounts" SET "nature" = CASE left("code", 1)
    WHEN '6' THEN 'expense'::"AccountNature"
    WHEN '7' THEN 'income'::"AccountNature"
    WHEN '1' THEN 'equity'::"AccountNature"
    ELSE 'asset'::"AccountNature"
  END;
ALTER TABLE "chart_accounts" ALTER COLUMN "nature" SET NOT NULL;

-- CreateTable
CREATE TABLE "accounting_settings" (
    "estate_id" UUID NOT NULL,
    "cutover_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("estate_id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "chart_account_id" UUID NOT NULL,
    "alias" VARCHAR(100) NOT NULL,
    "iban_enc" VARCHAR(255),
    "iban_last4" VARCHAR(4),
    "bic" VARCHAR(11),
    "bank_name" VARCHAR(100),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_reserve_account" BOOLEAN NOT NULL DEFAULT false,
    "opened_on" DATE,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "entry_type" "JournalEntryType" NOT NULL DEFAULT 'standard',
    "source_type" "JournalSource" NOT NULL,
    "source_id" UUID,
    "concept" VARCHAR(255) NOT NULL,
    "reference" VARCHAR(100),
    "reverses_entry_id" UUID,
    "import_batch_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_xid" BIGINT NOT NULL DEFAULT txid_current(),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "estate_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "entry_type" "JournalEntryType" NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "concept" VARCHAR(255),
    "property_id" UUID,
    "supplier_id" UUID,
    "cost_centre_id" UUID,
    "receipt_id" UUID,
    "supplier_invoice_id" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_sequences" (
    "estate_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "journal_sequences_pkey" PRIMARY KEY ("estate_id","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_chart_account_id_key" ON "bank_accounts"("chart_account_id");

-- CreateIndex
CREATE INDEX "bank_accounts_estate_id_idx" ON "bank_accounts"("estate_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_entry_id_key" ON "journal_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "journal_entries_estate_id_date_idx" ON "journal_entries"("estate_id", "date");

-- CreateIndex
CREATE INDEX "journal_entries_source_type_source_id_idx" ON "journal_entries"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_estate_id_fiscal_year_number_key" ON "journal_entries"("estate_id", "fiscal_year", "number");

-- CreateIndex
CREATE INDEX "journal_lines_estate_id_account_id_date_idx" ON "journal_lines"("estate_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "journal_lines_receipt_id_idx" ON "journal_lines"("receipt_id");

-- CreateIndex
CREATE INDEX "journal_lines_supplier_invoice_id_idx" ON "journal_lines"("supplier_invoice_id");

-- CreateIndex
CREATE INDEX "journal_lines_property_id_account_id_idx" ON "journal_lines"("property_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_lines_supplier_id_idx" ON "journal_lines"("supplier_id");

-- CreateIndex
CREATE INDEX "journal_lines_cost_centre_id_fiscal_year_idx" ON "journal_lines"("cost_centre_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_entry_id_line_no_key" ON "journal_lines"("entry_id", "line_no");

-- CreateIndex
CREATE INDEX "chart_accounts_parent_id_idx" ON "chart_accounts"("parent_id");

-- AddForeignKey
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_chart_account_id_fkey" FOREIGN KEY ("chart_account_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_estate_id_fiscal_year_fkey" FOREIGN KEY ("estate_id", "fiscal_year") REFERENCES "fiscal_years"("estate_id", "year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- Garantías del libro diario (doc/contabilidad/adr-partida-doble.md)
--
-- Prisma no ve nada de lo que sigue: vive solo aquí. La spec
-- src/ledger/db-guarantees.spec.ts comprueba que cada garantía existe y
-- funciona, para que un reset o un squash no la pierda sin avisar.
--
-- Códigos SQLSTATE propios (clase DM) que el backend traduce a mensajes y
-- códigos HTTP en src/ledger/journal/journal-db-errors.ts.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Configuración contable de las fincas que ya existían ───────────────
-- Fecha de corte = primer día del mes de alta, como hace EstatesService.
INSERT INTO "accounting_settings" ("estate_id", "cutover_date", "updated_at")
SELECT "id", date_trunc('month', "created_at")::date, now() FROM "estates"
ON CONFLICT ("estate_id") DO NOTHING;

-- ── CHECK ──────────────────────────────────────────────────────────────
-- C1: cada línea va al debe o al haber, nunca a los dos ni a ninguno.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side_chk"
  CHECK ("debit" >= 0 AND "credit" >= 0
         AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)));

-- C2: ejercicio natural y número positivo.
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_year_chk"
  CHECK ("fiscal_year" = EXTRACT(YEAR FROM "date")::int AND "number" > 0);

-- C3: el código de cuenta son solo dígitos. NOT VALID: se exige a las filas
-- nuevas sin revalidar las que dejó el libro de caja.
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_code_digits_chk"
  CHECK ("code" ~ '^[0-9]{3,10}$') NOT VALID;

-- Una sola cuenta por papel de sistema en cada finca (bancos y caja pueden
-- tener varias subcuentas).
CREATE UNIQUE INDEX "chart_accounts_estate_singleton_role_key"
  ON "chart_accounts" ("estate_id", "system_role")
  WHERE "system_role" IS NOT NULL AND "system_role" NOT IN ('bank', 'cash');

-- Una sola cuenta bancaria por defecto en cada finca.
CREATE UNIQUE INDEX "bank_accounts_one_default_key"
  ON "bank_accounts" ("estate_id") WHERE "is_default";

-- ── Bandera de purga ───────────────────────────────────────────────────
-- Solo accounting_purge_estate() la activa, y solo dentro de su transacción.
-- Protege frente a errores de código, no frente a quien tenga acceso
-- directo a la base de datos (misma limitación que verifactu_records_guard).
CREATE OR REPLACE FUNCTION domora_journal_purge_enabled() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('domora.journal_purge', true), '') = 'on'
$$;

-- ── T2: antes de insertar un asiento ───────────────────────────────────
CREATE OR REPLACE FUNCTION journal_entries_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cutover date;
  v_status  "FiscalYearStatus";
  v_orig    RECORD;
BEGIN
  NEW.created_xid := txid_current();

  SELECT "cutover_date" INTO v_cutover
    FROM "accounting_settings" WHERE "estate_id" = NEW.estate_id;
  IF v_cutover IS NULL THEN
    RAISE EXCEPTION 'La finca no tiene fecha de inicio contable configurada.'
      USING ERRCODE = 'DM011';
  END IF;
  IF NEW."date" < v_cutover THEN
    RAISE EXCEPTION 'El asiento del % es anterior a la fecha de inicio contable (%).', NEW."date", v_cutover
      USING ERRCODE = 'DM012';
  END IF;
  IF NEW.entry_type = 'opening' AND NEW."date" <> v_cutover THEN
    RAISE EXCEPTION 'El asiento de apertura debe ir en la fecha de inicio contable (%).', v_cutover
      USING ERRCODE = 'DM013';
  END IF;

  -- FOR SHARE: un cierre de ejercicio simultáneo espera a este asiento, y
  -- este asiento espera al cierre y luego ve el ejercicio ya cerrado.
  SELECT "status" INTO v_status FROM "fiscal_years"
   WHERE "estate_id" = NEW.estate_id AND "year" = NEW.fiscal_year
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ejercicio % no existe en esta finca.', NEW.fiscal_year
      USING ERRCODE = 'DM014';
  END IF;
  IF v_status = 'Cerrado' THEN
    RAISE EXCEPTION 'El ejercicio % está cerrado: no admite asientos.', NEW.fiscal_year
      USING ERRCODE = 'DM015';
  END IF;

  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT "estate_id", "entry_type", "reverses_entry_id" INTO v_orig
      FROM "journal_entries" WHERE "id" = NEW.reverses_entry_id;
    IF NOT FOUND OR v_orig.estate_id <> NEW.estate_id THEN
      RAISE EXCEPTION 'El asiento que se quiere revertir no existe en esta finca.'
        USING ERRCODE = 'DM016';
    END IF;
    IF v_orig.reverses_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un contraasiento no se puede revertir: registra un asiento nuevo.'
        USING ERRCODE = 'DM016';
    END IF;
    IF v_orig.entry_type <> NEW.entry_type THEN
      RAISE EXCEPTION 'El contraasiento debe ser del mismo tipo que el asiento original.'
        USING ERRCODE = 'DM016';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "journal_entries_before_insert"
  BEFORE INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entries_before_insert();

-- ── T1: antes de insertar una línea ────────────────────────────────────
CREATE OR REPLACE FUNCTION journal_lines_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e        RECORD;
  a        RECORD;
  v_estate uuid;
  v_ref    uuid;
BEGIN
  SELECT "estate_id", "date", "fiscal_year", "entry_type", "created_xid" INTO e
    FROM "journal_entries" WHERE "id" = NEW.entry_id;
  IF e.created_xid <> txid_current() THEN
    RAISE EXCEPTION 'Las líneas solo se pueden añadir en la misma operación que crea el asiento.'
      USING ERRCODE = 'DM003';
  END IF;

  -- Copias del asiento: las fija la base de datos, no quien inserta.
  NEW.estate_id   := e.estate_id;
  NEW."date"      := e."date";
  NEW.fiscal_year := e.fiscal_year;
  NEW.entry_type  := e.entry_type;

  SELECT "estate_id", "code", "postable", "archived_at", "requires_property",
         "requires_supplier", "allows_cost_centre", "system_role"
    INTO a FROM "chart_accounts" WHERE "id" = NEW.account_id;
  IF a.estate_id <> NEW.estate_id THEN
    RAISE EXCEPTION 'La cuenta % no pertenece a la finca del asiento.', a.code
      USING ERRCODE = 'DM004';
  END IF;
  IF NOT a.postable THEN
    RAISE EXCEPTION 'La cuenta % es agrupadora y no admite apuntes: usa una subcuenta.', a.code
      USING ERRCODE = 'DM005';
  END IF;
  IF a.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta % está archivada y no admite apuntes.', a.code
      USING ERRCODE = 'DM005';
  END IF;

  IF a.requires_property AND NEW.property_id IS NULL THEN
    RAISE EXCEPTION 'La cuenta % exige indicar la propiedad.', a.code
      USING ERRCODE = 'DM006';
  END IF;
  IF NOT a.requires_property AND NEW.property_id IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta % no admite propiedad.', a.code
      USING ERRCODE = 'DM006';
  END IF;
  IF NEW.property_id IS NOT NULL THEN
    SELECT "estate_id" INTO v_estate FROM "properties" WHERE "id" = NEW.property_id;
    IF v_estate IS DISTINCT FROM NEW.estate_id THEN
      RAISE EXCEPTION 'La propiedad no pertenece a la finca del asiento.'
        USING ERRCODE = 'DM007';
    END IF;
  END IF;

  IF a.requires_supplier AND NEW.supplier_id IS NULL THEN
    RAISE EXCEPTION 'La cuenta % exige indicar el proveedor.', a.code
      USING ERRCODE = 'DM008';
  END IF;
  IF NOT a.requires_supplier AND NEW.supplier_id IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta % no admite proveedor.', a.code
      USING ERRCODE = 'DM008';
  END IF;
  IF NEW.supplier_id IS NOT NULL THEN
    -- La columna física de suppliers es "estateId" (sin @map, ver schema).
    SELECT "estateId" INTO v_estate FROM "suppliers" WHERE "id" = NEW.supplier_id;
    IF v_estate IS DISTINCT FROM NEW.estate_id THEN
      RAISE EXCEPTION 'El proveedor no pertenece a la finca del asiento.'
        USING ERRCODE = 'DM007';
    END IF;
  END IF;

  IF NEW.receipt_id IS NOT NULL THEN
    IF a.system_role IS DISTINCT FROM 'owners_receivable' THEN
      RAISE EXCEPTION 'Solo la cuenta de propietarios admite un recibo.'
        USING ERRCODE = 'DM009';
    END IF;
    SELECT r."property_id", p."estate_id" INTO v_ref, v_estate
      FROM "receipts" r JOIN "accounting_periods" p ON p."id" = r."period_id"
     WHERE r."id" = NEW.receipt_id;
    IF v_ref IS DISTINCT FROM NEW.property_id OR v_estate IS DISTINCT FROM NEW.estate_id THEN
      RAISE EXCEPTION 'El recibo no corresponde a la propiedad de la línea.'
        USING ERRCODE = 'DM009';
    END IF;
  END IF;

  IF NEW.supplier_invoice_id IS NOT NULL THEN
    IF NOT a.requires_supplier THEN
      RAISE EXCEPTION 'Solo las cuentas de proveedores admiten una factura.'
        USING ERRCODE = 'DM009';
    END IF;
    SELECT "supplier_id" INTO v_ref FROM "supplier_invoices" WHERE "id" = NEW.supplier_invoice_id;
    IF v_ref IS DISTINCT FROM NEW.supplier_id THEN
      RAISE EXCEPTION 'La factura no corresponde al proveedor de la línea.'
        USING ERRCODE = 'DM009';
    END IF;
  END IF;

  IF NEW.cost_centre_id IS NOT NULL THEN
    IF NOT a.allows_cost_centre THEN
      RAISE EXCEPTION 'La cuenta % no admite centro de coste: solo los gastos e ingresos.', a.code
        USING ERRCODE = 'DM010';
    END IF;
    SELECT "estate_id" INTO v_estate FROM "cost_centres" WHERE "id" = NEW.cost_centre_id;
    IF v_estate IS DISTINCT FROM NEW.estate_id THEN
      RAISE EXCEPTION 'El centro de coste no pertenece a la finca del asiento.'
        USING ERRCODE = 'DM007';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "journal_lines_before_insert"
  BEFORE INSERT ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_lines_before_insert();

-- ── T3: al confirmar la transacción, el asiento cuadra ─────────────────
CREATE OR REPLACE FUNCTION journal_entries_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_count  int;
  v_debit  numeric;
  v_credit numeric;
BEGIN
  SELECT count(*), coalesce(sum("debit"), 0), coalesce(sum("credit"), 0)
    INTO v_count, v_debit, v_credit
    FROM "journal_lines" WHERE "entry_id" = NEW.id;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'El asiento % necesita al menos dos líneas.', NEW.number
      USING ERRCODE = 'DM001';
  END IF;
  IF v_debit <> v_credit OR v_debit = 0 THEN
    RAISE EXCEPTION 'El asiento % no cuadra: debe % y haber %.', NEW.number, v_debit, v_credit
      USING ERRCODE = 'DM002';
  END IF;

  -- Un contraasiento es el espejo exacto del original: mismas cuentas y
  -- dimensiones, con debe y haber intercambiados.
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (
    (SELECT "account_id", "property_id", "supplier_id", "cost_centre_id", "receipt_id", "supplier_invoice_id", "debit", "credit"
       FROM "journal_lines" WHERE "entry_id" = NEW.reverses_entry_id
     EXCEPT ALL
     SELECT "account_id", "property_id", "supplier_id", "cost_centre_id", "receipt_id", "supplier_invoice_id", "credit", "debit"
       FROM "journal_lines" WHERE "entry_id" = NEW.id)
    UNION ALL
    (SELECT "account_id", "property_id", "supplier_id", "cost_centre_id", "receipt_id", "supplier_invoice_id", "credit", "debit"
       FROM "journal_lines" WHERE "entry_id" = NEW.id
     EXCEPT ALL
     SELECT "account_id", "property_id", "supplier_id", "cost_centre_id", "receipt_id", "supplier_invoice_id", "debit", "credit"
       FROM "journal_lines" WHERE "entry_id" = NEW.reverses_entry_id)
  ) THEN
    RAISE EXCEPTION 'El contraasiento % no es el espejo exacto del asiento que revierte.', NEW.number
      USING ERRCODE = 'DM017';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entries_check_balanced();

-- ── T4: lo contabilizado no se modifica ni se borra ────────────────────
CREATE OR REPLACE FUNCTION journal_immutable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_LEVEL = 'STATEMENT' THEN
      RETURN NULL;
    ELSIF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Los asientos contabilizados no se pueden modificar ni borrar: registra un contraasiento.'
    USING ERRCODE = 'DM020';
END
$$;

CREATE TRIGGER "journal_entries_immutable"
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable_guard();
CREATE TRIGGER "journal_entries_no_truncate"
  BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immutable_guard();
CREATE TRIGGER "journal_lines_immutable"
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable_guard();
CREATE TRIGGER "journal_lines_no_truncate"
  BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immutable_guard();

-- ── T10: coherencia del plan de cuentas ────────────────────────────────
CREATE OR REPLACE FUNCTION chart_accounts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF domora_journal_purge_enabled() THEN
      RETURN OLD;
    END IF;
    IF OLD.system THEN
      RAISE EXCEPTION 'La cuenta % es del plan de la comunidad y no se puede borrar: archívala.', OLD.code
        USING ERRCODE = 'DM022';
    END IF;
    IF EXISTS (SELECT 1 FROM "journal_lines" WHERE "account_id" = OLD.id) THEN
      RAISE EXCEPTION 'La cuenta % tiene apuntes y no se puede borrar: archívala.', OLD.code
        USING ERRCODE = 'DM022';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT "estate_id", "code", "level" INTO p FROM "chart_accounts" WHERE "id" = NEW.parent_id;
    IF p.estate_id <> NEW.estate_id
       OR left(NEW.code, length(p.code)) <> p.code
       OR length(NEW.code) <= length(p.code) THEN
      RAISE EXCEPTION 'La subcuenta % debe empezar por el código de su cuenta padre %.', NEW.code, p.code
        USING ERRCODE = 'DM021';
    END IF;
    NEW.level := p.level + 1;
  END IF;

  IF (left(NEW.code, 1) = '6') <> (NEW.nature = 'expense')
     OR (left(NEW.code, 1) = '7') <> (NEW.nature = 'income') THEN
    RAISE EXCEPTION 'Las cuentas del grupo 6 son de gasto y las del grupo 7 de ingreso (cuenta %).', NEW.code
      USING ERRCODE = 'DM021';
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.code <> NEW.code OR OLD.nature <> NEW.nature)
     AND NOT domora_journal_purge_enabled() THEN
    IF OLD.system THEN
      RAISE EXCEPTION 'La cuenta % es del plan de la comunidad: no se puede cambiar su código ni su naturaleza.', OLD.code
        USING ERRCODE = 'DM022';
    END IF;
    IF EXISTS (SELECT 1 FROM "journal_lines" WHERE "account_id" = OLD.id) THEN
      RAISE EXCEPTION 'La cuenta % tiene apuntes: no se puede cambiar su código ni su naturaleza.', OLD.code
        USING ERRCODE = 'DM022';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "chart_accounts_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "chart_accounts"
  FOR EACH ROW EXECUTE FUNCTION chart_accounts_guard();

-- ── F1: única vía de borrado de la contabilidad de una finca ───────────
-- La usan las specs, el seed y "Reiniciar contabilidad" (solo sin ningún
-- ejercicio cerrado, lo comprueba el servicio). Quien la llame debe haber
-- borrado antes lo que referencia al plan de cuentas desde el libro de caja
-- heredado (movements, budget_items).
CREATE OR REPLACE FUNCTION accounting_purge_estate(p_estate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('domora.journal_purge', 'on', true);
  DELETE FROM "journal_lines" WHERE "estate_id" = p_estate_id;
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
