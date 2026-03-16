from __future__ import annotations

from dataclasses import dataclass
from html import unescape
import json
import ssl
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.logging import get_logger
from lib.normalize import ConveyancerRecord, dedupe_records, make_record, safe_text
from lib.runtime import build_common_parser, persist_records, to_common_args


JURISDICTION = "WA"
REGULATOR_TYPE = "industry_association"
DIRECTORY_URL = "https://www.findasettlementagent.com.au"
SEARCH_URL = "https://www.findasettlementagent.com.au/wp-admin/admin-ajax.php"
HTTP_ATTEMPTS = 3

SOURCE_URLS = [DIRECTORY_URL, SEARCH_URL]
EXPECTED_REGULATOR_TYPES = [REGULATOR_TYPE, "consumer_protection", "legal_practice_board"]

_FORCE_INSECURE_TLS = False
_WARNED_INSECURE_TLS = False


@dataclass(frozen=True)
class WaSeed:
    label: str
    lat: float
    lng: float
    radius_km: int


SEEDS: tuple[WaSeed, ...] = (
    WaSeed("Perth WA", -31.9514, 115.86168, 120),
    WaSeed("Joondalup WA", -31.7440, 115.7664, 120),
    WaSeed("Fremantle WA", -32.0569, 115.7439, 120),
    WaSeed("Leederville WA", -31.9365, 115.8419, 120),
    WaSeed("Subiaco WA", -31.9482, 115.8245, 120),
    WaSeed("Yanchep WA", -31.5467, 115.6329, 140),
    WaSeed("Rockingham WA", -32.2813, 115.7276, 120),
    WaSeed("Armadale WA", -32.1530, 116.0150, 120),
    WaSeed("Mandurah WA", -32.5269, 115.7217, 120),
    WaSeed("Bunbury WA", -33.3271, 115.6414, 120),
    WaSeed("Busselton WA", -33.6555, 115.3493, 120),
    WaSeed("Dunsborough WA", -33.6151, 115.1040, 120),
    WaSeed("Margaret River WA", -33.9550, 115.0750, 160),
    WaSeed("Albany WA", -35.0247, 117.8835, 160),
    WaSeed("Geraldton WA", -28.7774, 114.6146, 200),
    WaSeed("Kalgoorlie WA", -30.7489, 121.4658, 220),
    WaSeed("Esperance WA", -33.8608, 121.8896, 220),
    WaSeed("Broome WA", -17.9614, 122.2359, 240),
)


def _is_tls_verification_error(error: Exception) -> bool:
    if isinstance(error, ssl.SSLCertVerificationError):
        return True
    if isinstance(error, URLError):
        reason = getattr(error, "reason", None)
        if isinstance(reason, ssl.SSLCertVerificationError):
            return True
        if isinstance(reason, ssl.SSLError):
            return "CERTIFICATE_VERIFY_FAILED" in str(reason).upper()
    return "CERTIFICATE_VERIFY_FAILED" in str(error).upper()


def _request_json(*, seed: WaSeed, timeout_seconds: int, logger) -> list[dict[str, Any]]:
    global _FORCE_INSECURE_TLS
    global _WARNED_INSECURE_TLS

    params = {
        "action": "store_search",
        "lat": str(seed.lat),
        "lng": str(seed.lng),
        "max_results": "500",
        "search_radius": str(seed.radius_km),
        "search": seed.label,
        "statistics[region]": "Western Australia",
        "statistics[country]": "Australia",
    }
    url = f"{SEARCH_URL}?{urlencode(params)}"
    headers = {
        "accept": "application/json,text/javascript,*/*;q=0.1",
        "referer": DIRECTORY_URL,
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
        ),
    }

    for attempt in range(1, HTTP_ATTEMPTS + 1):
        ssl_context: ssl.SSLContext = (
            ssl._create_unverified_context()
            if _FORCE_INSECURE_TLS
            else ssl.create_default_context()
        )
        try:
            request = Request(url=url, method="GET", headers=headers)
            with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
                payload = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(payload)
            if not isinstance(parsed, list):
                raise RuntimeError(
                    f"Unexpected WA payload type for '{seed.label}': {type(parsed).__name__}"
                )
            return [item for item in parsed if isinstance(item, dict)]
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            if not _FORCE_INSECURE_TLS and _is_tls_verification_error(error):
                _FORCE_INSECURE_TLS = True
                if not _WARNED_INSECURE_TLS:
                    logger.warning(
                        "TLS verification failed for %s. Switching to insecure TLS for WA requests.",
                        SEARCH_URL,
                    )
                    _WARNED_INSECURE_TLS = True
                continue

            if attempt >= HTTP_ATTEMPTS:
                raise RuntimeError(f"WA request failed for '{seed.label}': {error}") from error

            sleep_seconds = min(2 * attempt, 6)
            logger.warning(
                "Retrying WA request (%s/%s) for %s: %s",
                attempt,
                HTTP_ATTEMPTS,
                seed.label,
                error,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError(f"WA request exhausted retries for '{seed.label}'.")


def _decode(value: Any) -> str:
    return safe_text(unescape(str(value or "")))


def _build_address(row: dict[str, Any]) -> str:
    parts = [
        _decode(row.get("address")),
        _decode(row.get("address2")),
        _decode(row.get("city")),
        _decode(row.get("state")),
        _decode(row.get("zip")),
    ]
    return safe_text(", ".join(part for part in parts if part))


def _normalize_website(value: str) -> str:
    cleaned = _decode(value)
    if not cleaned:
        return ""
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        return cleaned
    return f"https://{cleaned}"


def scrape_wa_records(*, timeout_seconds: int, logger) -> list[ConveyancerRecord]:
    by_id: dict[str, dict[str, Any]] = {}

    for seed in SEEDS:
        rows = _request_json(seed=seed, timeout_seconds=timeout_seconds, logger=logger)
        logger.info("WA seed '%s' returned %s row(s).", seed.label, len(rows))
        for row in rows:
            row_id = _decode(row.get("id"))
            if not row_id:
                continue
            by_id[row_id] = row

    if not by_id:
        raise RuntimeError("No WA listings extracted from findasettlementagent endpoint.")

    records: list[ConveyancerRecord] = []
    for row_id, row in sorted(by_id.items(), key=lambda item: _decode(item[1].get("store")).casefold()):
        firm_name = _decode(row.get("store"))
        if not firm_name:
            continue

        records.append(
            make_record(
                jurisdiction=JURISDICTION,
                regulator_type=REGULATOR_TYPE,
                name=firm_name,
                organization_name=firm_name,
                contact_name="",
                address=_build_address(row),
                phone=_decode(row.get("phone")),
                email=_decode(row.get("email")).lower(),
                website=_normalize_website(_decode(row.get("url"))),
                areas_of_practice=["Conveyancing", "Settlement Agency"],
                source_url=DIRECTORY_URL,
                source_identifier=f"wa-fasa-{row_id}",
            )
        )

    deduped = dedupe_records(records)
    logger.info("WA extraction complete: %s unique record(s) across %s seed(s).", len(deduped), len(SEEDS))
    return deduped


def parse_args():
    parser = build_common_parser("Scrape WA settlement-agent directory and seed Postgres.")
    return to_common_args(parser.parse_args())


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.wa")
    logger.info("Starting WA scraper (findasettlementagent endpoint)")

    records = scrape_wa_records(timeout_seconds=args.timeout_seconds, logger=logger)

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=SOURCE_URLS,
        expected_regulator_types=EXPECTED_REGULATOR_TYPES,
    )

    logger.info("WA scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
