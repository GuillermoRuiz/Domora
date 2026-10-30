"""Content-free JSON events consumed by the existing Azure Log Analytics sink."""

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone

logger = logging.getLogger("domora.rag")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.propagate = False
current_context = ContextVar("rag_context", default=None)
_INHERIT_CONTEXT = object()


def event(name, context=_INHERIT_CONTEXT, **fields):
    # Callers must supply only identifiers, counters and durations, never exception text.
    allowed = {
        "document_ids",
        "document_id",
        "version",
        "latency_ms",
        "count",
        "model",
        "provider",
        "error_type",
        "status",
        "tokens",
        "value",
        "workload",
    }
    if fields.keys() - allowed:
        raise ValueError("Unsupported audit field")
    record = {
        "event": name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    if context is _INHERIT_CONTEXT:
        context = current_context.get()
    if context:
        record.update(
            correlation_id=context.correlation_id,
            user_id=context.user_id,
            tenant_id=context.tenant_id,
            community_ids=context.allowed_community_ids,
        )
    logger.info(json.dumps(record, ensure_ascii=False))
