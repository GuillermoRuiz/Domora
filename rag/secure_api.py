"""Private HTTP boundary. Query process has no storage or ingestion credentials."""

import asyncio
import base64
import os
import re
import time
from uuid import UUID, uuid4
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from security import verify_context
from providers import get_provider, secret
from repository import QueryRepository, IngestionRepository
from telemetry import event


class Ask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=5000)
    community_id: str | None = None
    user_id: str | None = None
    conversation_id: str | None = None
    community_finance: str | None = Field(default=None, max_length=20000)


class AuthorizationEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authorization: str = Field(max_length=1_500_100)
    payload: str = Field(max_length=14_500_000)


class Upload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    source_document_id: str | None = None
    filename: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    doc_type: str = Field(default="document", max_length=100)
    mime_type: str
    classification: str
    acl: dict
    content_base64: str = Field(max_length=14_000_000)
    reprocess: bool = False
    retention_class: str | None = None
    retention_until: str | None = None


def answer(query, repo, client, ctx):
    import domora_rag as core
    from telemetry import current_context
    from minimization import minimize_text

    current_context.set(ctx)
    query = query.model_copy(
        update={
            "question": minimize_text(query.question),
            "community_finance": (
                minimize_text(query.community_finance)
                if query.community_finance
                else None
            ),
        }
    )
    started = time.monotonic()
    history = repo.history(ctx, query.conversation_id) if query.conversation_id else []
    embedding = core.embed_query(client, query.question)
    rows = repo.search(query.question, embedding, ctx, core.SEARCH_MATCH_COUNT)
    for row in rows:
        for key in ("content", "title", "filename", "section", "doc_type"):
            if isinstance(row.get(key), str):
                row[key] = minimize_text(row[key])
    event(
        "rag.retrieval",
        ctx,
        latency_ms=round((time.monotonic() - started) * 1000),
        document_ids=list(dict.fromkeys(r["document_id"] for r in rows)),
        count=len(rows),
    )
    reranked = core.rerank_results(client, query.question, rows) if rows else []
    for row in reranked:
        row["article_candidates"] = core.article_headings(
            (row.get("section") or "") + "\n" + row["content"]
        )
    context, citations = core.build_context(reranked)
    if (
        rows
        and max(float(r.get("semantic_similarity") or 0) for r in rows)
        < core.OFF_TOPIC_MIN_SIMILARITY
        and not query.community_finance
    ):
        final = {"answer": core.OFF_TOPIC_MESSAGE, "source_articles": {}}
    elif not rows and not query.community_finance:
        final = {
            "answer": "No encuentro documentos autorizados que permitan responder a esa consulta.",
            "source_articles": {},
        }
    else:
        final = core.generate_answer(
            client,
            query.question,
            context,
            history[-core.HISTORY_MESSAGES :],
            query.community_finance,
        )
    final_answer = str(final.get("answer") or "")
    if final.get("on_topic") is False:
        final_answer = core.OFF_TOPIC_MESSAGE
    cited_ids = set(re.findall(r"\[(S\d+)\]", final_answer))
    used_finance = bool(query.community_finance) and "[CUENTAS]" in final_answer
    citations = [c for c in citations if c["source_id"] in cited_ids]
    core.apply_article_citations(citations, final.get("source_articles"))
    final_answer = core.strip_source_markers(final_answer)
    footer = core.format_sources(citations, include_finance=used_finance)
    if footer:
        final_answer += "\n\n" + footer
    # Recheck deletion/ACL/version changes before persisting or returning any generated content.
    dependencies = {(r["document_id"], r["version"]) for r in rows}
    dependencies.update(
        (source["document_id"], source["version"])
        for message in history
        for source in message.get("provenance", [])
    )
    if not dependencies.issubset(repo.visible(ctx)):
        raise PermissionError("Sources changed during query")
    conversation = query.conversation_id or str(uuid4())
    provenance = [
        {"document_id": doc, "version": version}
        for doc, version in sorted(dependencies)
    ]
    if not repo.save(
        ctx,
        conversation,
        query.question,
        final_answer,
        citations,
        bool(query.community_finance),
        provenance,
    ):
        raise LookupError("Conversation inaccessible")
    event(
        "rag.queries",
        ctx,
        count=1,
        latency_ms=round((time.monotonic() - started) * 1000),
    )
    return {
        "answer": final_answer,
        "citations": citations,
        "sources": citations,
        "conversation_id": conversation,
        "evidence_status": "sufficient" if citations or used_finance else "weak",
        "correlation_id": ctx.correlation_id,
    }


def create_app(
    query_repository=None,
    provider=None,
    ingestion_repository=None,
    storage=None,
    scanner=None,
):
    key = secret("DOMORA_RAG_INTERNAL_KEY")
    if not key or len(key) < 32:
        raise RuntimeError(
            "DOMORA_RAG_INTERNAL_KEY must contain at least 32 characters"
        )
    workload = os.getenv("DOMORA_RAG_WORKLOAD", "query")
    if workload not in ("query", "ingestion"):
        raise RuntimeError("Invalid RAG workload")
    if int(os.getenv("DOMORA_EMBED_DIMENSIONS", "512")) != 512:
        raise RuntimeError("RAG schema requires 512 embedding dimensions")
    if provider is None and workload == "query" and not os.getenv("DOMORA_CHAT_MODEL"):
        raise RuntimeError("DOMORA_CHAT_MODEL must be explicitly configured")
    app = FastAPI(
        title="Domora private RAG",
        version="3.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    repo = (
        (query_repository or QueryRepository())
        if workload == "query"
        else (ingestion_repository or IngestionRepository())
    )

    async def authorize(request, permission, limit=2_000_000):
        body = bytearray()
        async for part in request.stream():
            if len(body) + len(part) > limit:
                raise HTTPException(413, "Request too large")
            body.extend(part)
        try:
            token = request.headers.get("X-Domora-Authorization", "")
            decoded = bytes(body)
            # Header format remains compatible for small internal clients/tests. Never merge scopes.
            import json

            parsed = json.loads(decoded) if decoded else {}
            if isinstance(parsed, dict) and "authorization" in parsed:
                if token:
                    raise PermissionError("Ambiguous authorization transport")
                envelope = AuthorizationEnvelope.model_validate(parsed)
                token = envelope.authorization
                decoded = envelope.payload.encode("utf-8")
            path = request.url.path
            if request.scope.get("query_string"):
                path += "?" + request.scope["query_string"].decode("ascii")
            ctx = verify_context(token, key, request.method, path, decoded, permission)
            if not await asyncio.to_thread(repo.consume_nonce, ctx.nonce):
                raise PermissionError("Replay")
            request.state.authorization_context = ctx
            event("rag.authorization.allowed", ctx, workload=workload)
            return ctx, decoded
        except (PermissionError, ValueError):
            event("rag.authorization.denied", None, count=1, workload=workload)
            raise HTTPException(403, "Unauthorized") from None

    @app.exception_handler(Exception)
    async def failure(request, exc):
        from fastapi.responses import JSONResponse

        ctx = getattr(request.state, "authorization_context", None)
        event("rag.errors", ctx, error_type=type(exc).__name__, workload=workload)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "RAG operation unavailable",
                "correlation_id": ctx.correlation_id if ctx else None,
            },
        )

    @app.get("/health")
    def health():
        return {"status": "ok", "workload": workload}

    if workload == "query":

        @app.post("/ask")
        async def ask(request: Request):
            ctx, body = await authorize(request, "rag:query")
            try:
                query = Ask.model_validate_json(body)
                if query.conversation_id:
                    UUID(query.conversation_id)
            except ValueError:
                raise HTTPException(422, "Invalid request") from None
            if (
                (
                    query.community_id
                    and query.community_id not in ctx.allowed_community_ids
                )
                or (query.user_id and query.user_id != f"{ctx.user_id}:{ctx.channel}")
                or (query.community_finance and not ctx.allowed_community_ids)
            ):
                raise HTTPException(403, "Scope mismatch")
            client = (provider or get_provider()).client()
            try:
                return await asyncio.to_thread(answer, query, repo, client, ctx)
            except PermissionError:
                raise HTTPException(403, "Sources no longer authorized") from None
            except LookupError:
                raise HTTPException(404, "Conversation not found") from None

        @app.get("/conversations/{conversation_id}/messages")
        @app.post("/conversations/{conversation_id}/messages")
        async def messages(conversation_id: str, request: Request):
            ctx, _ = await authorize(request, "rag:query")
            try:
                UUID(conversation_id)
            except ValueError:
                raise HTTPException(404, "Conversation not found") from None
            try:
                history = await asyncio.to_thread(repo.history, ctx, conversation_id)
            except LookupError:
                raise HTTPException(404, "Conversation not found") from None
            return {
                "messages": [
                    {k: v for k, v in row.items() if k != "provenance"}
                    for row in history
                ]
            }

    else:

        @app.post("/documents")
        async def ingest(request: Request):
            ctx, body = await authorize(request, "rag:ingest", 16_000_000)
            try:
                upload = Upload.model_validate_json(body)
                UUID(upload.document_id)
                if upload.source_document_id:
                    UUID(upload.source_document_id)
                data = base64.b64decode(upload.content_base64, validate=True)
                if upload.classification not in ("community", "restricted"):
                    raise ValueError("classification")
                acl = upload.acl
                if set(acl) != {
                    "community",
                    "roles",
                    "users",
                    "properties",
                } or not isinstance(acl["community"], bool):
                    raise ValueError("ACL")
                if (
                    acl["roles"] != ["A", "B"]
                    or acl["users"] != []
                    or len(acl["properties"]) > 1
                ):
                    raise ValueError("ACL")
                for identifier in acl["properties"]:
                    UUID(identifier)
                if upload.classification == "restricted" and (
                    acl["community"] or not acl["properties"]
                ):
                    raise ValueError("ACL")
                if upload.classification == "community" and (
                    not acl["community"] or acl["properties"]
                ):
                    raise ValueError("ACL")
                metadata = {
                    **upload.model_dump(exclude={"content_base64"}),
                    "tenant_id": ctx.tenant_id,
                    "community_id": ctx.allowed_community_ids[0],
                }
            except (ValueError, IndexError, TypeError):
                raise HTTPException(422, "Invalid upload") from None
            from ingestion import IngestionPipeline
            from storage import get_storage
            import domora_rag as core

            client = (provider or get_provider()).client()
            pipeline = IngestionPipeline(
                repo,
                storage or get_storage(),
                lambda texts: core.embed_chunks(client, texts),
                core.EMBED_MODEL,
                scanner=scanner,
            )
            return await asyncio.to_thread(pipeline.ingest, data, metadata, ctx)

        @app.delete("/documents/{document_id}")
        async def delete(document_id: str, request: Request):
            ctx, _ = await authorize(request, "rag:delete")
            try:
                UUID(document_id)
            except ValueError:
                raise HTTPException(404, "Document not found") from None
            from storage import get_storage

            try:
                return await asyncio.to_thread(
                    repo.delete, document_id, ctx, storage or get_storage(), False
                )
            except PermissionError:
                raise HTTPException(404, "Document not found") from None

    return app
