-- Las incidencias son SIEMPRE de la comunidad: `issues.estate_id` es la referencia canónica y obligatoria de finca.
-- Parte del estado de `main` (20261028120000_owner_issues_unify_tickets), donde `issues` aún cuelga de una propiedad
-- (`property_id`), tiene un ámbito (`scope`, `IssueScope`) y un autor (`reporter_user_id`):
--  1. `estate_id` se rellena con la finca de la propiedad de cada incidencia.
--  2. `reporter_user_id` pasa a `issue_reports` (la fuente de quién avisó; una incidencia puede tener varios avisos).
--  3. `property_id`, `scope` y `reporter_user_id` desaparecen, junto con sus FK/índices y el tipo `IssueScope`.
--  4. `estate_id` pasa a ser obligatorio y se le da FK e índice.
-- Los datos actuales son de prueba: no se conserva la propiedad ni el ámbito antiguos, y una base que no pueda migrarse
-- (p. ej. una incidencia de una propiedad sin finca) se resetea.

ALTER TABLE "issues" ADD COLUMN "estate_id" UUID;
UPDATE "issues" i SET "estate_id" = p."estate_id" FROM "properties" p WHERE p."id" = i."property_id";

-- Quien avisó queda en `issue_reports`: se completa el aviso inicial si no tiene autor y, si no hay ninguno suyo, se crea.
UPDATE "issue_reports" r SET "reporter_user_id" = i."reporter_user_id"
  FROM "issues" i
  WHERE r."issue_id" = i."id" AND i."reporter_user_id" IS NOT NULL AND r."reporter_user_id" IS NULL
    AND r."id" = (SELECT f."id" FROM "issue_reports" f WHERE f."issue_id" = i."id" ORDER BY f."received_at", f."created_at" LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM "issue_reports" x WHERE x."issue_id" = i."id" AND x."reporter_user_id" = i."reporter_user_id");
INSERT INTO "issue_reports" ("id", "issue_id", "channel", "content", "reporter_user_id", "received_at", "created_by_kind", "created_by_user_id")
  SELECT gen_random_uuid(), i."id", 'form', i."description", i."reporter_user_id", i."created_at", 'person', i."reporter_user_id"
  FROM "issues" i
  WHERE i."reporter_user_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "issue_reports" x WHERE x."issue_id" = i."id" AND x."reporter_user_id" = i."reporter_user_id");

ALTER TABLE "issues" ALTER COLUMN "estate_id" SET NOT NULL;
ALTER TABLE "issues" ADD CONSTRAINT "issues_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "issues_estate_id_status_idx" ON "issues"("estate_id", "status");

-- Al borrar las columnas caen también sus FK e índices.
ALTER TABLE "issues" DROP COLUMN "property_id";
ALTER TABLE "issues" DROP COLUMN "scope";
ALTER TABLE "issues" DROP COLUMN "reporter_user_id";
DROP TYPE "IssueScope";

-- Guarda de inquilino de la IA: la finca de la incidencia es `issues.estate_id`.
DO $migration$
DECLARE
  old_body constant text := $body$
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
  new_body constant text := $body$
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
   IF NOT EXISTS (SELECT 1 FROM issues i WHERE i.id=iid AND i.estate_id=NEW.estate_id) THEN
     RAISE EXCEPTION 'AI issue tenant mismatch' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='ai_incidents' THEN
  IF NEW.canonical_issue_id IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM issues i WHERE i.id=NEW.canonical_issue_id AND i.estate_id=NEW.estate_id) THEN
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
BEGIN
  SELECT * INTO existing_function FROM pg_proc
    WHERE oid = to_regprocedure('public.ai_check_tenant()');
  IF existing_function.oid IS NULL THEN
    RAISE EXCEPTION 'Missing public.ai_check_tenant(); apply 20261015190000_restore_ai_tenant_guards first';
  END IF;
  IF existing_function.prolang <> (SELECT oid FROM pg_language WHERE lanname='plpgsql')
     OR existing_function.prorettype <> 'trigger'::regtype
     OR existing_function.prokind <> 'f'
     OR existing_function.provolatile <> 'v'
     OR existing_function.prosecdef OR existing_function.proleakproof
     OR existing_function.proisstrict OR existing_function.proparallel <> 'u'
     OR existing_function.proconfig IS NOT NULL
     OR replace(existing_function.prosrc, E'\r\n', E'\n') NOT IN (replace(old_body, E'\r\n', E'\n'), replace(new_body, E'\r\n', E'\n')) THEN
    RAISE EXCEPTION 'Unrecognized public.ai_check_tenant(); manual security review required'
      USING HINT='Compare pg_get_functiondef with the published guard; this migration only replaces the known body.';
  END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.ai_check_tenant() RETURNS trigger LANGUAGE plpgsql AS %L', new_body);
END $migration$;
