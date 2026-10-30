-- Los triggers diferidos saltan al confirmar la transacción, y en ese punto
-- Prisma entrega el error sin el SQLSTATE (solo "ERROR: <mensaje>"). Para
-- que el backend pueda identificarlo, estos mensajes llevan el código al
-- principio ("DM002: ..."); journal-db-errors.ts lo quita antes de mostrarlo.
-- Todo trigger DIFERIDO que se añada después debe seguir esta convención.

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
    RAISE EXCEPTION 'DM001: El asiento % necesita al menos dos líneas.', NEW.number
      USING ERRCODE = 'DM001';
  END IF;
  IF v_debit <> v_credit OR v_debit = 0 THEN
    RAISE EXCEPTION 'DM002: El asiento % no cuadra: debe % y haber %.', NEW.number, v_debit, v_credit
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
    RAISE EXCEPTION 'DM017: El contraasiento % no es el espejo exacto del asiento que revierte.', NEW.number
      USING ERRCODE = 'DM017';
  END IF;

  RETURN NULL;
END
$$;
