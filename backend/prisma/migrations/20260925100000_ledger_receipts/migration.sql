-- Los recibos, remesas y cuotas de planes de pago que hay en la base de
-- datos son de prueba (el responsable de producto lo confirmó al aprobar
-- el paso a partida doble) y no tienen asiento de emisión: se borran. Los
-- recibos nuevos nacen siempre con su asiento.
DELETE FROM "remesa_lines";
DELETE FROM "remesas";
UPDATE "payment_agreement_installments" SET "receipt_id" = NULL WHERE "receipt_id" IS NOT NULL;
DELETE FROM "receipts";

-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('cuota_ordinaria', 'derrama', 'fondo_reserva', 'saldo_anterior', 'intereses_demora', 'gastos_devolucion', 'otros');

-- CreateEnum
CREATE TYPE "ReserveMode" AS ENUM ('none', 'receipt_share', 'year_end_allocation', 'both');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReceiptStatus" ADD VALUE 'Parcial';
ALTER TYPE "ReceiptStatus" ADD VALUE 'Anulado';

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "default_reserve_mode" "ReserveMode" NOT NULL DEFAULT 'receipt_share',
ADD COLUMN     "default_reserve_share_pct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "fiscal_years" ADD COLUMN     "reserve_mode" "ReserveMode" NOT NULL DEFAULT 'receipt_share',
ADD COLUMN     "reserve_share_pct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "accrual_date" DATE NOT NULL,
ADD COLUMN     "cancel_entry_id" UUID,
ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ,
ADD COLUMN     "cancelled_by_user_id" UUID,
ADD COLUMN     "estate_id" UUID NOT NULL,
ADD COLUMN     "issue_entry_id" UUID,
ADD COLUMN     "origin_year" INTEGER NOT NULL,
ADD COLUMN     "outstanding" DECIMAL(10,2) NOT NULL,
DROP COLUMN "kind",
ADD COLUMN     "kind" "ReceiptKind" NOT NULL;

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "concept" VARCHAR(255),
    "cost_centre_id" UUID,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_sequences" (
    "estate_id" UUID NOT NULL,
    "series" VARCHAR(20) NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("estate_id","series")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_lines_receipt_id_line_no_key" ON "receipt_lines"("receipt_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_issue_entry_id_key" ON "receipts"("issue_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_cancel_entry_id_key" ON "receipts"("cancel_entry_id");

-- CreateIndex
CREATE INDEX "receipts_estate_id_status_idx" ON "receipts"("estate_id", "status");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issue_entry_id_fkey" FOREIGN KEY ("issue_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancel_entry_id_fkey" FOREIGN KEY ("cancel_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
-- Recibos contabilizados (doc/contabilidad/adr-partida-doble.md, fase 4)
--
-- Cada recibo nace con su asiento de emisión (430 contra 7xx/117) y su
-- estado de cobro es una caché de la partida abierta de la 430, que la base
-- de datos verifica al confirmar cada transacción. Códigos DM030–DM036; los
-- de triggers diferidos llevan el código al principio del mensaje.
-- ═══════════════════════════════════════════════════════════════════════

-- ── CHECK ──────────────────────────────────────────────────────────────
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amounts_chk"
  CHECK ("amount" > 0 AND "outstanding" >= 0 AND "outstanding" <= "amount");
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_amount_chk"
  CHECK ("amount" > 0);

-- ── Antes de insertar: finca coherente con el periodo y la propiedad ───
CREATE OR REPLACE FUNCTION receipts_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_period_estate   uuid;
  v_property_estate uuid;
BEGIN
  SELECT "estate_id" INTO v_period_estate FROM "accounting_periods" WHERE "id" = NEW.period_id;
  SELECT "estate_id" INTO v_property_estate FROM "properties" WHERE "id" = NEW.property_id;
  IF v_period_estate IS DISTINCT FROM NEW.estate_id OR v_property_estate IS DISTINCT FROM NEW.estate_id THEN
    RAISE EXCEPTION 'El recibo, su periodo y su propiedad deben ser de la misma finca.'
      USING ERRCODE = 'DM035';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "receipts_before_insert"
  BEFORE INSERT ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION receipts_before_insert();

-- ── Un recibo emitido no se reescribe ni se borra ──────────────────────
-- Cambian solo los datos de gestión: estado de cobro y pendiente (que
-- verifica el trigger diferido), método, devolución, justificante, remesa,
-- titular vivo (supresión RGPD) y los datos de anulación.
CREATE OR REPLACE FUNCTION receipts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los recibos emitidos no se borran: anúlalo.'
      USING ERRCODE = 'DM036';
  END IF;
  IF NEW.estate_id <> OLD.estate_id
     OR NEW.period_id <> OLD.period_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.no <> OLD.no
     OR NEW.kind <> OLD.kind
     OR NEW.amount <> OLD.amount
     OR NEW.concept <> OLD.concept
     OR NEW.accrual_date <> OLD.accrual_date
     OR NEW.origin_year <> OLD.origin_year
     OR (OLD.issue_entry_id IS NOT NULL AND NEW.issue_entry_id IS DISTINCT FROM OLD.issue_entry_id)
     OR (OLD.cancel_entry_id IS NOT NULL AND NEW.cancel_entry_id IS DISTINCT FROM OLD.cancel_entry_id)
     OR (OLD.status = 'Anulado' AND NEW.status <> 'Anulado') THEN
    RAISE EXCEPTION 'Los datos de un recibo emitido no se modifican: anúlalo y emite otro.'
      USING ERRCODE = 'DM032';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "receipts_guard"
  BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION receipts_guard();

-- El desglose de la emisión es tan inmutable como el asiento.
CREATE TRIGGER "receipt_lines_immutable"
  BEFORE UPDATE OR DELETE ON "receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable_guard();
CREATE TRIGGER "receipt_lines_no_truncate"
  BEFORE TRUNCATE ON "receipt_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immutable_guard();

-- ── Partida abierta: estado y pendiente cuadran con la 430 ─────────────
CREATE OR REPLACE FUNCTION receipt_open_item_check(p_receipt_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r      RECORD;
  v_open numeric;
BEGIN
  SELECT "no", "amount", "outstanding", "status", "issue_entry_id" INTO r
    FROM "receipts" WHERE "id" = p_receipt_id;
  IF NOT FOUND THEN
    RETURN; -- borrado en una purga
  END IF;
  IF r.issue_entry_id IS NULL THEN
    RAISE EXCEPTION 'DM033: El recibo % no tiene asiento de emisión.', r.no
      USING ERRCODE = 'DM033';
  END IF;

  SELECT coalesce(sum("debit" - "credit"), 0) INTO v_open
    FROM "journal_lines" WHERE "receipt_id" = p_receipt_id;
  IF v_open < 0 OR v_open > r.amount THEN
    RAISE EXCEPTION 'DM030: El recibo % quedaría con % € pendientes, fuera de 0 y su importe (% €): ¿cobro duplicado?', r.no, v_open, r.amount
      USING ERRCODE = 'DM030';
  END IF;
  IF r.outstanding <> v_open THEN
    RAISE EXCEPTION 'DM031: El pendiente del recibo % (% €) no coincide con su contabilidad (% €).', r.no, r.outstanding, v_open
      USING ERRCODE = 'DM031';
  END IF;
  IF NOT (
       (r.status = 'Anulado'   AND v_open = 0)
    OR (r.status = 'Pagada'    AND v_open = 0)
    OR (r.status = 'Pendiente' AND v_open = r.amount)
    OR (r.status = 'Parcial'   AND v_open > 0 AND v_open < r.amount)
    OR (r.status = 'Devuelto'  AND v_open > 0)
  ) THEN
    RAISE EXCEPTION 'DM031: El estado "%" del recibo % no corresponde a lo que tiene pendiente (% €).', r.status, r.no, v_open
      USING ERRCODE = 'DM031';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION journal_lines_receipt_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM receipt_open_item_check(NEW.receipt_id);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "journal_lines_receipt_open_item"
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.receipt_id IS NOT NULL)
  EXECUTE FUNCTION journal_lines_receipt_check();

-- Al emitir: el desglose suma el importe y coincide, cuenta a cuenta, con
-- los abonos del asiento de emisión. "Saldo anterior" no tiene desglose:
-- su contrapartida es el asiento de apertura.
CREATE OR REPLACE FUNCTION receipts_after_write_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r       RECORD;
  v_count int;
  v_sum   numeric;
BEGIN
  PERFORM receipt_open_item_check(NEW.id);
  -- Un trigger diferido ve NEW tal como era al insertar (sin asiento de
  -- emisión todavía): el estado actual se lee de la tabla.
  SELECT "no", "kind", "amount", "issue_entry_id" INTO r FROM "receipts" WHERE "id" = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' AND r.kind <> 'saldo_anterior' THEN
    SELECT count(*), coalesce(sum("amount"), 0) INTO v_count, v_sum
      FROM "receipt_lines" WHERE "receipt_id" = NEW.id;
    IF v_count = 0 OR v_sum <> r.amount THEN
      RAISE EXCEPTION 'DM034: El desglose del recibo % (% €) no suma su importe (% €).', r.no, v_sum, r.amount
        USING ERRCODE = 'DM034';
    END IF;
    IF EXISTS (
      (SELECT "account_id", "amount" FROM "receipt_lines" WHERE "receipt_id" = NEW.id
       EXCEPT ALL
       SELECT "account_id", "credit" FROM "journal_lines"
        WHERE "entry_id" = r.issue_entry_id AND "credit" > 0)
      UNION ALL
      (SELECT "account_id", "credit" FROM "journal_lines"
        WHERE "entry_id" = r.issue_entry_id AND "credit" > 0
       EXCEPT ALL
       SELECT "account_id", "amount" FROM "receipt_lines" WHERE "receipt_id" = NEW.id)
    ) THEN
      RAISE EXCEPTION 'DM034: El asiento de emisión del recibo % no coincide con su desglose.', r.no
        USING ERRCODE = 'DM034';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "receipts_consistency"
  AFTER INSERT OR UPDATE ON "receipts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION receipts_after_write_check();

-- ── El ejercicio nuevo hereda la configuración del fondo de reserva ────
-- (JournalService.ensureFiscalYear lo crea copiando de accounting_settings.)

-- ── F1 ampliada: la purga borra también recibos y su desglose ──────────
-- Quien la llame debe haber borrado antes las líneas de remesa.
CREATE OR REPLACE FUNCTION accounting_purge_estate(p_estate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('domora.journal_purge', 'on', true);
  DELETE FROM "journal_lines" WHERE "estate_id" = p_estate_id;
  DELETE FROM "receipt_lines" WHERE "receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id);
  UPDATE "payment_agreement_installments" SET "receipt_id" = NULL
   WHERE "receipt_id" IN (SELECT "id" FROM "receipts" WHERE "estate_id" = p_estate_id);
  DELETE FROM "receipts" WHERE "estate_id" = p_estate_id;
  DELETE FROM "receipt_sequences" WHERE "estate_id" = p_estate_id;
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
