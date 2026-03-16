from __future__ import annotations

import argparse
from dataclasses import dataclass
import importlib
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.jurisdiction_runner import scrape_sources_with_playwright
from lib.logging import get_logger
from lib.runtime import CommonArgs, build_common_parser, persist_records, to_common_args


DEFAULT_JURISDICTIONS = ["ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"]
MODULE_BY_JURISDICTION = {
    "ACT": "act",
    "NSW": "nsw",
    "VIC": "vic",
    "QLD": "qld",
    "WA": "wa",
    "SA": "sa",
    "TAS": "tas",
    "NT": "nt",
}


@dataclass(frozen=True)
class JurisdictionRun:
    jurisdiction: str
    extracted_count: int
    failed: bool
    error_message: str | None



def parse_args() -> tuple[CommonArgs, list[str]]:
    parser = build_common_parser("Run all conveyancer jurisdiction scrapers sequentially.")
    parser.add_argument(
        "--jurisdictions",
        default=",".join(DEFAULT_JURISDICTIONS),
        help="Comma-separated subset, e.g. ACT,NSW,VIC",
    )
    namespace = parser.parse_args()

    requested = [part.strip().upper() for part in namespace.jurisdictions.split(",") if part.strip()]
    invalid = [jurisdiction for jurisdiction in requested if jurisdiction not in MODULE_BY_JURISDICTION]
    if invalid:
        raise argparse.ArgumentTypeError(f"Unknown jurisdiction(s): {', '.join(invalid)}")

    return to_common_args(namespace), requested or DEFAULT_JURISDICTIONS


def main() -> int:
    args, jurisdictions = parse_args()
    logger = get_logger("conveyancers.refresh_all")
    logger.info("Starting refresh for jurisdictions: %s", ", ".join(jurisdictions))

    runs: list[JurisdictionRun] = []

    for jurisdiction in jurisdictions:
        module_name = MODULE_BY_JURISDICTION[jurisdiction]
        module = importlib.import_module(module_name)
        logger.info("Running %s via %s.py", jurisdiction, module_name)

        try:
            if jurisdiction == "ACT":
                records = module.scrape_act_records(
                    headless=args.headless,
                    timeout_seconds=args.timeout_seconds,
                    debug_dump_dir=args.debug_dump_dir / "act",
                )
                source_urls = [module.URL]
                expected_regulator_types = [module.REGULATOR_TYPE]
            elif jurisdiction == "NSW":
                records, expected_regulator_types = module.scrape_nsw_records(
                    args=args,
                    logger=get_logger("conveyancers.nsw"),
                )
                source_urls = list(module.SOURCE_URLS)
            elif jurisdiction == "QLD":
                records = module.scrape_qld_records(
                    headless=args.headless,
                    timeout_seconds=args.timeout_seconds,
                    debug_dump_dir=args.debug_dump_dir / "qld",
                )
                source_urls = list(module.SOURCE_URLS)
                expected_regulator_types = list(module.EXPECTED_REGULATOR_TYPES)
            elif jurisdiction == "VIC":
                records = module.scrape_vic_records(
                    timeout_seconds=args.timeout_seconds,
                    logger=get_logger("conveyancers.vic"),
                )
                source_urls = list(module.SOURCE_URLS)
                expected_regulator_types = list(module.EXPECTED_REGULATOR_TYPES)
            elif jurisdiction == "SA":
                records = module.scrape_sa_records(
                    timeout_seconds=args.timeout_seconds,
                    logger=get_logger("conveyancers.sa"),
                )
                source_urls = list(module.SOURCE_URLS)
                expected_regulator_types = list(module.EXPECTED_REGULATOR_TYPES)
            elif jurisdiction == "WA":
                records = module.scrape_wa_records(
                    timeout_seconds=args.timeout_seconds,
                    logger=get_logger("conveyancers.wa"),
                )
                source_urls = list(module.SOURCE_URLS)
                expected_regulator_types = list(module.EXPECTED_REGULATOR_TYPES)
            elif jurisdiction == "NT":
                records = module.scrape_nt_records(
                    timeout_seconds=args.timeout_seconds,
                    logger=get_logger("conveyancers.nt"),
                )
                source_urls = list(module.SOURCE_URLS)
                expected_regulator_types = list(module.EXPECTED_REGULATOR_TYPES)
            elif jurisdiction == "TAS":
                records = module.scrape_tas_records(
                    timeout_seconds=args.timeout_seconds,
                    logger=get_logger("conveyancers.tas"),
                )
                source_urls = list(module.SOURCE_URLS)
                expected_regulator_types = list(module.EXPECTED_REGULATOR_TYPES)
            else:
                records = scrape_sources_with_playwright(
                    jurisdiction=module.JURISDICTION,
                    sources=module.SOURCES,
                    headless=args.headless,
                    timeout_seconds=args.timeout_seconds,
                    debug_dump_dir=args.debug_dump_dir / jurisdiction.lower(),
                    logger=get_logger(f"conveyancers.{jurisdiction.lower()}"),
                )
                source_urls = [source.root_url for source in module.SOURCES]
                expected_regulator_types = [source.regulator_type for source in module.SOURCES]

            summary = persist_records(
                args=args,
                jurisdiction=jurisdiction,
                records=records,
                source_urls=source_urls,
                expected_regulator_types=expected_regulator_types,
            )
            runs.append(
                JurisdictionRun(
                    jurisdiction=jurisdiction,
                    extracted_count=summary.extracted_count,
                    failed=False,
                    error_message=None,
                )
            )
        except Exception as error:  # pragma: no cover - runtime resilience path
            logger.exception("Jurisdiction %s failed: %s", jurisdiction, error)
            runs.append(
                JurisdictionRun(
                    jurisdiction=jurisdiction,
                    extracted_count=0,
                    failed=True,
                    error_message=str(error),
                )
            )

    succeeded = [run for run in runs if not run.failed]
    failed = [run for run in runs if run.failed]

    print("\nConveyancer refresh summary")
    print("==========================")
    for run in runs:
        status = "FAILED" if run.failed else "OK"
        suffix = f" - {run.error_message}" if run.error_message else ""
        print(f"{run.jurisdiction}: {status} ({run.extracted_count} records){suffix}")

    print("--------------------------")
    print(f"Succeeded: {len(succeeded)}")
    print(f"Failed: {len(failed)}")
    print(f"Total records extracted: {sum(run.extracted_count for run in succeeded)}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
