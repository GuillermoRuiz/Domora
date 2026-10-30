-- Las facturas de proveedor antiguas (importe y estado libres) son datos de prueba:
-- el modelo cambia por completo y se vacian (plan B, estrategia de despliegue).
DELETE FROM "supplier_invoices";

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('Registrada', 'Parcial', 'Pagada', 'Anulada');

-- CreateEnum
CREATE TYPE "WithholdingKey" AS ENUM ('A_trabajo', 'G_profesional', 'other');

-- AlterTable
ALTER TABLE "supplier_invoices" DROP COLUMN "amount",
DROP COLUMN "date",
ADD COLUMN     "base_amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "cancel_entry_id" UUID,
ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ,
ADD COLUMN     "cancelled_by_user_id" UUID,
ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "due_date" DATE,
ADD COLUMN     "entry_id" UUID,
ADD COLUMN     "estate_id" UUID NOT NULL,
ADD COLUMN     "issue_date" DATE NOT NULL,
ADD COLUMN     "number" VARCHAR(60) NOT NULL,
ADD COLUMN     "outstanding" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "payable" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "payable_role" "AccountRole" NOT NULL,
ADD COLUMN     "received_date" DATE NOT NULL,
ADD COLUMN     "total" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "vat_amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "vat_rate_pct" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "withholding_amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "withholding_key" "WithholdingKey",
ADD COLUMN     "withholding_rate_pct" DECIMAL(5,2) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'Registrada';

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "description" VARCHAR(255),
    "base_amount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PayMethod" NOT NULL,
    "bank_account_id" UUID,
    "entry_id" UUID NOT NULL,
    "notes" VARCHAR(255),
    "undone_at" TIMESTAMPTZ,
    "undone_by_user_id" UUID,
    "undo_reason" VARCHAR(255),
    "undo_entry_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_invoice_id_line_no_key" ON "supplier_invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_entry_id_key" ON "supplier_payments"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_undo_entry_id_key" ON "supplier_payments"("undo_entry_id");

-- CreateIndex
CREATE INDEX "supplier_payments_estate_id_date_idx" ON "supplier_payments"("estate_id", "date");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_entry_id_key" ON "supplier_invoices"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_cancel_entry_id_key" ON "supplier_invoices"("cancel_entry_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_estate_id_status_idx" ON "supplier_invoices"("estate_id", "status");

-- CreateIndex
CREATE INDEX "supplier_invoices_estate_id_received_date_idx" ON "supplier_invoices"("estate_id", "received_date");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_cancel_entry_id_fkey" FOREIGN KEY ("cancel_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_undo_entry_id_fkey" FOREIGN KEY ("undo_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- Facturas y pagos a proveedores (doc/contabilidad/adr-partida-doble.md,
-- fase 7). Cada factura nace con su asiento (6xx contra 400/410 y 4751) y
-- su estado de pago es una caché de la partida abierta de la 400/410, que
-- la base de datos verifica al confirmar. Códigos DM050–DM056; los de
-- triggers diferidos llevan el código al principio del mensaje.
-- ═══════════════════════════════════════════════════════════════════════

-- ── CHECK ──────────────────────────────────────────────────────────────
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_amounts_chk" CHECK (
      "base_amount" > 0
  AND "vat_amount" >= 0
  AND "withholding_amount" >= 0
  AND "vat_rate_pct" BETWEEN 0 AND 100
  AND "withholding_rate_pct" BETWEEN 0 AND 100
  AND "total" = "base_amount" + "vat_amount"
  AND "payable" = "total" - "withholding_amount"
  AND "payable" > 0
  AND "outstanding" >= 0 AND "outstanding" <= "payable"
  AND "payable_role" IN ('suppliers_payable', 'creditors_payable')
  AND ("withholding_amount" = 0 OR "withholding_key" IS NOT NULL)
);
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_amounts_chk"
  CHECK ("amount" > 0 AND "base_amount" >= 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_chk"
  CHECK ("amount" > 0);

-- El número de factura es único por proveedor entre las no anuladas: una
-- factura anulada por error se puede volver a registrar con su número.
CREATE UNIQUE INDEX "supplier_invoices_supplier_number_key"
  ON "supplier_invoices" ("supplier_id", lower("number"))
  WHERE "status" <> 'Anulada';

-- ── Antes de insertar: el proveedor es de la finca ─────────────────────
CREATE OR REPLACE FUNCTION supplier_docs_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estate uuid;
BEGIN
  SELECT "estateId" INTO v_estate FROM "suppliers" WHERE "id" = NEW.supplier_id;
  IF v_estate IS DISTINCT FROM NEW.estate_id THEN
    RAISE EXCEPTION 'El proveedor no es de esta finca.'
      USING ERRCODE = 'DM056';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "supplier_invoices_before_insert"
  BEFORE INSERT ON "supplier_invoices"
  FOR EACH ROW EXECUTE FUNCTION supplier_docs_before_insert();
CREATE TRIGGER "supplier_payments_before_insert"
  BEFORE INSERT ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION supplier_docs_before_insert();

-- ── Una factura registrada no se reescribe ni se borra ─────────────────
-- Cambian solo: estado y pendiente (verificados abajo), vencimiento, el
-- asiento (una vez), la anulación y el adjunto.
CREATE OR REPLACE FUNCTION supplier_invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las facturas registradas no se borran: anúlala.'
      USING ERRCODE = 'DM053';
  END IF;
  IF NEW.estate_id <> OLD.estate_id
     OR NEW.supplier_id <> OLD.supplier_id
     OR NEW.number <> OLD.number
     OR NEW.concept <> OLD.concept
     OR NEW.issue_date <> OLD.issue_date
     OR NEW.received_date <> OLD.received_date
     OR NEW.base_amount <> OLD.base_amount
     OR NEW.vat_rate_pct <> OLD.vat_rate_pct
     OR NEW.vat_amount <> OLD.vat_amount
     OR NEW.withholding_rate_pct <> OLD.withholding_rate_pct
     OR NEW.withholding_amount <> OLD.withholding_amount
     OR NEW.withholding_key IS DISTINCT FROM OLD.withholding_key
     OR NEW.total <> OLD.total
     OR NEW.payable <> OLD.payable
     OR NEW.payable_role <> OLD.payable_role
     OR (OLD.entry_id IS NOT NULL AND NEW.entry_id IS DISTINCT FROM OLD.entry_id)
     OR (OLD.cancel_entry_id IS NOT NULL AND NEW.cancel_entry_id IS DISTINCT FROM OLD.cancel_entry_id)
     OR (OLD.status = 'Anulada' AND NEW.status <> 'Anulada') THEN
    RAISE EXCEPTION 'Los datos de una factura registrada no se modifican: anúlala y registra otra.'
      USING ERRCODE = 'DM053';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "supplier_invoices_guard"
  BEFORE UPDATE OR DELETE ON "supplier_invoices"
  FOR EACH ROW EXECUTE FUNCTION supplier_invoices_guard();

CREATE TRIGGER "supplier_invoice_lines_immutable"
  BEFORE UPDATE OR DELETE ON "supplier_invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable_guard();
CREATE TRIGGER "supplier_invoice_lines_no_truncate"
  BEFORE TRUNCATE ON "supplier_invoice_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immutable_guard();

-- ── Partida abierta: estado y pendiente cuadran con la 400/410 ─────────
CREATE OR REPLACE FUNCTION supplier_invoice_open_item_check(p_invoice_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r      RECORD;
  v_open numeric;
BEGIN
  SELECT "number", "payable", "outstanding", "status", "entry_id" INTO r
    FROM "supplier_invoices" WHERE "id" = p_invoice_id;
  IF NOT FOUND THEN
    RETURN; -- borrada en una purga
  END IF;
  IF r.entry_id IS NULL THEN
    RAISE EXCEPTION 'DM052: La factura % no tiene asiento.', r.number
      USING ERRCODE = 'DM052';
  END IF;

  SELECT coalesce(sum("credit" - "debit"), 0) INTO v_open
    FROM "journal_lines" WHERE "supplier_invoice_id" = p_invoice_id;
  IF v_open < 0 OR v_open > r.payable THEN
    RAISE EXCEPTION 'DM050: La factura % quedaría con % € por pagar, fuera de 0 y su importe (% €): ¿pago duplicado?', r.number, v_open, r.payable
      USING ERRCODE = 'DM050';
  END IF;
  IF r.outstanding <> v_open THEN
    RAISE EXCEPTION 'DM051: El pendiente de la factura % (% €) no coincide con su contabilidad (% €).', r.number, r.outstanding, v_open
      USING ERRCODE = 'DM051';
  END IF;
  IF NOT (
       (r.status = 'Anulada'    AND v_open = 0)
    OR (r.status = 'Pagada'     AND v_open = 0)
    OR (r.status = 'Registrada' AND v_open = r.payable)
    OR (r.status = 'Parcial'    AND v_open > 0 AND v_open < r.payable)
  ) THEN
    RAISE EXCEPTION 'DM051: El estado "%" de la factura % no corresponde a lo que queda por pagar (% €).', r.status, r.number, v_open
      USING ERRCODE = 'DM051';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION journal_lines_supplier_invoice_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM supplier_invoice_open_item_check(NEW.supplier_invoice_id);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "journal_lines_supplier_invoice_open_item"
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.supplier_invoice_id IS NOT NULL)
  EXECUTE FUNCTION journal_lines_supplier_invoice_check();

-- Al registrar: las líneas suman el total y coinciden, cuenta a cuenta y
-- centro a centro, con los cargos del asiento; la 4751 recibe la retención.
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
  SELECT "number", "total", "withholding_amount", "entry_id" INTO r
    FROM "supplier_invoices" WHERE "id" = NEW.id;
  IF NOT FOUND OR TG_OP <> 'INSERT' THEN
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

CREATE CONSTRAINT TRIGGER "supplier_invoices_consistency"
  AFTER INSERT OR UPDATE ON "supplier_invoices"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION supplier_invoices_after_write_check();

-- ── Pagos: solo se marcan deshechos, una vez ───────────────────────────
CREATE OR REPLACE FUNCTION supplier_payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los pagos no se borran: deshazlo.'
      USING ERRCODE = 'DM054';
  END IF;
  IF OLD.undone_at IS NOT NULL
     OR NEW.undone_at IS NULL
     OR NEW.undo_entry_id IS NULL
     OR NEW.estate_id <> OLD.estate_id
     OR NEW.supplier_id <> OLD.supplier_id
     OR NEW.date <> OLD.date
     OR NEW.amount <> OLD.amount
     OR NEW.method <> OLD.method
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
     OR NEW.entry_id <> OLD.entry_id
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'Un pago solo cambia para marcarlo como deshecho, una vez.'
      USING ERRCODE = 'DM054';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "supplier_payments_guard"
  BEFORE UPDATE OR DELETE ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION supplier_payments_guard();

-- El importe del pago es lo que su asiento carga a las facturas del proveedor.
CREATE OR REPLACE FUNCTION supplier_payments_after_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p         RECORD;
  v_estate  uuid;
  v_debit   numeric;
  v_foreign int;
BEGIN
  SELECT "estate_id", "supplier_id", "amount", "entry_id" INTO p
    FROM "supplier_payments" WHERE "id" = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT "estate_id" INTO v_estate FROM "journal_entries" WHERE "id" = p.entry_id;
  IF v_estate IS DISTINCT FROM p.estate_id THEN
    RAISE EXCEPTION 'DM055: El pago y su asiento son de fincas distintas.'
      USING ERRCODE = 'DM055';
  END IF;
  SELECT coalesce(sum("debit"), 0),
         count(*) FILTER (WHERE "supplier_id" IS DISTINCT FROM p.supplier_id)
    INTO v_debit, v_foreign
    FROM "journal_lines"
   WHERE "entry_id" = p.entry_id AND "supplier_invoice_id" IS NOT NULL AND "debit" > 0;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'DM055: El pago salda facturas de otro proveedor.'
      USING ERRCODE = 'DM055';
  END IF;
  IF v_debit <> p.amount THEN
    RAISE EXCEPTION 'DM055: El pago de % € no coincide con lo que su asiento salda de las facturas (% €).', p.amount, v_debit
      USING ERRCODE = 'DM055';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "supplier_payments_consistency"
  AFTER INSERT ON "supplier_payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION supplier_payments_after_insert_check();

-- ── F1 ampliada: la purga borra también pagos y facturas ───────────────
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
