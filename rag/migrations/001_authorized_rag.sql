-- Additive, independently versioned RAG schema. Does not alter/drop legacy corpus.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS rag;
REVOKE ALL ON SCHEMA rag FROM PUBLIC;
CREATE TABLE IF NOT EXISTS rag.documents (
  document_id uuid PRIMARY KEY,
  tenant_id uuid,
  community_id uuid,
  source_document_id uuid,
  classification text NOT NULL CHECK (classification IN ('public','community','restricted')),
  active_version integer,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','indexed','deleted')),
  deletion_status text NOT NULL DEFAULT 'none',
  deleted_at timestamptz,
  CHECK ((classification='public' AND tenant_id IS NULL AND community_id IS NULL AND source_document_id IS NULL)
    OR (classification<>'public' AND tenant_id IS NOT NULL AND community_id IS NOT NULL)),
  UNIQUE (source_document_id)
);
CREATE TABLE IF NOT EXISTS rag.versions (
  document_id uuid NOT NULL REFERENCES rag.documents(document_id),
  version integer NOT NULL CHECK (version > 0),
  filename text NOT NULL, title text NOT NULL, doc_type text NOT NULL DEFAULT 'document',
  mime_type text NOT NULL, size bigint NOT NULL CHECK (size > 0),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  acl jsonb NOT NULL,
  classification text NOT NULL DEFAULT 'community' CHECK(classification IN ('public','community','restricted')),
  uploaded_by uuid NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  retention_class text, retention_until timestamptz,
  storage_path text NOT NULL, processed_path text, quarantine_path text,
  processing_status text NOT NULL CHECK (processing_status IN ('uploaded','validating','processing','indexed','quarantine','failed')),
  embedding_model text, embedding_dimensions integer CHECK (embedding_dimensions=512),
  failure_code text, PRIMARY KEY(document_id, version)
);
CREATE TABLE IF NOT EXISTS rag.chunks (
  chunk_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL, document_version integer NOT NULL,
  tenant_id uuid, community_id uuid, classification text NOT NULL,
  page integer NOT NULL CHECK(page > 0), section text, chunk_index integer NOT NULL CHECK(chunk_index>=0),
  content text NOT NULL CHECK(length(content)>0), embedding extensions.vector(512) NOT NULL,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_id, document_version) REFERENCES rag.versions(document_id, version),
  UNIQUE(document_id, document_version, page, chunk_index)
);
CREATE INDEX IF NOT EXISTS rag_chunks_scope ON rag.chunks(tenant_id, community_id, document_id, document_version);
CREATE INDEX IF NOT EXISTS rag_chunks_fts ON rag.chunks USING gin(fts);
CREATE INDEX IF NOT EXISTS rag_chunks_vector ON rag.chunks USING hnsw(embedding extensions.vector_cosine_ops);
CREATE TABLE IF NOT EXISTS rag.request_nonces (nonce uuid PRIMARY KEY, consumed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rag.conversations (
  conversation_id uuid PRIMARY KEY, user_id uuid NOT NULL, tenant_id uuid, community_id uuid,
  channel text NOT NULL CHECK(channel IN ('domo','intelligence')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rag.messages (
  message_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES rag.conversations(conversation_id),
  role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]', finance_context boolean NOT NULL DEFAULT false,
  provenance jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rag.audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event text NOT NULL,
  document_id uuid, version integer, user_id uuid NOT NULL, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), detail jsonb NOT NULL DEFAULT '{}'
);
-- ACL applies to active version and is independent of relevance/model output.
CREATE OR REPLACE FUNCTION rag.visible_documents(ctx jsonb)
RETURNS TABLE(document_id uuid, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=rag,extensions,pg_temp AS $$
  SELECT d.document_id, v.version FROM rag.documents d
  JOIN rag.versions v ON v.document_id=d.document_id AND v.version=d.active_version
  WHERE d.status='indexed' AND d.deletion_status='none' AND v.processing_status='indexed'
    AND ctx->'permissions' ? 'rag:query'
    AND v.classification=d.classification
    AND ((d.classification='public') OR
      (d.tenant_id::text=ctx->>'tenant_id' AND ctx->'allowed_community_ids' ? d.community_id::text))
    AND (d.source_document_id IS NULL OR ctx->'authorized_document_ids' ? d.source_document_id::text)
    AND ((v.acl->'roles') ? (ctx->>'role') OR (v.acl->'users') ? (ctx->>'user_id')
      OR (v.acl->>'community'='true' AND d.classification IN ('community','public'))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(v.acl->'properties','[]')) p
                 WHERE ctx->'allowed_property_ids' ? p))
$$;
CREATE OR REPLACE FUNCTION rag.search_authorized(query_text text, query_embedding extensions.vector(512), ctx jsonb, match_count integer DEFAULT 12)
RETURNS TABLE(chunk_id bigint, document_id uuid, version integer, title text, filename text,
  doc_type text, community_id uuid, page integer, section text, chunk_index integer,
  content text, semantic_similarity double precision, hybrid_score double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=rag,extensions,pg_temp AS $$
 WITH eligible AS MATERIALIZED (
   SELECT c.*, v.title, v.filename, v.doc_type FROM rag.chunks c
   JOIN rag.visible_documents(ctx) a ON a.document_id=c.document_id AND a.version=c.document_version
   JOIN rag.documents d ON d.document_id=c.document_id
   JOIN rag.versions v ON v.document_id=a.document_id AND v.version=a.version
   WHERE c.tenant_id IS NOT DISTINCT FROM d.tenant_id
     AND c.community_id IS NOT DISTINCT FROM d.community_id AND c.classification=d.classification
 ), semantic AS (
   SELECT chunk_id, row_number() OVER(ORDER BY embedding <=> query_embedding,chunk_id) rank
   FROM eligible ORDER BY embedding <=> query_embedding,chunk_id LIMIT greatest(30,least(match_count,30)*3)
 ), keyword AS (
   SELECT chunk_id, row_number() OVER(ORDER BY ts_rank(fts, plainto_tsquery('simple', query_text)) DESC,chunk_id) rank
   FROM eligible WHERE fts @@ plainto_tsquery('simple',query_text)
   ORDER BY ts_rank(fts,plainto_tsquery('simple',query_text)) DESC,chunk_id LIMIT greatest(30,least(match_count,30)*3)
 ), scores AS (
   SELECT chunk_id,sum(score) score FROM (
     SELECT chunk_id,1.0/(60+rank) score FROM semantic UNION ALL
     SELECT chunk_id,1.0/(60+rank) score FROM keyword
   ) r GROUP BY chunk_id
 ) SELECT e.chunk_id,e.document_id,e.document_version,e.title,e.filename,e.doc_type,e.community_id,
          e.page,e.section,e.chunk_index,e.content,1-(e.embedding <=> query_embedding),s.score::double precision
   FROM eligible e JOIN scores s USING(chunk_id)
   ORDER BY s.score DESC,e.chunk_id LIMIT greatest(1,least(match_count,30))
$$;
CREATE OR REPLACE FUNCTION rag.consume_nonce(value uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=rag,pg_temp AS $$
BEGIN
  DELETE FROM rag.request_nonces WHERE consumed_at < now()-interval '5 minutes';
  INSERT INTO rag.request_nonces(nonce) VALUES(value) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;
-- Conversations are scoped by fresh authorization; private answers require all active sources.
CREATE OR REPLACE FUNCTION rag.conversation_allowed(ctx jsonb, conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=rag,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM rag.conversations c WHERE c.conversation_id=conversation
   AND ctx->'permissions' ? 'rag:query' AND c.user_id::text=ctx->>'user_id' AND c.channel=ctx->>'channel'
   AND c.tenant_id::text IS NOT DISTINCT FROM ctx->>'tenant_id'
   AND c.community_id::text IS NOT DISTINCT FROM (ctx->'allowed_community_ids'->>0))
$$;
CREATE OR REPLACE FUNCTION rag.history(ctx jsonb, conversation uuid)
RETURNS TABLE(role text,content text,citations jsonb,provenance jsonb,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=rag,pg_temp AS $$
 SELECT m.role,m.content,m.citations,m.provenance,m.created_at FROM rag.messages m JOIN rag.conversations c USING(conversation_id)
 WHERE c.conversation_id=conversation AND c.user_id::text=ctx->>'user_id' AND c.channel=ctx->>'channel'
   AND ctx->'permissions' ? 'rag:query'
   AND c.tenant_id::text IS NOT DISTINCT FROM ctx->>'tenant_id'
   AND (c.community_id IS NULL OR ctx->'allowed_community_ids' ? c.community_id::text)
   AND NOT m.finance_context
   AND (m.role='user' OR (jsonb_array_length(m.provenance)>0 AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(m.provenance) source
     WHERE NOT EXISTS(SELECT 1 FROM rag.visible_documents(ctx) v
       WHERE v.document_id::text=source->>'document_id' AND v.version::text=source->>'version'))))
 ORDER BY m.message_id DESC LIMIT 100
$$;
CREATE OR REPLACE FUNCTION rag.save_messages(ctx jsonb, conversation uuid, question text, answer text, sources jsonb, dependencies jsonb, finance boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=rag,pg_temp AS $$
DECLARE existing rag.conversations;
BEGIN
 IF NOT (ctx->'permissions' ? 'rag:query') THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(conversation::text,2));
 SELECT * INTO existing FROM rag.conversations WHERE conversation_id=conversation;
 IF FOUND AND (existing.user_id::text<>ctx->>'user_id' OR existing.channel<>ctx->>'channel'
   OR existing.tenant_id::text IS DISTINCT FROM ctx->>'tenant_id'
   OR existing.community_id::text IS DISTINCT FROM (ctx->'allowed_community_ids'->>0)) THEN RETURN false; END IF;
 INSERT INTO rag.conversations(conversation_id,user_id,tenant_id,community_id,channel)
 VALUES(conversation,(ctx->>'user_id')::uuid,(ctx->>'tenant_id')::uuid,(ctx->'allowed_community_ids'->>0)::uuid,ctx->>'channel')
 ON CONFLICT DO NOTHING;
 INSERT INTO rag.messages(conversation_id,role,content,citations,provenance,finance_context)
 VALUES(conversation,'user',question,'[]','[]',false),(conversation,'assistant',answer,sources,dependencies,finance);
 RETURN true;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA rag FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rag FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA rag FROM PUBLIC;
ALTER TABLE rag.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.request_nonces ENABLE ROW LEVEL SECURITY;
-- Query has no table grants; scoped SECURITY DEFINER functions are the only read interface.
-- Dedicated ingestion has explicit policy and workload grants from migration 002.
DROP POLICY IF EXISTS ingestion_documents ON rag.documents;
DROP POLICY IF EXISTS ingestion_versions ON rag.versions;
DROP POLICY IF EXISTS ingestion_chunks ON rag.chunks;
DROP POLICY IF EXISTS ingestion_audit ON rag.audit;
CREATE POLICY ingestion_documents ON rag.documents FOR ALL USING (pg_has_role(current_user,'domora_rag_ingestion','member')) WITH CHECK (pg_has_role(current_user,'domora_rag_ingestion','member'));
CREATE POLICY ingestion_versions ON rag.versions FOR ALL USING (pg_has_role(current_user,'domora_rag_ingestion','member')) WITH CHECK (pg_has_role(current_user,'domora_rag_ingestion','member'));
CREATE POLICY ingestion_chunks ON rag.chunks FOR ALL USING (pg_has_role(current_user,'domora_rag_ingestion','member')) WITH CHECK (pg_has_role(current_user,'domora_rag_ingestion','member'));
CREATE POLICY ingestion_audit ON rag.audit FOR INSERT WITH CHECK (pg_has_role(current_user,'domora_rag_ingestion','member'));
COMMIT;
