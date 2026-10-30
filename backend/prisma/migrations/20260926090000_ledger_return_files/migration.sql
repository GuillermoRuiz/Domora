-- CreateEnum
CREATE TYPE "ReturnFileFormat" AS ENUM ('pain002', 'camt054');

-- CreateEnum
CREATE TYPE "ReturnFileItemStatus" AS ENUM ('matched', 'unmatched', 'applied', 'already_returned', 'failed');

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "return_fee_recharge" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "return_files" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "format" "ReturnFileFormat" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "message_id" VARCHAR(35),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_applied_at" TIMESTAMPTZ,

    CONSTRAINT "return_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_file_items" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "end_to_end_id" VARCHAR(35),
    "original_message_id" VARCHAR(35),
    "amount" DECIMAL(10,2),
    "date" DATE,
    "return_code" VARCHAR(10),
    "return_reason" VARCHAR(150),
    "fee_amount" DECIMAL(10,2),
    "status" "ReturnFileItemStatus" NOT NULL,
    "remesa_line_id" UUID,
    "error" VARCHAR(255),
    "applied_at" TIMESTAMPTZ,

    CONSTRAINT "return_file_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_files_estate_id_created_at_idx" ON "return_files"("estate_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "return_files_estate_id_file_hash_key" ON "return_files"("estate_id", "file_hash");

-- CreateIndex
CREATE INDEX "return_file_items_remesa_line_id_idx" ON "return_file_items"("remesa_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_file_items_file_id_seq_key" ON "return_file_items"("file_id", "seq");

-- AddForeignKey
ALTER TABLE "return_files" ADD CONSTRAINT "return_files_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_file_items" ADD CONSTRAINT "return_file_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "return_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_file_items" ADD CONSTRAINT "return_file_items_remesa_line_id_fkey" FOREIGN KEY ("remesa_line_id") REFERENCES "remesa_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Garantías (fase 6) ──────────────────────────────────────────────────
ALTER TABLE "return_file_items"
  ADD CONSTRAINT "return_file_items_amount_chk" CHECK ("amount" IS NULL OR "amount" > 0),
  ADD CONSTRAINT "return_file_items_fee_chk" CHECK ("fee_amount" IS NULL OR "fee_amount" >= 0),
  ADD CONSTRAINT "return_file_items_applied_chk" CHECK (("status" = 'applied') = ("applied_at" IS NOT NULL));

-- Una partida aplicada ya está contabilizada: no vuelve a otro estado ni
-- cambia su fecha de aplicación. (El purgado pone a NULL remesa_line_id,
-- que sí se permite.)
CREATE OR REPLACE FUNCTION return_file_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'applied'
     AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."applied_at" IS DISTINCT FROM OLD."applied_at") THEN
    RAISE EXCEPTION 'DM042: Esta devolución del fichero ya está contabilizada.'
      USING ERRCODE = 'DM042';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "return_file_items_guard"
  BEFORE UPDATE ON "return_file_items"
  FOR EACH ROW EXECUTE FUNCTION return_file_items_guard();
