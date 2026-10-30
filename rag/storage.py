"""Only metadata-derived blob paths. Query workload never instantiates storage."""

import os
import re
from pathlib import Path
from uuid import UUID
from providers import credential


def safe_filename(filename):
    if not filename or "/" in filename or "\\" in filename or "\x00" in filename:
        raise ValueError("Invalid filename")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", filename)[-120:]
    if name in (".", "..", ""):
        raise ValueError("Invalid filename")
    return name


def blob_path(container, tenant, community, document, version, filename):
    if (
        container not in ("raw", "processed", "quarantine")
        or not isinstance(version, int)
        or version < 1
    ):
        raise PermissionError("Invalid storage scope")
    for identifier in (document,):
        UUID(str(identifier))
    for identifier in (tenant, community):
        if identifier is not None:
            UUID(str(identifier))
    if (tenant is None) != (community is None):
        raise PermissionError("Invalid storage scope")
    return "/".join(
        [
            container,
            str(tenant or "public"),
            str(community or "global"),
            str(document),
            str(version),
            safe_filename(filename),
        ]
    )


def verify_path(path, metadata, version):
    if not isinstance(path, str):
        raise PermissionError("Invalid blob path")
    parts = path.split("/")
    if len(parts) != 6:
        raise PermissionError("Invalid blob path")
    expected = blob_path(
        parts[0],
        metadata["tenant_id"],
        metadata["community_id"],
        metadata["document_id"],
        version,
        parts[-1],
    )
    if path != expected:
        raise PermissionError("Invalid blob path")
    return parts[0], "/".join(parts[1:])


class AzureBlobStorage:
    def __init__(self):
        from azure.storage.blob import BlobServiceClient

        url = os.environ["DOMORA_BLOB_ACCOUNT_URL"].rstrip("/")
        if not re.fullmatch(r"https://[a-z0-9]{3,24}\.blob\.core\.windows\.net", url):
            raise ValueError("Invalid Azure Blob endpoint")
        self.client = BlobServiceClient(account_url=url, credential=credential())

    def put(self, path, data, metadata, version):
        container, name = verify_path(path, metadata, version)
        self.client.get_blob_client(container, name).upload_blob(data, overwrite=False)

    def delete(self, path, metadata, version):
        from azure.core.exceptions import ResourceNotFoundError

        container, name = verify_path(path, metadata, version)
        try:
            self.client.get_blob_client(container, name).delete_blob(
                delete_snapshots="include"
            )
        except ResourceNotFoundError:
            pass
        # Delete live versions of this exact authorized path, never a prefix/other document.
        for blob in self.client.get_container_client(container).list_blobs(
            name_starts_with=name, include=["versions"]
        ):
            if blob.name == name and blob.version_id:
                try:
                    self.client.get_blob_client(
                        container, name, version_id=blob.version_id
                    ).delete_blob()
                except ResourceNotFoundError:
                    pass
        # Soft-deleted copies/backups may still exist under storage retention.
        return {"retention_pending": True}


class LocalStorage:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def location(self, path, metadata, version):
        verify_path(path, metadata, version)
        location = (self.root / path).resolve()
        if not location.is_relative_to(self.root):
            raise PermissionError("Invalid local path")
        return location

    def put(self, path, data, metadata, version):
        location = self.location(path, metadata, version)
        location.parent.mkdir(parents=True, exist_ok=True)
        with location.open("xb") as file:
            file.write(data)

    def delete(self, path, metadata, version):
        self.location(path, metadata, version).unlink(missing_ok=True)
        return {"retention_pending": False}


def get_storage():
    if os.getenv("DOMORA_BLOB_ACCOUNT_URL"):
        return AzureBlobStorage()
    if os.getenv("DOMORA_ENVIRONMENT", "development") == "development" and os.getenv(
        "DOMORA_LOCAL_STORAGE_DIR"
    ):
        return LocalStorage(os.environ["DOMORA_LOCAL_STORAGE_DIR"])
    raise RuntimeError("Azure Blob required; local adapter only explicit development")
