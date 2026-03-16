from __future__ import annotations

import hashlib
import re
import uuid


SOURCE_NAMESPACE = uuid.UUID("c89f6ad7-6e18-4526-9d84-88b2a56b3f29")
ROW_NAMESPACE = uuid.UUID("68f236f6-f0cb-4c6c-a2f6-f3078f2b7c45")


def _slug(value: str, fallback: str = "conveyancer", max_len: int = 64) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not cleaned:
        cleaned = fallback
    return cleaned[:max_len]


def build_source_identifier(
    *,
    name: str,
    email: str = "",
    phone: str = "",
    address: str = "",
    website: str = "",
) -> str:
    """Build a deterministic, human-readable ID used for dedupe/upsert keys."""
    basis = "|".join(
        [
            name.strip().lower(),
            email.strip().lower(),
            phone.strip().lower(),
            address.strip().lower(),
            website.strip().lower(),
        ]
    )
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]
    return f"{_slug(name)}-{digest}"


def build_row_uuid(*, jurisdiction: str, regulator_type: str, source_identifier: str) -> uuid.UUID:
    key = "|".join([jurisdiction.strip().upper(), regulator_type.strip().lower(), source_identifier.strip().lower()])
    return uuid.uuid5(ROW_NAMESPACE, key)
