"""Conservative deterministic redaction; not a general PII classifier."""

import re


def minimize_text(text):
    # Structured financial credentials are not required for answering community questions.
    for prefix, length in [
        ("ES", 24),
        ("DE", 22),
        ("FR", 27),
        ("GB", 22),
        ("IT", 27),
        ("PT", 25),
    ]:
        pattern = rf"\b{prefix}\s*\d\s*\d(?:\s*[A-Z0-9]){{{length-4}}}\b"
        text = re.sub(pattern, "[IBAN OMITIDO]", text, flags=re.IGNORECASE)
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{20,}", "[CLAVE OMITIDA]", text)
    text = re.sub(
        r"\bBearer\s+[A-Za-z0-9._~+-]{10,}",
        "[TOKEN OMITIDO]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bpostgres(?:ql)?://[^\s]+", "[CONEXIÓN OMITIDA]", text, flags=re.IGNORECASE
    )
    text = re.sub(
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
        "[JWT OMITIDO]",
        text,
    )
    return text
