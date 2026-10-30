"""Backend-issued, request-bound authorization. No LLM involvement."""

import base64
import hashlib
import hmac
import json
import time
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class AuthorizationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    user_id: str
    tenant_id: str | None
    allowed_community_ids: list[str] = Field(max_length=1)
    allowed_property_ids: list[str] = Field(max_length=30000)
    authorized_document_ids: list[str] = Field(max_length=30000)
    role: str
    permissions: list[str]
    channel: str
    issued_at: int
    nonce: str
    correlation_id: str
    method: str
    path: str
    body_sha256: str

    def scope(self):
        return self.model_dump()


def verify_context(
    token: str,
    key: str,
    method: str,
    path: str,
    body: bytes,
    permission: str,
    now: int | None = None,
) -> AuthorizationContext:
    if not key or len(key) < 32 or not token or len(token) > 1_500_100:
        raise PermissionError("Unauthorized")
    try:
        payload, signature = token.split(".")
        expected = hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        context = AuthorizationContext.model_validate(data)
        for identifier in [
            context.user_id,
            context.nonce,
            context.correlation_id,
            *context.allowed_community_ids,
            *context.allowed_property_ids,
            *context.authorized_document_ids,
        ]:
            UUID(identifier)
        if context.tenant_id is not None:
            UUID(context.tenant_id)
        if context.allowed_community_ids and context.tenant_id is None:
            raise ValueError("tenant")
        age = (now if now is not None else int(time.time())) - context.issued_at
        if not -5 <= age <= 60 or context.method != method or context.path != path:
            raise ValueError("binding")
        if not hmac.compare_digest(
            context.body_sha256, hashlib.sha256(body).hexdigest()
        ):
            raise ValueError("body")
        if context.role not in ("A", "B", "C") or context.channel not in (
            "domo",
            "intelligence",
        ):
            raise ValueError("principal")
        if permission not in context.permissions:
            raise ValueError("permission")
        if permission != "rag:query" and context.role not in ("A", "B"):
            raise ValueError("write")
        return context
    except Exception as exc:
        raise PermissionError("Unauthorized") from exc
