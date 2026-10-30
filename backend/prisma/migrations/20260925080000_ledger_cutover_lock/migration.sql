-- La fecha de corte se lee con FOR SHARE para que un cambio simultáneo de
-- la fecha (AccountingSettingsService.update, que bloquea la fila con FOR
-- UPDATE) no deje entrar un asiento anterior a la nueva fecha.

CREATE OR REPLACE FUNCTION journal_entries_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cutover date;
  v_status  "FiscalYearStatus";
  v_orig    RECORD;
BEGIN
  NEW.created_xid := txid_current();

  -- FOR SHARE: un cambio de la fecha de corte (que bloquea la fila con
  -- FOR UPDATE) espera a este asiento, y este espera al cambio y luego ve
  -- la fecha nueva.
  SELECT "cutover_date" INTO v_cutover
    FROM "accounting_settings" WHERE "estate_id" = NEW.estate_id
    FOR SHARE;
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
