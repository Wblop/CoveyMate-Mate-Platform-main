from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .db import DatabaseClient, write_conveyancers_snapshot_sql, write_refresh_log_snapshot_sql
from .logging import get_logger
from .normalize import ConveyancerRecord, dedupe_records, to_json


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SQL_ROOT = REPO_ROOT / "data" / "conveyancers" / "sql"
DEFAULT_DEBUG_ROOT = REPO_ROOT / "tools" / "conveyancers" / "_debug"


@dataclass(frozen=True)
class RunSummary:
    jurisdiction: str
    extracted_count: int
    regulator_counts: dict[str, int]
    sql_snapshot_path: Path | None
    refresh_log_sql_path: Path | None


@dataclass(frozen=True)
class CommonArgs:
    connection: str
    headless: bool
    timeout_seconds: int
    debug_dump_dir: Path
    dry_run: bool
    stdout: bool
    sql_output_dir: Path | None
    keyword: str



def parse_bool(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in {"1", "true", "yes", "y", "on"}:
        return True
    if lowered in {"0", "false", "no", "n", "off"}:
        return False
    raise argparse.ArgumentTypeError("Expected true/false")


def build_common_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--connection",
        required=True,
        help="Postgres connection string.",
    )
    parser.add_argument(
        "--headless",
        type=parse_bool,
        default=True,
        help="Run Playwright in headless mode (true/false).",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=90,
        help="Global scraper timeout in seconds.",
    )
    parser.add_argument(
        "--debug-dump-dir",
        type=Path,
        default=DEFAULT_DEBUG_ROOT,
        help=f"Directory for debug HTML/screenshots (default: {DEFAULT_DEBUG_ROOT}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scrape and normalize, but skip Postgres writes.",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Emit normalized records as JSON to stdout.",
    )
    parser.add_argument(
        "--sql-output-dir",
        type=Path,
        default=None,
        help="Optional explicit SQL snapshot output directory.",
    )
    parser.add_argument(
        "--keyword",
        default="convey",
        help="Search keyword used by generic source scrapers.",
    )
    return parser


def to_common_args(namespace: argparse.Namespace) -> CommonArgs:
    timeout_seconds = max(15, namespace.timeout_seconds)
    return CommonArgs(
        connection=namespace.connection,
        headless=namespace.headless,
        timeout_seconds=timeout_seconds,
        debug_dump_dir=namespace.debug_dump_dir.resolve(),
        dry_run=namespace.dry_run,
        stdout=namespace.stdout,
        sql_output_dir=namespace.sql_output_dir.resolve() if namespace.sql_output_dir else None,
        keyword=namespace.keyword,
    )


def debug_dump(page, out_dir: Path, prefix: str, *, logger_name: str = "conveyancers") -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = int(datetime.now(tz=timezone.utc).timestamp())
    png_path = out_dir / f"{prefix}_{ts}.png"
    html_path = out_dir / f"{prefix}_{ts}.html"
    logger = get_logger(logger_name)

    try:
        page.screenshot(path=str(png_path), full_page=True)
    except Exception as error:  # pragma: no cover - best effort debug path
        logger.warning("Failed debug screenshot: %s", error)

    try:
        html_path.write_text(page.content(), encoding="utf-8")
    except Exception as error:  # pragma: no cover - best effort debug path
        logger.warning("Failed debug HTML dump: %s", error)

    logger.warning("Debug artifacts written: %s and %s", png_path, html_path)


def persist_records(
    *,
    args: CommonArgs,
    jurisdiction: str,
    records: Iterable[ConveyancerRecord],
    source_urls: Iterable[str],
    expected_regulator_types: Iterable[str] | None = None,
) -> RunSummary:
    logger = get_logger(f"conveyancers.{jurisdiction.lower()}")
    deduped = dedupe_records(records)
    regulator_counts: dict[str, int] = defaultdict(int)
    for record in deduped:
        regulator_counts[record.regulator_type] += 1

    expected_regulators = {
        regulator.strip().lower()
        for regulator in (expected_regulator_types or [])
        if regulator.strip()
    }
    regulators_for_logs = sorted(set(regulator_counts.keys()) | expected_regulators)

    if args.stdout:
        print(to_json(deduped))
        return RunSummary(
            jurisdiction=jurisdiction,
            extracted_count=len(deduped),
            regulator_counts=dict(regulator_counts),
            sql_snapshot_path=None,
            refresh_log_sql_path=None,
        )

    extracted_utc = datetime.now(tz=timezone.utc)
    source_url = ", ".join(sorted(set(source_urls)))
    sql_root = args.sql_output_dir or (DEFAULT_SQL_ROOT / jurisdiction.lower())
    snapshot_path = sql_root / "conveyancers.sql"
    refresh_log_snapshot_path = sql_root / "conveyancer_refresh_log.sql"

    write_conveyancers_snapshot_sql(
        destination=snapshot_path,
        jurisdiction=jurisdiction,
        source_url=source_url,
        extracted_utc=extracted_utc,
        records=deduped,
    )
    write_refresh_log_snapshot_sql(
        destination=refresh_log_snapshot_path,
        source_url=source_url,
        extracted_utc=extracted_utc,
    )
    logger.info("Wrote SQL snapshots: %s, %s", snapshot_path, refresh_log_snapshot_path)

    if args.dry_run:
        logger.info("Dry-run mode enabled: skipped Postgres upsert.")
        return RunSummary(
            jurisdiction=jurisdiction,
            extracted_count=len(deduped),
            regulator_counts=dict(regulator_counts),
            sql_snapshot_path=snapshot_path,
            refresh_log_sql_path=refresh_log_snapshot_path,
        )

    db = DatabaseClient(args.connection)
    with db.connect() as conn:
        db.ensure_schema(conn)
        conn.commit()

        logs_by_regulator: dict[str, str] = {}
        for regulator_type in regulators_for_logs:
            log_id = db.start_refresh_log(
                conn,
                jurisdiction=jurisdiction,
                regulator_type=regulator_type,
                extracted_sql_path=str(snapshot_path),
                started_utc=extracted_utc,
            )
            logs_by_regulator[regulator_type] = str(log_id)
        conn.commit()

        try:
            result = db.upsert_records(
                conn,
                deduped,
                extracted_utc=extracted_utc,
                expected_scopes=[
                    (jurisdiction, regulator_type) for regulator_type in expected_regulators
                ],
            )
            conn.commit()
            for regulator_type in regulators_for_logs:
                db.complete_refresh_log(
                    conn,
                    log_id=_parse_uuid(logs_by_regulator[regulator_type]),
                    status="succeeded",
                    record_count=regulator_counts.get(regulator_type, 0),
                    error_message=None,
                    extracted_sql_path=str(snapshot_path),
                    completed_utc=datetime.now(tz=timezone.utc),
                )
            conn.commit()
            logger.info(
                "Upsert complete for %s: %s records (deactivated=%s)",
                jurisdiction,
                result.upserted_count,
                result.deactivated_count,
            )
        except Exception as error:
            conn.rollback()
            for regulator_type in regulators_for_logs:
                db.complete_refresh_log(
                    conn,
                    log_id=_parse_uuid(logs_by_regulator[regulator_type]),
                    status="failed",
                    record_count=0,
                    error_message=str(error),
                    extracted_sql_path=str(snapshot_path),
                    completed_utc=datetime.now(tz=timezone.utc),
                )
            conn.commit()
            raise

    return RunSummary(
        jurisdiction=jurisdiction,
        extracted_count=len(deduped),
        regulator_counts=dict(regulator_counts),
        sql_snapshot_path=snapshot_path,
        refresh_log_sql_path=refresh_log_snapshot_path,
    )


def emit_summary(summary: RunSummary) -> None:
    payload = {
        "jurisdiction": summary.jurisdiction,
        "extracted_count": summary.extracted_count,
        "regulator_counts": summary.regulator_counts,
        "sql_snapshot_path": str(summary.sql_snapshot_path) if summary.sql_snapshot_path else None,
        "refresh_log_sql_path": str(summary.refresh_log_sql_path) if summary.refresh_log_sql_path else None,
    }
    print(payload)


def _parse_uuid(value: str):
    import uuid

    return uuid.UUID(value)
