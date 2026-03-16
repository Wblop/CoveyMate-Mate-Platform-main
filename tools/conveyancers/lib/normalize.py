from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Iterable
from urllib.parse import urlparse

from .identifiers import build_source_identifier


def safe_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def normalize_email(value: str | None) -> str:
    value = safe_text(value)
    if not value:
        return ""
    return value.lower()


def normalize_phone(value: str | None) -> str:
    value = safe_text(value)
    if not value:
        return ""
    # Keep common dial characters while removing obvious punctuation noise.
    value = re.sub(r"[^0-9+()\-\s]", "", value)
    return safe_text(value)


def normalize_website(value: str | None) -> str:
    value = safe_text(value)
    if not value:
        return ""

    value = re.sub(r"^(website|url)\s*:\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[),.;\]]+$", "", value).strip()
    if not value:
        return ""

    lowered = value.lower()
    if lowered.startswith("mailto:") or lowered.startswith("tel:"):
        return ""

    parts = re.split(r"\s+", value)
    candidate = next(
        (
            part
            for part in parts
            if "." in part or part.startswith("//") or part.startswith("http://") or part.startswith("https://")
        ),
        value,
    )
    candidate = candidate.strip()
    if not candidate:
        return ""

    if candidate.startswith("//"):
        candidate = f"https:{candidate}"
    elif not candidate.startswith("http://") and not candidate.startswith("https://"):
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    if parsed.scheme not in ("http", "https"):
        return ""

    if not parsed.netloc or "." not in parsed.netloc or " " in parsed.netloc:
        return ""

    normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path or ''}"
    if parsed.query:
        normalized = f"{normalized}?{parsed.query}"
    if parsed.fragment:
        normalized = f"{normalized}#{parsed.fragment}"

    return normalized


def normalize_areas(values: Iterable[str] | None) -> list[str]:
    if values is None:
        return []

    out: list[str] = []
    seen: set[str] = set()

    for raw in values:
        for part in safe_text(raw).split(";"):
            value = safe_text(part)
            if not value:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(value)

    return out


@dataclass(frozen=True)
class ConveyancerRecord:
    jurisdiction: str
    regulator_type: str
    name: str
    contact_name: str
    organization_name: str
    address: str
    phone: str
    email: str
    website: str
    areas_of_practice: list[str]
    source_url: str
    source_identifier: str

    def to_dict(self) -> dict[str, object]:
        return {
            "jurisdiction": self.jurisdiction,
            "regulator_type": self.regulator_type,
            "name": self.name,
            "contact_name": self.contact_name,
            "organization_name": self.organization_name,
            "address": self.address,
            "phone": self.phone,
            "email": self.email,
            "website": self.website,
            "areas_of_practice": self.areas_of_practice,
            "source_url": self.source_url,
            "source_identifier": self.source_identifier,
        }


def make_record(
    *,
    jurisdiction: str,
    regulator_type: str,
    name: str,
    source_url: str,
    contact_name: str = "",
    organization_name: str = "",
    address: str = "",
    phone: str = "",
    email: str = "",
    website: str = "",
    areas_of_practice: Iterable[str] | None = None,
    source_identifier: str | None = None,
) -> ConveyancerRecord:
    cleaned_name = safe_text(name)
    if not cleaned_name:
        raise ValueError("Conveyancer record must include a name.")

    cleaned_website = normalize_website(website)
    cleaned_email = normalize_email(email)
    cleaned_address = safe_text(address)
    cleaned_phone = normalize_phone(phone)
    cleaned_areas = normalize_areas(areas_of_practice)
    cleaned_contact_name = safe_text(contact_name)
    cleaned_organization_name = safe_text(organization_name)

    if not cleaned_contact_name and not cleaned_organization_name:
        cleaned_organization_name = cleaned_name

    identifier = source_identifier or build_source_identifier(
        name=cleaned_name,
        email=cleaned_email,
        phone=cleaned_phone,
        address=cleaned_address,
        website=cleaned_website,
    )

    return ConveyancerRecord(
        jurisdiction=jurisdiction.upper(),
        regulator_type=safe_text(regulator_type).lower(),
        name=cleaned_name,
        contact_name=cleaned_contact_name,
        organization_name=cleaned_organization_name,
        address=cleaned_address,
        phone=cleaned_phone,
        email=cleaned_email,
        website=cleaned_website,
        areas_of_practice=cleaned_areas,
        source_url=safe_text(source_url),
        source_identifier=safe_text(identifier).lower(),
    )


def dedupe_records(records: Iterable[ConveyancerRecord]) -> list[ConveyancerRecord]:
    out: list[ConveyancerRecord] = []
    seen: set[tuple[str, str, str]] = set()

    for record in records:
        key = (record.jurisdiction, record.regulator_type, record.source_identifier)
        if key in seen:
            continue
        seen.add(key)
        out.append(record)

    return out


def infer_domain(url: str) -> str:
    parsed = urlparse(url)
    return (parsed.netloc or "").lower()


def to_json(records: Iterable[ConveyancerRecord]) -> str:
    payload = [record.to_dict() for record in records]
    return json.dumps(payload, ensure_ascii=False, indent=2)
