"""Operator migration/reprocessing/deletion tool. Dry-run by default; never deletes legacy data."""

import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path
from uuid import UUID, uuid4
from security import AuthorizationContext


def read_manifest(path, root, validate_files=True):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or data.get("reviewed") is not True:
        raise ValueError(
            "Manifest must have schema_version=1 and explicit reviewed=true"
        )
    rows = []
    seen = set()
    for row in data["documents"]:
        for key in ("document_id", "uploaded_by"):
            UUID(row[key])
        if row["document_id"] in seen:
            raise ValueError("Repeated document_id in one migration batch")
        seen.add(row["document_id"])
        if row["classification"] == "public":
            if row["tenant_id"] is not None or row["community_id"] is not None:
                raise ValueError("Public scope must be null")
        else:
            UUID(row["tenant_id"])
            UUID(row["community_id"])
        if row["classification"] not in ("public", "community", "restricted"):
            raise ValueError("Invalid classification")
        if row.get("source_document_id"):
            UUID(row["source_document_id"])
            if row["classification"] == "public":
                raise ValueError("Public corpus cannot be an app-private document")
        acl = row["acl"]
        if set(acl) - {"community", "roles", "users", "properties"} or not isinstance(
            acl.get("community", False), bool
        ):
            raise ValueError("Invalid ACL")
        if set(acl.get("roles", [])) - {"A", "B", "C"}:
            raise ValueError("Invalid ACL role")
        for identifier in [*acl.get("users", []), *acl.get("properties", [])]:
            UUID(identifier)
        if row["classification"] == "restricted" and row["acl"].get("community"):
            raise ValueError("Restricted community grant")
        location = (root / row.get("file", "unused")).resolve()
        if not location.is_relative_to(root):
            raise PermissionError("Manifest path traversal")
        if validate_files:
            if (
                not isinstance(row.get("title"), str)
                or not 1 <= len(row["title"]) <= 255
                or not re.fullmatch("[a-f0-9]{64}", row["checksum"])
            ):
                raise ValueError("Explicit title/checksum required")
            if location.stat().st_size > 10 * 1024 * 1024:
                raise ValueError("File too large")
            actual = hashlib.sha256(location.read_bytes()).hexdigest()
            if actual != row["checksum"]:
                raise ValueError("Original checksum does not match reviewed manifest")
        rows.append((row, location))
    return rows


def operator_context(row, public=False):
    # This CLI is an administrative trust boundary: dedicated ingestion credential required.
    # It is never exposed to Domo or browser callers. Identity attribution is the reviewed operator ID.
    permissions = ["rag:ingest", "rag:delete"] + (
        ["rag:publish:public"] if public else []
    )
    return AuthorizationContext(
        user_id=row["uploaded_by"],
        tenant_id=row["tenant_id"],
        allowed_community_ids=[row["community_id"]] if row["community_id"] else [],
        allowed_property_ids=[],
        authorized_document_ids=[],
        role="B",
        permissions=permissions,
        channel="intelligence",
        issued_at=int(time.time()),
        nonce=str(uuid4()),
        correlation_id=str(uuid4()),
        method="CLI",
        path="migration",
        body_sha256="",
    )


def embedding_function(client, row):
    import domora_rag as core

    artifact = row.get("embedding_export")
    if not artifact:
        return lambda texts: core.embed_chunks(client, texts)
    # Export is operator-controlled. Only exact content/model/dimension matches are reusable.
    export = json.loads(Path(artifact).read_text(encoding="utf-8"))
    if (
        export["document_id"] != row["document_id"]
        or export["checksum"] != row["checksum"]
        or export["embedding_model"] != core.EMBED_MODEL
        or export["embedding_dimensions"] != 512
    ):
        raise ValueError("Legacy embeddings incompatible with selected source/model")
    lookup = {c["content"]: c["embedding"] for c in export["chunks"]}

    def embed(texts):
        return [
            (
                lookup[text]
                if text in lookup and len(lookup[text]) == 512
                else core.embed_chunks(client, [text])[0]
            )
            for text in texts
        ]

    return embed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["import", "delete", "retention"])
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--publish-public", action="store_true")
    parser.add_argument("--reprocess", action="store_true")
    parser.add_argument("--purge", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    rows = read_manifest(args.manifest, root, args.command == "import")
    print(
        json.dumps(
            {"action": args.command, "documents": len(rows), "execute": args.execute}
        )
    )
    if not args.execute:
        return
    if os.getenv("DOMORA_RAG_WORKLOAD") != "ingestion":
        raise PermissionError("Administrative ingestion workload required")
    from repository import IngestionRepository
    from storage import get_storage
    from providers import get_provider
    from ingestion import IngestionPipeline
    import domora_rag as core

    repo = IngestionRepository()
    storage = get_storage()
    client = get_provider().client() if args.command == "import" else None
    for row, location in rows:
        ctx = operator_context(row, args.publish_public)
        if row["classification"] == "public" and not args.publish_public:
            raise PermissionError("Explicit public publishing flag required")
        if args.command == "retention":
            result = repo.retention(
                row["document_id"], ctx, row["retention_class"], row["retention_until"]
            )
        elif args.command == "delete":
            result = repo.delete(row["document_id"], ctx, storage, args.purge)
        else:
            metadata = {
                **row,
                "filename": location.name,
                "mime_type": "application/pdf",
                "reprocess": args.reprocess,
            }
            result = IngestionPipeline(
                repo, storage, embedding_function(client, row), core.EMBED_MODEL
            ).ingest(location.read_bytes(), metadata, ctx)
        print(json.dumps(result))  # IDs/status only; no corpus/prompts or secrets.


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"status": "failed", "error_type": type(exc).__name__}))
        raise SystemExit(1)
