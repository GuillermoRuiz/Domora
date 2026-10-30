-- AlterTable
ALTER TABLE "collections" ADD COLUMN     "suspense_item_id" UUID;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_suspense_item_id_fkey" FOREIGN KEY ("suspense_item_id") REFERENCES "suspense_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La aplicación de un ingreso sin identificar es un cobro más (con su
-- asiento 555 contra 430). El guard de cobros ya impide cambiar este campo:
-- se redefine para incluirlo.
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
     OR NEW.suspense_item_id IS DISTINCT FROM OLD.suspense_item_id
     OR NEW.undone_at IS NULL
     OR NEW.undo_entry_id IS NULL THEN
    RAISE EXCEPTION 'Un cobro registrado solo se puede deshacer, no modificar.'
      USING ERRCODE = 'DM040';
  END IF;
  RETURN NEW;
END
$$;
