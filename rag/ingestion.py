"""Separate ingestion workload. Staging artifacts are never eligible for retrieval."""

import hashlib
import io
import json
import os
import socket
import ssl
import struct
import time
import unicodedata
from pypdf import PdfReader
from storage import blob_path, safe_filename
from telemetry import event

MAX_FILE_SIZE = 10 * 1024 * 1024


class QuarantineError(ValueError):
    pass


class ClamAVScanner:
    def scan(self, data):
        host = os.getenv("DOMORA_CLAMAV_HOST")
        if not host:
            raise QuarantineError("MALWARE_SCANNER_PENDING")
        with socket.create_connection(
            (host, int(os.getenv("DOMORA_CLAMAV_PORT", "3310"))), timeout=30
        ) as connection:
            if os.getenv("DOMORA_ENVIRONMENT", "development") != "development":
                if not os.getenv("DOMORA_CLAMAV_CA_FILE"):
                    raise QuarantineError("SCANNER_TLS_PENDING")
                connection = ssl.create_default_context(
                    cafile=os.environ["DOMORA_CLAMAV_CA_FILE"]
                ).wrap_socket(connection, server_hostname=host)
            connection.sendall(b"zINSTREAM\0")
            for offset in range(0, len(data), 65536):
                part = data[offset : offset + 65536]
                connection.sendall(struct.pack("!I", len(part)) + part)
            connection.sendall(struct.pack("!I", 0))
            response = b""
            while b"\0" not in response and len(response) < 4096:
                part = connection.recv(1024)
                if not part:
                    break
                response += part
            if response.strip(b"\x00\n") != b"stream: OK":
                raise QuarantineError("MALWARE_NOT_CLEAN")


def validate_pdf(data, filename, mime):
    if not 0 < len(data) <= MAX_FILE_SIZE:
        raise QuarantineError("FILE_SIZE_INVALID")
    if not safe_filename(filename).lower().endswith(".pdf"):
        raise QuarantineError("EXTENSION_INVALID")
    if mime != "application/pdf" or not data.startswith(b"%PDF-"):
        raise QuarantineError("MIME_MISMATCH")


def parse_pdf(data, ocr=None):
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise QuarantineError("ENCRYPTED_PDF")
    if not 0 < len(reader.pages) <= 500:
        raise QuarantineError("PAGE_LIMIT")
    pages = []
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        if not text.strip():
            if ocr is None:
                raise QuarantineError("OCR_REQUIRED_PENDING")
            text = ocr.page_text(data, number)
        normalized = unicodedata.normalize("NFC", text).replace("\x00", "").strip()
        if not normalized:
            raise QuarantineError("EMPTY_PAGE")
        pages.append({"page": number, "text": normalized})
    if sum(len(p["text"]) for p in pages) > 2_000_000:
        raise QuarantineError("TEXT_LIMIT")
    return pages


class IngestionPipeline:
    def __init__(self, repository, storage, embed, model, scanner=None, ocr=None):
        self.repository, self.storage, self.embed, self.model = (
            repository,
            storage,
            embed,
            model,
        )
        self.scanner = scanner if scanner is not None else ClamAVScanner()
        self.ocr = ocr

    def ingest(self, data, metadata, context):
        from telemetry import current_context

        current_context.set(context)
        started = time.monotonic()
        if "rag:ingest" not in context.permissions:
            raise PermissionError("Ingestion denied")
        if metadata["classification"] == "public":
            if "rag:publish:public" not in context.permissions:
                raise PermissionError("Public publishing denied")
        elif (
            metadata["tenant_id"] != context.tenant_id
            or metadata["community_id"] not in context.allowed_community_ids
        ):
            raise PermissionError("Ingestion scope denied")
        if not 0 < len(data) <= MAX_FILE_SIZE:
            raise QuarantineError("FILE_SIZE_INVALID")
        metadata = {
            **metadata,
            "size": len(data),
            "checksum": hashlib.sha256(data).hexdigest(),
            "filename": safe_filename(metadata["filename"]),
        }
        doc, version, duplicate = self.repository.begin(metadata, context)
        if duplicate:
            event("rag.duplicates", context, document_id=doc, count=1)
            return {"document_id": doc, "version": version, "duplicate": True}
        scoped = {**metadata, "document_id": doc}
        raw = blob_path(
            "raw",
            metadata["tenant_id"],
            metadata["community_id"],
            doc,
            version,
            metadata["filename"],
        )
        quarantine = blob_path(
            "quarantine",
            metadata["tenant_id"],
            metadata["community_id"],
            doc,
            version,
            metadata["filename"],
        )
        event("rag.indexing_started", context, document_id=doc, version=version)
        try:
            self.storage.put(raw, data, scoped, version)
            self.repository.state(doc, version, "validating", storage_path=raw)
            validate_pdf(data, metadata["filename"], metadata["mime_type"])
            self.scanner.scan(data)
            self.repository.state(doc, version, "processing")
            pages = parse_pdf(data, self.ocr)
            from domora_rag import (
                chunk_page,
                CHUNK_TARGET_CHARS,
                CHUNK_OVERLAP_CHARS,
                article_headings,
            )
            from minimization import minimize_text

            chunks = []
            section = None
            for page in pages:
                page["text"] = minimize_text(page["text"])
                page_headings = [
                    line.strip()
                    for line in page["text"].splitlines()
                    if line.strip().casefold()
                    in (
                        "presupuesto",
                        "orden del día",
                        "acuerdos",
                        "liquidación",
                        "cuentas",
                    )
                ]
                for index, text in enumerate(
                    chunk_page(page["text"], CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS)
                ):
                    # Only actual headings are used; no model-created sections.
                    heading = next(
                        (
                            line.strip()
                            for line in text.splitlines()
                            if len(line.strip()) < 120
                            and line.strip()
                            .lower()
                            .startswith(("artículo ", "capítulo ", "sección "))
                        ),
                        None,
                    )
                    articles = article_headings(text)
                    section = (
                        ("Artículo " + articles[0])
                        if articles
                        else heading
                        or (
                            next(
                                (
                                    h
                                    for h in page_headings
                                    if h.casefold() in text.casefold()
                                ),
                                None,
                            )
                        )
                        or section
                    )
                    chunks.append(
                        {
                            "page": page["page"],
                            "section": section,
                            "chunk_index": index,
                            "content": text,
                        }
                    )
            if not chunks or len(chunks) > 2000:
                raise QuarantineError("CHUNK_LIMIT")
            processed = blob_path(
                "processed",
                metadata["tenant_id"],
                metadata["community_id"],
                doc,
                version,
                "extracted.json",
            )
            self.storage.put(
                processed,
                json.dumps(
                    {"pages": pages, "chunks": chunks}, ensure_ascii=False
                ).encode(),
                scoped,
                version,
            )
            self.repository.state(doc, version, "processing", processed_path=processed)
            embeddings = self.embed([c["content"] for c in chunks])
            self.repository.activate(
                doc, version, metadata, chunks, embeddings, self.model, context
            )
            event(
                "rag.indexing_completed",
                context,
                document_id=doc,
                version=version,
                count=len(chunks),
                latency_ms=round((time.monotonic() - started) * 1000),
            )
            event("rag.chunks", context, count=len(chunks))
            return {
                "document_id": doc,
                "version": version,
                "status": "indexed",
                "duplicate": False,
            }
        except Exception as exc:
            state = "quarantine" if isinstance(exc, QuarantineError) else "failed"
            code = str(exc) if isinstance(exc, QuarantineError) else type(exc).__name__
            try:
                self.storage.put(quarantine, data, scoped, version)
                self.repository.state(
                    doc, version, state, quarantine_path=quarantine, failure_code=code
                )
            except Exception:
                self.repository.state(
                    doc, version, "failed", failure_code="ARTIFACT_OR_STATE_FAILURE"
                )
            event(
                "rag.indexing_failed",
                context,
                document_id=doc,
                version=version,
                error_type=type(exc).__name__,
                latency_ms=round((time.monotonic() - started) * 1000),
            )
            return {
                "document_id": doc,
                "version": version,
                "status": state,
                "failure_code": code,
            }
