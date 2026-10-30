-- Run as migration owner; no passwords/login credentials created here.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='domora_rag_query') THEN CREATE ROLE domora_rag_query NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='domora_rag_ingestion') THEN CREATE ROLE domora_rag_ingestion NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA rag,extensions TO domora_rag_query,domora_rag_ingestion;
GRANT EXECUTE ON FUNCTION rag.visible_documents(jsonb),
 rag.search_authorized(text,extensions.vector,jsonb,integer),rag.consume_nonce(uuid),rag.history(jsonb,uuid),rag.conversation_allowed(jsonb,uuid),
 rag.save_messages(jsonb,uuid,text,text,jsonb,jsonb,boolean) TO domora_rag_query;
GRANT SELECT,INSERT,UPDATE,DELETE ON rag.documents,rag.versions,rag.chunks TO domora_rag_ingestion;
GRANT INSERT ON rag.audit TO domora_rag_ingestion;
GRANT USAGE,SELECT ON SEQUENCE rag.chunks_chunk_id_seq,rag.audit_audit_id_seq TO domora_rag_ingestion;
GRANT EXECUTE ON FUNCTION rag.consume_nonce(uuid) TO domora_rag_ingestion;
-- Map distinct login/Entra principals to these roles externally; never give query ingestion membership.
