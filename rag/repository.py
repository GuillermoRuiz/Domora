"""Parameterized pgvector repository; query and ingestion connect with different roles."""

import json
import os
from contextlib import contextmanager
from uuid import uuid4
from providers import credential, secret


@contextmanager
def connection(workload):
    import psycopg
    import certifi
    from psycopg.rows import dict_row

    if workload not in ("query", "ingestion"):
        raise ValueError("Unknown workload")
    host = os.getenv("DOMORA_PG_HOST")
    if host:
        # Entra database principals must be provisioned separately on Flexible Server.
        user = os.environ[f"DOMORA_{workload.upper()}_PG_USER"]
        token = (
            credential()
            .get_token("https://ossrdbms-aad.database.windows.net/.default")
            .token
        )
        conn = psycopg.connect(
            host=host,
            dbname=os.environ["DOMORA_PG_DATABASE"],
            user=user,
            password=token,
            sslmode="verify-full",
            connect_timeout=10,
            sslrootcert=os.getenv("DOMORA_PG_SSLROOTCERT", certifi.where()),
            options="-c statement_timeout=30000",
            row_factory=dict_row,
        )
    else:
        url = secret(f"DOMORA_{workload.upper()}_DATABASE_URL")
        if not url:
            raise RuntimeError(f"{workload} database connection not configured")
        secure = (
            {
                "sslmode": "verify-full",
                "sslrootcert": os.getenv("DOMORA_PG_SSLROOTCERT", certifi.where()),
            }
            if os.getenv("DOMORA_ENVIRONMENT") == "production"
            else {}
        )
        conn = psycopg.connect(
            url,
            connect_timeout=10,
            options="-c statement_timeout=30000",
            row_factory=dict_row,
            **secure,
        )
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def json_value(value):
    from psycopg.types.json import Jsonb

    return Jsonb(value)


class QueryRepository:
    def consume_nonce(self, nonce):
        with connection("query") as conn:
            return conn.execute("SELECT rag.consume_nonce(%s) ok", (nonce,)).fetchone()[
                "ok"
            ]

    def search(self, query, embedding, context, count=12):
        if len(embedding) != 512:
            raise ValueError("Embedding dimension mismatch")
        vector = "[" + ",".join(str(float(v)) for v in embedding) + "]"
        with connection("query") as conn:
            rows = conn.execute(
                "SELECT * FROM rag.search_authorized(%s,%s::extensions.vector,%s,%s)",
                (query, vector, json_value(context.scope()), count),
            ).fetchall()
        for row in rows:
            row.update(
                chunk_id=int(row["chunk_id"]),
                document_id=str(row["document_id"]),
                community_id=str(row["community_id"]) if row["community_id"] else None,
                status="indexed",
            )
        return rows

    def visible(self, context):
        with connection("query") as conn:
            return {
                (str(r["document_id"]), r["version"])
                for r in conn.execute(
                    "SELECT * FROM rag.visible_documents(%s)",
                    (json_value(context.scope()),),
                ).fetchall()
            }

    def history(self, context, conversation_id):
        with connection("query") as conn:
            if not conn.execute(
                "SELECT rag.conversation_allowed(%s,%s) ok",
                (json_value(context.scope()), conversation_id),
            ).fetchone()["ok"]:
                raise LookupError("Conversation inaccessible")
            rows = conn.execute(
                "SELECT * FROM rag.history(%s,%s)",
                (json_value(context.scope()), conversation_id),
            ).fetchall()
        return [
            {**r, "created_at": r["created_at"].isoformat()} for r in reversed(rows)
        ]

    def save(
        self, context, conversation, question, answer, sources, finance, provenance=None
    ):
        with connection("query") as conn:
            return conn.execute(
                "SELECT rag.save_messages(%s,%s,%s,%s,%s,%s,%s) ok",
                (
                    json_value(context.scope()),
                    conversation,
                    question,
                    answer,
                    json_value(sources),
                    json_value(provenance if provenance is not None else sources),
                    finance,
                ),
            ).fetchone()["ok"]


class IngestionRepository:
    def consume_nonce(self, nonce):
        with connection("ingestion") as conn:
            return conn.execute("SELECT rag.consume_nonce(%s) ok", (nonce,)).fetchone()[
                "ok"
            ]

    def begin(self, metadata, context):
        """Reserve version under a scoped checksum lock; duplicate attempts do not create chunks."""
        with connection("ingestion") as conn:
            signature = json.dumps(
                [
                    metadata["tenant_id"],
                    metadata["community_id"],
                    metadata["checksum"],
                    metadata["acl"],
                    metadata.get("source_document_id"),
                ],
                sort_keys=True,
            )
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (signature,)
            )
            duplicate = conn.execute(
                """SELECT v.document_id,v.version,v.processing_status FROM rag.versions v
              JOIN rag.documents d USING(document_id) WHERE d.tenant_id IS NOT DISTINCT FROM %s::uuid
              AND d.community_id IS NOT DISTINCT FROM %s::uuid AND d.status<>'deleted'
              AND d.classification=%s AND d.source_document_id IS NOT DISTINCT FROM %s::uuid
              AND v.checksum=%s AND v.acl=%s AND v.processing_status IN ('uploaded','validating','processing','indexed')
              ORDER BY v.version DESC LIMIT 1""",
                (
                    metadata["tenant_id"],
                    metadata["community_id"],
                    metadata["classification"],
                    metadata.get("source_document_id"),
                    metadata["checksum"],
                    json_value(metadata["acl"]),
                ),
            ).fetchone()
            if duplicate and not metadata.get("reprocess", False):
                return str(duplicate["document_id"]), duplicate["version"], True
            doc_id = metadata.get("document_id") or str(uuid4())
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,1))", (doc_id,)
            )
            existing = conn.execute(
                "SELECT * FROM rag.documents WHERE document_id=%s FOR UPDATE", (doc_id,)
            ).fetchone()
            if existing:
                if (
                    (str(existing["tenant_id"]) if existing["tenant_id"] else None)
                    != metadata["tenant_id"]
                    or (
                        str(existing["community_id"])
                        if existing["community_id"]
                        else None
                    )
                    != metadata["community_id"]
                    or (
                        (existing["classification"] == "public")
                        != (metadata["classification"] == "public")
                    )
                    or existing["status"] == "deleted"
                    or (
                        (
                            str(existing["source_document_id"])
                            if existing["source_document_id"]
                            else None
                        )
                        != metadata.get("source_document_id")
                    )
                ):
                    raise PermissionError("Document scope is immutable")
            else:
                conn.execute(
                    """INSERT INTO rag.documents(document_id,tenant_id,community_id,classification,source_document_id)
                  VALUES(%s,%s,%s,%s,%s)""",
                    (
                        doc_id,
                        metadata["tenant_id"],
                        metadata["community_id"],
                        metadata["classification"],
                        metadata.get("source_document_id"),
                    ),
                )
            version = conn.execute(
                "SELECT coalesce(max(version),0)+1 n FROM rag.versions WHERE document_id=%s",
                (doc_id,),
            ).fetchone()["n"]
            conn.execute(
                """INSERT INTO rag.versions(document_id,version,filename,title,doc_type,mime_type,size,checksum,
              acl,classification,uploaded_by,retention_class,retention_until,storage_path,processing_status)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending','uploaded')""",
                (
                    doc_id,
                    version,
                    metadata["filename"],
                    metadata["title"],
                    metadata.get("doc_type", "document"),
                    metadata["mime_type"],
                    metadata["size"],
                    metadata["checksum"],
                    json_value(metadata["acl"]),
                    metadata["classification"],
                    context.user_id,
                    metadata.get("retention_class"),
                    metadata.get("retention_until"),
                ),
            )
            self.audit(conn, "upload", doc_id, version, context)
            return doc_id, version, False

    def state(self, doc_id, version, state, **fields):
        allowed = {"storage_path", "quarantine_path", "processed_path", "failure_code"}
        if fields.keys() - allowed:
            raise ValueError("Invalid state field")
        from psycopg import sql

        assignments = [sql.SQL("processing_status=%s")] + [
            sql.SQL("{}=%s").format(sql.Identifier(k)) for k in fields
        ]
        with connection("ingestion") as conn:
            conn.execute(
                sql.SQL(
                    "UPDATE rag.versions SET {} WHERE document_id=%s AND version=%s AND processing_status<>'indexed'"
                ).format(sql.SQL(",").join(assignments)),
                [state, *fields.values(), doc_id, version],
            )

    def activate(self, doc_id, version, metadata, chunks, embeddings, model, context):
        if (
            not chunks
            or len(chunks) != len(embeddings)
            or any(len(e) != 512 for e in embeddings)
        ):
            raise ValueError("Incomplete embeddings")
        with connection("ingestion") as conn:
            doc = conn.execute(
                "SELECT * FROM rag.documents WHERE document_id=%s FOR UPDATE", (doc_id,)
            ).fetchone()
            candidate = conn.execute(
                "SELECT * FROM rag.versions WHERE document_id=%s AND version=%s FOR UPDATE",
                (doc_id, version),
            ).fetchone()
            if (
                not doc
                or doc["status"] == "deleted"
                or candidate["processing_status"] != "processing"
            ):
                raise ValueError("Version cannot be activated")
            if doc["active_version"] is not None and doc["active_version"] >= version:
                raise ValueError("Newer version already active")
            for chunk, embedding in zip(chunks, embeddings):
                conn.execute(
                    """INSERT INTO rag.chunks(document_id,document_version,tenant_id,community_id,classification,
                  page,section,chunk_index,content,embedding) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::extensions.vector)""",
                    (
                        doc_id,
                        version,
                        doc["tenant_id"],
                        doc["community_id"],
                        candidate["classification"],
                        chunk["page"],
                        chunk.get("section"),
                        chunk["chunk_index"],
                        chunk["content"],
                        "[" + ",".join(str(float(x)) for x in embedding) + "]",
                    ),
                )
            conn.execute(
                "UPDATE rag.versions SET processing_status='indexed',processed_at=now(),embedding_model=%s,embedding_dimensions=512 WHERE document_id=%s AND version=%s",
                (model, doc_id, version),
            )
            conn.execute(
                "UPDATE rag.documents SET active_version=%s,status='indexed',classification=%s WHERE document_id=%s",
                (version, candidate["classification"], doc_id),
            )
            self.audit(conn, "indexing_completed", doc_id, version, context)

    @staticmethod
    def audit(conn, name, doc_id, version, context, detail=None):
        conn.execute(
            "INSERT INTO rag.audit(event,document_id,version,user_id,correlation_id,detail) VALUES(%s,%s,%s,%s,%s,%s)",
            (
                name,
                doc_id,
                version,
                context.user_id,
                context.correlation_id,
                json_value(detail or {}),
            ),
        )

    def delete(self, doc_id, context, storage, purge=False):
        with connection("ingestion") as conn:
            doc = conn.execute(
                "SELECT * FROM rag.documents WHERE document_id=%s FOR UPDATE", (doc_id,)
            ).fetchone()
            if not doc or not self.can_manage(doc, context):
                raise PermissionError("Document not accessible")
            conn.execute(
                "UPDATE rag.documents SET status='deleted',deletion_status='pending',deleted_at=coalesce(deleted_at,now()) WHERE document_id=%s",
                (doc_id,),
            )
            self.audit(conn, "document_deleted", doc_id, None, context)
        # Logical exclusion commits BEFORE physical cleanup. Failed cleanup can be retried.
        if not purge:
            return {"deletion_status": "pending"}
        with connection("ingestion") as conn:
            versions = conn.execute(
                "SELECT *,retention_until>now() retained FROM rag.versions WHERE document_id=%s",
                (doc_id,),
            ).fetchall()
            if any(
                v["retention_class"] is None
                or v["retention_until"] is None
                or v["retained"]
                for v in versions
            ):
                return {"deletion_status": "retention_pending"}
            retention_pending = False
            for v in versions:
                for path in (
                    v["storage_path"],
                    v["processed_path"],
                    v["quarantine_path"],
                ):
                    if path and path != "pending":
                        result = storage.delete(path, doc, v["version"])
                        retention_pending = retention_pending or result.get(
                            "retention_pending", True
                        )
            conn.execute("DELETE FROM rag.chunks WHERE document_id=%s", (doc_id,))
            status = (
                "storage_retention_pending"
                if retention_pending
                else "live_artifacts_deleted"
            )
            conn.execute(
                "UPDATE rag.documents SET deletion_status=%s WHERE document_id=%s",
                (status, doc_id),
            )
            self.audit(conn, status, doc_id, None, context)
        return {
            "deletion_status": status,
            "backups": "PENDING infrastructure retention",
        }

    @staticmethod
    def can_manage(doc, context):
        if "rag:delete" not in context.permissions:
            return False
        if doc["classification"] == "public":
            return (
                "rag:publish:public" in context.permissions
                and context.tenant_id is None
            )
        return (
            str(doc["tenant_id"]) == context.tenant_id
            and str(doc["community_id"]) in context.allowed_community_ids
        )

    def retention(self, doc_id, context, retention_class, retention_until):
        from datetime import datetime

        expiry = datetime.fromisoformat(retention_until.replace("Z", "+00:00"))
        if expiry.tzinfo is None or not retention_class or len(retention_class) > 128:
            raise ValueError("Explicit timezone and retention class required")
        with connection("ingestion") as conn:
            doc = conn.execute(
                "SELECT * FROM rag.documents WHERE document_id=%s FOR UPDATE", (doc_id,)
            ).fetchone()
            if not doc or not self.can_manage(doc, context):
                raise PermissionError("Document not accessible")
            conn.execute(
                "UPDATE rag.versions SET retention_class=%s,retention_until=%s WHERE document_id=%s",
                (retention_class, expiry, doc_id),
            )
            self.audit(
                conn,
                "retention_policy_updated",
                doc_id,
                None,
                context,
                {
                    "retention_class": retention_class,
                    "retention_until": expiry.isoformat(),
                },
            )
        return {
            "document_id": doc_id,
            "retention_class": retention_class,
            "retention_until": expiry.isoformat(),
        }
