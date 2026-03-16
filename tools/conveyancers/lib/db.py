from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import uuid
from pathlib import Path
from typing import Iterable, TYPE_CHECKING

if TYPE_CHECKING:
    import psycopg

from .identifiers import build_row_uuid
from .normalize import ConveyancerRecord


APP_SCHEMA_DDL = """
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.conveyancers
(
    id UUID PRIMARY KEY,
    jurisdiction TEXT NOT NULL,
    regulator_type TEXT NOT NULL,
    name TEXT NOT NULL,
    contact_name TEXT NULL,
    organization_name TEXT NULL,
    address TEXT NULL,
    phone TEXT NULL,
    email TEXT NULL,
    website TEXT NULL,
    areas_of_practice JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_url TEXT NOT NULL,
    source_identifier TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_utc TIMESTAMPTZ NOT NULL,
    created_utc TIMESTAMPTZ NOT NULL,
    updated_utc TIMESTAMPTZ NOT NULL
);

ALTER TABLE app.conveyancers
    ADD COLUMN IF NOT EXISTS contact_name TEXT NULL;

ALTER TABLE app.conveyancers
    ADD COLUMN IF NOT EXISTS organization_name TEXT NULL;

UPDATE app.conveyancers
SET organization_name = name
WHERE organization_name IS NULL OR btrim(organization_name) = '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_conveyancers_jurisdiction_regulator_source
    ON app.conveyancers (jurisdiction, regulator_type, source_identifier);

CREATE INDEX IF NOT EXISTS ix_conveyancers_jurisdiction_active_name
    ON app.conveyancers (jurisdiction, is_active, name);

CREATE TABLE IF NOT EXISTS app.conveyancer_refresh_log
(
    id UUID PRIMARY KEY,
    jurisdiction TEXT NULL,
    regulator_type TEXT NULL,
    started_utc TIMESTAMPTZ NULL,
    completed_utc TIMESTAMPTZ NULL,
    status TEXT NULL,
    record_count INTEGER NULL,
    error_message TEXT NULL,
    extracted_sql_path TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_conveyancer_refresh_log_started_utc
    ON app.conveyancer_refresh_log (started_utc DESC);
"""


UPSERT_SQL = """
INSERT INTO app.conveyancers
(
    id,
    jurisdiction,
    regulator_type,
    name,
    contact_name,
    organization_name,
    address,
    phone,
    email,
    website,
    areas_of_practice,
    source_url,
    source_identifier,
    is_active,
    last_seen_utc,
    created_utc,
    updated_utc
)
VALUES
(
    %(id)s,
    %(jurisdiction)s,
    %(regulator_type)s,
    %(name)s,
    %(contact_name)s,
    %(organization_name)s,
    %(address)s,
    %(phone)s,
    %(email)s,
    %(website)s,
    CAST(%(areas_of_practice)s AS jsonb),
    %(source_url)s,
    %(source_identifier)s,
    TRUE,
    %(last_seen_utc)s,
    %(created_utc)s,
    %(updated_utc)s
)
ON CONFLICT (jurisdiction, regulator_type, source_identifier) DO UPDATE
SET
    name = EXCLUDED.name,
    contact_name = EXCLUDED.contact_name,
    organization_name = EXCLUDED.organization_name,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    website = EXCLUDED.website,
    areas_of_practice = EXCLUDED.areas_of_practice,
    source_url = EXCLUDED.source_url,
    is_active = TRUE,
    last_seen_utc = EXCLUDED.last_seen_utc,
    updated_utc = EXCLUDED.updated_utc;
"""


DEACTIVATE_MISSING_SQL = """
UPDATE app.conveyancers
SET is_active = FALSE,
    updated_utc = %(updated_utc)s
WHERE jurisdiction = %(jurisdiction)s
  AND regulator_type = %(regulator_type)s
  AND is_active = TRUE
  AND NOT (source_identifier = ANY(%(source_identifiers)s));
"""

DEACTIVATE_SCOPE_SQL = """
UPDATE app.conveyancers
SET is_active = FALSE,
    updated_utc = %(updated_utc)s
WHERE jurisdiction = %(jurisdiction)s
  AND regulator_type = %(regulator_type)s
  AND is_active = TRUE;
"""


START_REFRESH_LOG_SQL = """
INSERT INTO app.conveyancer_refresh_log
(
    id,
    jurisdiction,
    regulator_type,
    started_utc,
    status,
    extracted_sql_path
)
VALUES
(
    %(id)s,
    %(jurisdiction)s,
    %(regulator_type)s,
    %(started_utc)s,
    %(status)s,
    %(extracted_sql_path)s
);
"""


COMPLETE_REFRESH_LOG_SQL = """
UPDATE app.conveyancer_refresh_log
SET completed_utc = %(completed_utc)s,
    status = %(status)s,
    record_count = %(record_count)s,
    error_message = %(error_message)s,
    extracted_sql_path = COALESCE(%(extracted_sql_path)s, extracted_sql_path)
WHERE id = %(id)s;
"""


@dataclass(frozen=True)
class RefreshResult:
    upserted_count: int
    deactivated_count: int


class DatabaseClient:
    def __init__(self, connection_string: str):
        if not connection_string.strip():
            raise ValueError("A Postgres connection string is required.")
        self.connection_string = connection_string

    def connect(self) -> "psycopg.Connection":
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ModuleNotFoundError as error:  # pragma: no cover - environment guard
            raise RuntimeError(
                "psycopg is not installed. Run: pip install -r tools/conveyancers/requirements.txt"
            ) from error

        conninfo = _normalize_connection_string(self.connection_string)
        return psycopg.connect(conninfo, row_factory=dict_row)

    def ensure_schema(self, conn: "psycopg.Connection") -> None:
        with conn.cursor() as cur:
            cur.execute(APP_SCHEMA_DDL)

    def start_refresh_log(
        self,
        conn: "psycopg.Connection",
        *,
        jurisdiction: str,
        regulator_type: str,
        extracted_sql_path: str | None,
        started_utc: datetime,
    ) -> uuid.UUID:
        log_id = uuid.uuid4()
        with conn.cursor() as cur:
            cur.execute(
                START_REFRESH_LOG_SQL,
                {
                    "id": log_id,
                    "jurisdiction": jurisdiction,
                    "regulator_type": regulator_type,
                    "started_utc": started_utc,
                    "status": "running",
                    "extracted_sql_path": extracted_sql_path,
                },
            )
        return log_id

    def complete_refresh_log(
        self,
        conn: "psycopg.Connection",
        *,
        log_id: uuid.UUID,
        status: str,
        record_count: int,
        error_message: str | None,
        extracted_sql_path: str | None,
        completed_utc: datetime,
    ) -> None:
        with conn.cursor() as cur:
            cur.execute(
                COMPLETE_REFRESH_LOG_SQL,
                {
                    "id": log_id,
                    "completed_utc": completed_utc,
                    "status": status,
                    "record_count": record_count,
                    "error_message": error_message,
                    "extracted_sql_path": extracted_sql_path,
                },
            )

    def upsert_records(
        self,
        conn: "psycopg.Connection",
        records: Iterable[ConveyancerRecord],
        *,
        extracted_utc: datetime,
        expected_scopes: Iterable[tuple[str, str]] | None = None,
        deactivate_missing: bool = True,
    ) -> RefreshResult:
        items = list(records)
        if extracted_utc.tzinfo is None:
            extracted_utc = extracted_utc.replace(tzinfo=timezone.utc)

        by_scope: dict[tuple[str, str], list[str]] = defaultdict(list)

        with conn.cursor() as cur:
            for record in items:
                row_id = build_row_uuid(
                    jurisdiction=record.jurisdiction,
                    regulator_type=record.regulator_type,
                    source_identifier=record.source_identifier,
                )
                cur.execute(
                    UPSERT_SQL,
                    {
                        "id": row_id,
                        "jurisdiction": record.jurisdiction,
                        "regulator_type": record.regulator_type,
                        "name": record.name,
                        "contact_name": record.contact_name or None,
                        "organization_name": record.organization_name or None,
                        "address": record.address or None,
                        "phone": record.phone or None,
                        "email": record.email or None,
                        "website": record.website or None,
                        "areas_of_practice": json.dumps(record.areas_of_practice, ensure_ascii=False),
                        "source_url": record.source_url,
                        "source_identifier": record.source_identifier,
                        "last_seen_utc": extracted_utc,
                        "created_utc": extracted_utc,
                        "updated_utc": extracted_utc,
                    },
                )
                by_scope[(record.jurisdiction, record.regulator_type)].append(record.source_identifier)

            deactivated = 0
            if deactivate_missing:
                scopes: set[tuple[str, str]] = set(by_scope.keys())
                for scope in expected_scopes or []:
                    if len(scope) != 2:
                        continue
                    jurisdiction, regulator_type = scope
                    normalized = (
                        (jurisdiction or "").strip().upper(),
                        (regulator_type or "").strip().lower(),
                    )
                    if normalized[0] and normalized[1]:
                        scopes.add(normalized)

                for (jurisdiction, regulator_type) in scopes:
                    source_identifiers = by_scope.get((jurisdiction, regulator_type), [])
                    if source_identifiers:
                        cur.execute(
                            DEACTIVATE_MISSING_SQL,
                            {
                                "jurisdiction": jurisdiction,
                                "regulator_type": regulator_type,
                                "source_identifiers": source_identifiers,
                                "updated_utc": extracted_utc,
                            },
                        )
                    else:
                        cur.execute(
                            DEACTIVATE_SCOPE_SQL,
                            {
                                "jurisdiction": jurisdiction,
                                "regulator_type": regulator_type,
                                "updated_utc": extracted_utc,
                            },
                        )
                    deactivated += cur.rowcount

        return RefreshResult(upserted_count=len(items), deactivated_count=deactivated)


def _sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def _normalize_connection_string(value: str) -> str:
    trimmed = value.strip()
    if trimmed.startswith("postgres://") or trimmed.startswith("postgresql://"):
        return trimmed

    if ";" not in trimmed:
        return trimmed

    key_map = {
        "host": "host",
        "server": "host",
        "port": "port",
        "database": "dbname",
        "initial_catalog": "dbname",
        "username": "user",
        "user_id": "user",
        "userid": "user",
        "user": "user",
        "password": "password",
        "ssl_mode": "sslmode",
        "sslmode": "sslmode",
    }

    parts: list[str] = []
    for segment in trimmed.split(";"):
        segment = segment.strip()
        if not segment or "=" not in segment:
            continue
        raw_key, raw_value = segment.split("=", 1)
        key = raw_key.strip().lower().replace(" ", "_")
        value_part = raw_value.strip()
        mapped = key_map.get(key)
        if not mapped:
            continue
        if mapped == "sslmode":
            value_part = value_part.lower()
        parts.append(f"{mapped}={value_part}")

    return " ".join(parts)


def _sql_bool(value: bool) -> str:
    return "TRUE" if value else "FALSE"


def write_conveyancers_snapshot_sql(
    *,
    destination: Path,
    jurisdiction: str,
    source_url: str,
    extracted_utc: datetime,
    records: Iterable[ConveyancerRecord],
) -> None:
    if extracted_utc.tzinfo is None:
        extracted_utc = extracted_utc.replace(tzinfo=timezone.utc)
    extracted_iso = extracted_utc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    rows = sorted(
        records,
        key=lambda record: (
            (record.organization_name or record.name).casefold(),
            record.name.casefold(),
            record.source_identifier,
        ),
    )

    lines: list[str] = [
        f"-- last_extracted_utc: {extracted_iso}",
        f"-- source_url: {source_url}",
        "",
        "CREATE SCHEMA IF NOT EXISTS app;",
        "",
        "DROP TABLE IF EXISTS app.conveyancers;",
        "CREATE TABLE app.conveyancers",
        "(",
        "    id UUID PRIMARY KEY,",
        "    jurisdiction TEXT NOT NULL,",
        "    regulator_type TEXT NOT NULL,",
        "    name TEXT NOT NULL,",
        "    contact_name TEXT NULL,",
        "    organization_name TEXT NULL,",
        "    address TEXT NULL,",
        "    phone TEXT NULL,",
        "    email TEXT NULL,",
        "    website TEXT NULL,",
        "    areas_of_practice JSONB NOT NULL DEFAULT '[]'::jsonb,",
        "    source_url TEXT NOT NULL,",
        "    source_identifier TEXT NOT NULL,",
        "    is_active BOOLEAN NOT NULL DEFAULT TRUE,",
        "    last_seen_utc TIMESTAMPTZ NOT NULL,",
        "    created_utc TIMESTAMPTZ NOT NULL,",
        "    updated_utc TIMESTAMPTZ NOT NULL",
        ");",
        "",
        "CREATE UNIQUE INDEX ux_conveyancers_jurisdiction_regulator_source",
        "    ON app.conveyancers (jurisdiction, regulator_type, source_identifier);",
        "",
        "CREATE INDEX ix_conveyancers_jurisdiction_active_name",
        "    ON app.conveyancers (jurisdiction, is_active, name);",
        "",
    ]

    if rows:
        lines.append("INSERT INTO app.conveyancers")
        lines.append("(")
        lines.append("    id,")
        lines.append("    jurisdiction,")
        lines.append("    regulator_type,")
        lines.append("    name,")
        lines.append("    contact_name,")
        lines.append("    organization_name,")
        lines.append("    address,")
        lines.append("    phone,")
        lines.append("    email,")
        lines.append("    website,")
        lines.append("    areas_of_practice,")
        lines.append("    source_url,")
        lines.append("    source_identifier,")
        lines.append("    is_active,")
        lines.append("    last_seen_utc,")
        lines.append("    created_utc,")
        lines.append("    updated_utc")
        lines.append(")")
        lines.append("VALUES")

        value_lines: list[str] = []
        for record in rows:
            row_id = build_row_uuid(
                jurisdiction=record.jurisdiction,
                regulator_type=record.regulator_type,
                source_identifier=record.source_identifier,
            )
            areas_json = json.dumps(record.areas_of_practice, ensure_ascii=False).replace("'", "''")
            value_lines.append(
                "(\n"
                f"    {_sql_literal(str(row_id))},\n"
                f"    {_sql_literal(record.jurisdiction)},\n"
                f"    {_sql_literal(record.regulator_type)},\n"
                f"    {_sql_literal(record.name)},\n"
                f"    {_sql_literal(record.contact_name or None)},\n"
                f"    {_sql_literal(record.organization_name or None)},\n"
                f"    {_sql_literal(record.address or None)},\n"
                f"    {_sql_literal(record.phone or None)},\n"
                f"    {_sql_literal(record.email or None)},\n"
                f"    {_sql_literal(record.website or None)},\n"
                f"    '{areas_json}'::jsonb,\n"
                f"    {_sql_literal(record.source_url)},\n"
                f"    {_sql_literal(record.source_identifier)},\n"
                f"    {_sql_bool(True)},\n"
                f"    {_sql_literal(extracted_iso)}::timestamptz,\n"
                f"    {_sql_literal(extracted_iso)}::timestamptz,\n"
                f"    {_sql_literal(extracted_iso)}::timestamptz\n"
                ")"
            )

        lines.append(",\n".join(value_lines) + ";")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_refresh_log_snapshot_sql(
    *,
    destination: Path,
    source_url: str,
    extracted_utc: datetime,
) -> None:
    if extracted_utc.tzinfo is None:
        extracted_utc = extracted_utc.replace(tzinfo=timezone.utc)
    extracted_iso = extracted_utc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    content = "\n".join(
        [
            f"-- last_extracted_utc: {extracted_iso}",
            f"-- source_url: {source_url}",
            "",
            "CREATE SCHEMA IF NOT EXISTS app;",
            "",
            "DROP TABLE IF EXISTS app.conveyancer_refresh_log;",
            "CREATE TABLE app.conveyancer_refresh_log",
            "(",
            "    id UUID PRIMARY KEY,",
            "    jurisdiction TEXT NULL,",
            "    regulator_type TEXT NULL,",
            "    started_utc TIMESTAMPTZ NULL,",
            "    completed_utc TIMESTAMPTZ NULL,",
            "    status TEXT NULL,",
            "    record_count INTEGER NULL,",
            "    error_message TEXT NULL,",
            "    extracted_sql_path TEXT NULL",
            ");",
            "",
            "CREATE INDEX ix_conveyancer_refresh_log_started_utc",
            "    ON app.conveyancer_refresh_log (started_utc DESC);",
            "",
        ]
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")
