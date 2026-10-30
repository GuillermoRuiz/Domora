-- Source: bc64b89aefc64aacb7d1a49d8266e8d719768c3f / 20261003120000_ai_workflows
CREATE FUNCTION ai_check_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;


CREATE TRIGGER ai_policies_tenant BEFORE INSERT OR UPDATE ON ai_policies FOR EACH ROW EXECUTE FUNCTION ai_check_tenant();

CREATE TRIGGER ai_incidents_tenant BEFORE INSERT OR UPDATE ON ai_incidents FOR EACH ROW EXECUTE FUNCTION ai_check_tenant();

CREATE TRIGGER ai_messages_tenant BEFORE INSERT OR UPDATE ON ai_messages FOR EACH ROW EXECUTE FUNCTION ai_check_tenant();

CREATE TRIGGER ai_reconciliation_suggestions_tenant BEFORE INSERT OR UPDATE ON ai_reconciliation_suggestions FOR EACH ROW EXECUTE FUNCTION ai_check_tenant();

CREATE TRIGGER ai_invoice_documents_tenant BEFORE INSERT OR UPDATE ON ai_invoice_documents FOR EACH ROW EXECUTE FUNCTION ai_check_tenant();
