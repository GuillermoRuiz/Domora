-- Restore guards omitted from the canonical AI migration. Expected body copied
-- verbatim from bc64b89aefc64aacb7d1a49d8266e8d719768c3f:
-- backend/prisma/migrations/20261003120000_ai_workflows/migration.sql.
-- Preserve recognized objects; never overwrite an unknown security function
-- or silently accept a different/disabled trigger. No rows change.
BEGIN;

DO $migration$
DECLARE
  expected_body constant text := $body$
DECLARE sid uuid; iid uuid;
BEGIN
 IF TG_TABLE_NAME IN ('ai_policies','ai_incidents','ai_messages') THEN
   sid := (to_jsonb(NEW)->>'supplier_id')::uuid;
   IF sid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id=sid AND "estateId"=NEW.estate_id) THEN
     RAISE EXCEPTION 'AI supplier tenant mismatch' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME IN ('ai_incidents','ai_messages') THEN
   iid := NEW.issue_id;
   IF NOT EXISTS (SELECT 1 FROM issues i JOIN properties p ON p.id=i.property_id WHERE i.id=iid AND p.estate_id=NEW.estate_id) THEN
     RAISE EXCEPTION 'AI issue tenant mismatch' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='ai_incidents' THEN
  IF NEW.canonical_issue_id IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM issues i JOIN properties p ON p.id=i.property_id WHERE i.id=NEW.canonical_issue_id AND p.estate_id=NEW.estate_id) THEN
     RAISE EXCEPTION 'AI canonical tenant mismatch' USING ERRCODE='23514';
   END IF;
 END IF;
 END IF;
 IF TG_TABLE_NAME='ai_reconciliation_suggestions' THEN
   IF NOT EXISTS (SELECT 1 FROM bank_accounts WHERE id=NEW.bank_account_id AND estate_id=NEW.estate_id) OR
      EXISTS (SELECT 1 FROM unnest(NEW.entry_ids) x WHERE NOT EXISTS (SELECT 1 FROM bank_extract_entries b WHERE b.id=x AND b.estate_id=NEW.estate_id AND b.bank_account_id=NEW.bank_account_id)) OR
      EXISTS (SELECT 1 FROM unnest(NEW.line_ids) x WHERE NOT EXISTS (SELECT 1 FROM journal_lines l JOIN bank_accounts b ON b.chart_account_id=l.account_id WHERE l.id=x AND l.estate_id=NEW.estate_id AND b.id=NEW.bank_account_id AND b.estate_id=NEW.estate_id)) OR
      EXISTS (SELECT 1 FROM unnest(NEW.invoice_ids) x WHERE NOT EXISTS (SELECT 1 FROM supplier_invoices WHERE id=x AND estate_id=NEW.estate_id)) THEN
     RAISE EXCEPTION 'AI accounting tenant mismatch' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='ai_invoice_documents' THEN
  IF NEW.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supplier_invoices WHERE id=NEW.invoice_id AND estate_id=NEW.estate_id) THEN
   RAISE EXCEPTION 'AI invoice tenant mismatch' USING ERRCODE='23514';
 END IF;
 END IF;
 RETURN NEW;
END $body$;
  existing_function pg_proc%ROWTYPE;
  existing_trigger pg_trigger%ROWTYPE;
  item record;
BEGIN
  SELECT * INTO existing_function FROM pg_proc
    WHERE oid = to_regprocedure('public.ai_check_tenant()');
  IF existing_function.oid IS NOT NULL THEN
    IF replace(existing_function.prosrc, E'\r\n', E'\n') IS DISTINCT FROM replace(expected_body, E'\r\n', E'\n')
       OR existing_function.prolang <> (SELECT oid FROM pg_language WHERE lanname='plpgsql')
       OR existing_function.prorettype <> 'trigger'::regtype
       OR existing_function.prokind <> 'f'
       OR existing_function.provolatile <> 'v'
       OR existing_function.prosecdef OR existing_function.proleakproof
       OR existing_function.proisstrict OR existing_function.proparallel <> 'u'
       OR existing_function.proconfig IS NOT NULL THEN
      RAISE EXCEPTION 'Unrecognized public.ai_check_tenant(); manual security review required'
        USING HINT='Compare pg_get_functiondef with the published legacy guard; this migration does not replace existing functions.';
    END IF;
  ELSE
    EXECUTE format('CREATE FUNCTION public.ai_check_tenant() RETURNS trigger LANGUAGE plpgsql AS %L', expected_body);
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('ai_policies', 'ai_policies_tenant'),
    ('ai_incidents', 'ai_incidents_tenant'),
    ('ai_messages', 'ai_messages_tenant'),
    ('ai_reconciliation_suggestions', 'ai_reconciliation_suggestions_tenant'),
    ('ai_invoice_documents', 'ai_invoice_documents_tenant')
  ) AS guards(table_name, trigger_name)
  LOOP
    SELECT * INTO existing_trigger FROM pg_trigger
      WHERE tgrelid = format('public.%I', item.table_name)::regclass
        AND tgname = item.trigger_name;
    IF existing_trigger.oid IS NULL THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ai_check_tenant()', item.trigger_name, item.table_name);
    ELSIF existing_trigger.tgfoid <> 'public.ai_check_tenant()'::regprocedure
       OR existing_trigger.tgtype <> 23 -- ROW + BEFORE + INSERT + UPDATE
       OR existing_trigger.tgenabled <> 'O'
       OR existing_trigger.tgisinternal OR existing_trigger.tgconstraint <> 0
       OR existing_trigger.tgqual IS NOT NULL OR existing_trigger.tgnargs <> 0
       OR existing_trigger.tgattr <> ''::int2vector THEN
      RAISE EXCEPTION 'Unrecognized AI tenant trigger %.%; manual security review required', item.table_name, item.trigger_name;
    END IF;
  END LOOP;
END $migration$;

COMMIT;
