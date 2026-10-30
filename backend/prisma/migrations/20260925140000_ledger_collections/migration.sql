-- CreateEnum
CREATE TYPE "ReturnSource" AS ENUM ('manual', 'pain002', 'camt054', 'n19');

-- AlterEnum
ALTER TYPE "RemesaLineStatus" ADD VALUE 'Rechazado';

-- AlterEnum
ALTER TYPE "RemesaStatus" ADD VALUE 'Anulada';

-- AlterTable
ALTER TABLE "payment_agreement_installments" ADD COLUMN     "collection_id" UUID;

-- AlterTable
ALTER TABLE "remesa_lines" ADD COLUMN     "end_to_end_id" VARCHAR(35);

-- AlterTable
ALTER TABLE "remesas" ADD COLUMN     "bank_account_id" UUID,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ,
ADD COLUMN     "collected_at" DATE,
ADD COLUMN     "collected_by_user_id" UUID,
ADD COLUMN     "collection_entry_id" UUID,
ADD COLUMN     "message_id" VARCHAR(35);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PayMethod" NOT NULL,
    "bank_account_id" UUID,
    "entry_id" UUID NOT NULL,
    "remesa_line_id" UUID,
    "notes" VARCHAR(255),
    "undone_at" TIMESTAMPTZ,
    "undone_by_user_id" UUID,
    "undo_reason" VARCHAR(255),
    "undo_entry_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_returns" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "remesa_line_id" UUID,
    "date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "return_code" VARCHAR(10),
    "return_reason" VARCHAR(150),
    "fee_amount" DECIMAL(10,2),
    "fee_recharged_receipt_id" UUID,
    "entry_id" UUID NOT NULL,
    "source" "ReturnSource" NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suspense_items" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "concept" VARCHAR(255) NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suspense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_agreement_receipts" (
    "agreement_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,

    CONSTRAINT "payment_agreement_receipts_pkey" PRIMARY KEY ("agreement_id","receipt_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collections_remesa_line_id_key" ON "collections"("remesa_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "collections_undo_entry_id_key" ON "collections"("undo_entry_id");

-- CreateIndex
CREATE INDEX "collections_estate_id_date_idx" ON "collections"("estate_id", "date");

-- CreateIndex
CREATE INDEX "collections_property_id_idx" ON "collections"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_returns_collection_id_key" ON "receipt_returns"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_returns_fee_recharged_receipt_id_key" ON "receipt_returns"("fee_recharged_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_returns_entry_id_key" ON "receipt_returns"("entry_id");

-- CreateIndex
CREATE INDEX "receipt_returns_estate_id_date_idx" ON "receipt_returns"("estate_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "suspense_items_entry_id_key" ON "suspense_items"("entry_id");

-- CreateIndex
CREATE INDEX "suspense_items_estate_id_date_idx" ON "suspense_items"("estate_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_agreement_installments_collection_id_key" ON "payment_agreement_installments"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "remesa_lines_end_to_end_id_key" ON "remesa_lines"("end_to_end_id");

-- CreateIndex
CREATE UNIQUE INDEX "remesas_message_id_key" ON "remesas"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "remesas_collection_entry_id_key" ON "remesas"("collection_entry_id");

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_undo_entry_id_fkey" FOREIGN KEY ("undo_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_remesa_line_id_fkey" FOREIGN KEY ("remesa_line_id") REFERENCES "remesa_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_returns" ADD CONSTRAINT "receipt_returns_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_returns" ADD CONSTRAINT "receipt_returns_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_returns" ADD CONSTRAINT "receipt_returns_remesa_line_id_fkey" FOREIGN KEY ("remesa_line_id") REFERENCES "remesa_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_returns" ADD CONSTRAINT "receipt_returns_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspense_items" ADD CONSTRAINT "suspense_items_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspense_items" ADD CONSTRAINT "suspense_items_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspense_items" ADD CONSTRAINT "suspense_items_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreement_receipts" ADD CONSTRAINT "payment_agreement_receipts_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "payment_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreement_receipts" ADD CONSTRAINT "payment_agreement_receipts_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesas" ADD CONSTRAINT "remesas_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesas" ADD CONSTRAINT "remesas_collection_entry_id_fkey" FOREIGN KEY ("collection_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreement_installments" ADD CONSTRAINT "payment_agreement_installments_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
-- Cobros, devoluciones e ingresos sin identificar (fase 5)
--
-- Los tres son documentos con asiento: no se editan ni se borran. Un cobro
-- solo cambia para registrar que se deshizo (con su contraasiento).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "collections" ADD CONSTRAINT "collections_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "receipt_returns" ADD CONSTRAINT "receipt_returns_amount_chk"
  CHECK ("amount" > 0 AND ("fee_amount" IS NULL OR "fee_amount" >= 0));
ALTER TABLE "suspense_items" ADD CONSTRAINT "suspense_items_amount_chk" CHECK ("amount" > 0);

-- Un cobro solo cambia una vez: para marcarlo deshecho.
CREATE OR REPLACE FUNCTION collections_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF domora_journal_purge_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los cobros no se borran: deshazlo (queda un contraasiento).'
      USING ERRCODE = 'DM040';
  END IF;
  IF OLD.undone_at IS NOT NULL
     OR NEW.estate_id <> OLD.estate_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.date <> OLD.date
     OR NEW.amount <> OLD.amount
     OR NEW.method <> OLD.method
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
     OR NEW.entry_id <> OLD.entry_id
     OR NEW.remesa_line_id IS DISTINCT FROM OLD.remesa_line_id
     OR NEW.undone_at IS NULL
     OR NEW.undo_entry_id IS NULL THEN
    RAISE EXCEPTION 'Un cobro registrado solo se puede deshacer, no modificar.'
      USING ERRCODE = 'DM040';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "collections_guard"
  BEFORE UPDATE OR DELETE ON "collections"
  FOR EACH ROW EXECUTE FUNCTION collections_guard();

CREATE TRIGGER "receipt_returns_immutable"
  BEFORE UPDATE OR DELETE ON "receipt_returns"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable_guard();
CREATE TRIGGER "suspense_items_immutable"
  BEFORE UPDATE OR DELETE ON "suspense_items"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable_guard();

-- Coherencia del cobro con su asiento: misma finca, y el importe del cobro
-- es lo que su asiento abona a la 430 de esa propiedad (imputaciones +
-- anticipo). Diferido: el cobro se crea después de su asiento.
CREATE OR REPLACE FUNCTION collections_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c        RECORD;
  v_estate uuid;
  v_credit numeric;
BEGIN
  SELECT "estate_id", "property_id", "amount", "entry_id", "remesa_line_id" INTO c
    FROM "collections" WHERE "id" = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT "estate_id" INTO v_estate FROM "journal_entries" WHERE "id" = c.entry_id;
  IF v_estate IS DISTINCT FROM c.estate_id THEN
    RAISE EXCEPTION 'DM041: El cobro y su asiento son de fincas distintas.'
      USING ERRCODE = 'DM041';
  END IF;
  -- En una remesa el asiento es común a todas las líneas: se comprueba la
  -- parte de este recibo; en un cobro manual, todo lo abonado a la 430 de
  -- la propiedad.
  IF c.remesa_line_id IS NOT NULL THEN
    SELECT coalesce(sum(jl."credit"), 0) INTO v_credit
      FROM "journal_lines" jl
      JOIN "remesa_lines" rl ON rl."id" = c.remesa_line_id
     WHERE jl."entry_id" = c.entry_id AND jl."receipt_id" = rl."receipt_id";
  ELSE
    SELECT coalesce(sum(jl."credit"), 0) INTO v_credit
      FROM "journal_lines" jl
      JOIN "chart_accounts" a ON a."id" = jl."account_id"
     WHERE jl."entry_id" = c.entry_id AND jl."property_id" = c.property_id
       AND a."system_role" = 'owners_receivable';
  END IF;
  IF v_credit <> c.amount THEN
    RAISE EXCEPTION 'DM041: El cobro de % € no coincide con lo abonado a la 430 en su asiento (% €).', c.amount, v_credit
      USING ERRCODE = 'DM041';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "collections_consistency"
  AFTER INSERT ON "collections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION collections_check();

-- ── F1 ampliada: cobros, devoluciones, remesas e ingresos sin identificar ─
-- Quien la llame debe haber borrado antes los planes de pago (sus cuotas
-- citan cobros) y el libro de caja heredado.
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
