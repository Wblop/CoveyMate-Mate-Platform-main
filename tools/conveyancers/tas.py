from __future__ import annotations

from html import unescape
import re
import ssl
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.logging import get_logger
from lib.normalize import ConveyancerRecord, dedupe_records, make_record, safe_text
from lib.runtime import build_common_parser, persist_records, to_common_args


JURISDICTION = "TAS"
REGULATOR_TYPE = "industry_association"
DIRECTORY_URL = "http://aictas.com.au/Find-A-Conveyancer.php"
SOURCE_URLS = [DIRECTORY_URL]
EXPECTED_REGULATOR_TYPES = [REGULATOR_TYPE, "law_society"]

HTTP_ATTEMPTS = 3
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
PHONE_RE = re.compile(
    r"(?:\+?61\s?\d[\d\s]{7,}|(?:\(?0\d\)?\s?\d{2,4}\s?\d{2,4}\s?\d{2,4})|(?:0\d{9,10}))"
)

_FORCE_INSECURE_TLS = False
_WARNED_INSECURE_TLS = False


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


def _request_html(*, timeout_seconds: int, logger) -> str:
    global _FORCE_INSECURE_TLS
    global _WARNED_INSECURE_TLS

    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
            request = Request(url=DIRECTORY_URL, method="GET", headers=headers)
            with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
                return response.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            if not _FORCE_INSECURE_TLS and _is_tls_verification_error(error):
                _FORCE_INSECURE_TLS = True
                if not _WARNED_INSECURE_TLS:
                    logger.warning(
                        "TLS verification failed for %s. Switching to insecure TLS for TAS requests.",
                        DIRECTORY_URL,
                    )
                    _WARNED_INSECURE_TLS = True
                continue

            if attempt >= HTTP_ATTEMPTS:
                raise RuntimeError(f"TAS directory request failed: {error}") from error

            sleep_seconds = min(2 * attempt, 6)
            logger.warning(
                "Retrying TAS directory request (%s/%s): %s",
                attempt,
                HTTP_ATTEMPTS,
                error,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError("TAS directory request exhausted retries.")


def _extract_website(panel) -> str:
    for link in panel.select("a[href]"):
        href = safe_text(link.get("href") or "")
        if not href:
            continue
        lowered = href.casefold()
        if lowered.startswith("mailto:"):
            continue
        if lowered.startswith("http://") or lowered.startswith("https://"):
            if "google.com/maps" in lowered:
                continue
            return href
    return ""


def _extract_email(text: str) -> str:
    match = EMAIL_RE.search(text or "")
    return safe_text(match.group(0).lower()) if match else ""


def _extract_phone(lines: list[str]) -> str:
    candidates: list[str] = []
    for line in lines:
        lowered = line.casefold()
        if not any(prefix in lowered for prefix in ("tel", "phone", "mob", "mobile")):
            continue
        for match in PHONE_RE.findall(line):
            value = safe_text(match)
            if value:
                candidates.append(value)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = re.sub(r"\D+", "", candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)

    return " / ".join(deduped)


def _extract_address(lines: list[str]) -> str:
    address_lines: list[str] = []
    for line in lines:
        lowered = line.casefold()
        if any(tag in lowered for tag in ("email:", "web:", "tel:", "fax:", "mob:", "mobile:")):
            continue
        value = safe_text(line.replace("Postal Address:", "Postal").replace("Postal address:", "Postal"))
        if value:
            address_lines.append(value)
    return safe_text(", ".join(address_lines))


def scrape_tas_records(*, timeout_seconds: int, logger) -> list[ConveyancerRecord]:
    html = _request_html(timeout_seconds=timeout_seconds, logger=logger)
    soup = BeautifulSoup(html, "html.parser")

    panels = soup.select("div.Panel_Default")
    leaf_panels = [panel for panel in panels if not panel.select("div.Panel_Default")]
    logger.info("TAS candidate panels discovered: %s (leaf=%s)", len(panels), len(leaf_panels))

    records: list[ConveyancerRecord] = []
    for panel in leaf_panels:
        heading = panel.select_one("h4")
        if heading is None:
            continue

        firm_name = safe_text(unescape(heading.get_text(" ", strip=True)))
        if not firm_name:
            continue
        if "copyright" in firm_name.casefold():
            continue

        text_lines: list[str] = []
        for p in panel.select("p"):
            chunk = safe_text(unescape(p.get_text("\n", strip=True)))
            if not chunk:
                continue
            for line in chunk.split("\n"):
                line = safe_text(line)
                if line:
                    text_lines.append(line)

        website = _extract_website(panel)
        email = _extract_email(" \n ".join(text_lines))
        phone = _extract_phone(text_lines)
        address = _extract_address(text_lines)

        records.append(
            make_record(
                jurisdiction=JURISDICTION,
                regulator_type=REGULATOR_TYPE,
                name=firm_name,
                organization_name=firm_name,
                contact_name="",
                address=address,
                phone=phone,
                email=email,
                website=website,
                areas_of_practice=["Conveyancing"],
                source_url=DIRECTORY_URL,
            )
        )

    deduped = dedupe_records(records)
    if not deduped:
        raise RuntimeError("No TAS conveyancer records extracted from AIC Tasmania page.")

    logger.info("TAS extraction complete: %s record(s)", len(deduped))
    return deduped


def parse_args():
    parser = build_common_parser("Scrape TAS conveyancer directory and seed Postgres.")
    return to_common_args(parser.parse_args())


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.tas")
    logger.info("Starting TAS scraper (AIC Tasmania Find A Conveyancer)")

    records = scrape_tas_records(timeout_seconds=args.timeout_seconds, logger=logger)

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=SOURCE_URLS,
        expected_regulator_types=EXPECTED_REGULATOR_TYPES,
    )

    logger.info("TAS scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
