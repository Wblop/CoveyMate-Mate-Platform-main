from __future__ import annotations

import re
import ssl
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup, Tag

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.logging import get_logger
from lib.normalize import ConveyancerRecord, dedupe_records, make_record, safe_text
from lib.runtime import build_common_parser, persist_records, to_common_args


JURISDICTION = "SA"
REGULATOR_TYPE = "industry_association"
DIRECTORY_URL = "https://aicsa.com.au/find-a-conveyancer/"
SEARCH_URL = "https://mb-embed.aicsa.com.au/_profiledirectories/search"
EMBED_ORIGIN = "https://mb-embed.aicsa.com.au"
HTTP_ATTEMPTS = 3

SOURCE_URLS = [DIRECTORY_URL, SEARCH_URL]
EXPECTED_REGULATOR_TYPES = [REGULATOR_TYPE, "consumer_business_services", "law_society"]

SEARCH_PAYLOAD: dict[str, str] = {
    "directoryID": "124",
    "filterIDs": "2492,1729,1733",
    "searchsystem.firstname": "",
    "searchsystem.surname": "",
    "kms": "5000",
    "address": "3000",
    "country": "Australia",
}

_FORCE_INSECURE_TLS = False
_WARNED_INSECURE_TLS = False
EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)


@dataclass(frozen=True)
class SaListing:
    profile_id: str
    source_url: str
    contact_name: str
    firm_name: str
    address: str
    phone: str
    email: str
    website: str
    areas_of_practice: list[str]


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


def _request_search_html(*, timeout_seconds: int, logger) -> str:
    global _FORCE_INSECURE_TLS
    global _WARNED_INSECURE_TLS

    encoded = urlencode(SEARCH_PAYLOAD).encode("utf-8")
    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "origin": EMBED_ORIGIN,
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
            request = Request(url=SEARCH_URL, method="POST", headers=headers, data=encoded)
            with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
                return response.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            if not _FORCE_INSECURE_TLS and _is_tls_verification_error(error):
                _FORCE_INSECURE_TLS = True
                if not _WARNED_INSECURE_TLS:
                    logger.warning(
                        "TLS verification failed for %s. Switching to insecure TLS for SA requests.",
                        SEARCH_URL,
                    )
                    _WARNED_INSECURE_TLS = True
                continue

            if attempt >= HTTP_ATTEMPTS:
                raise RuntimeError(f"SA request failed (POST {SEARCH_URL}): {error}") from error

            sleep_seconds = min(2 * attempt, 6)
            logger.warning(
                "Retrying SA request (%s/%s): POST %s -> %s",
                attempt,
                HTTP_ATTEMPTS,
                SEARCH_URL,
                error,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError("SA request exhausted retries.")


def _extract_definition_value(dt: Tag) -> str:
    dd = dt.find_next_sibling("dd")
    if dd is None:
        return ""
    link = dd.select_one("a[href]")
    if link is not None:
        href = safe_text(link.get("href") or "")
        if href.startswith("mailto:"):
            return safe_text(href.replace("mailto:", "").split("?", 1)[0])
        if href and href != "#":
            return href
    return safe_text(dd.get_text(" ", strip=True))


def _extract_specialising(raw: str) -> list[str]:
    parts = [safe_text(part) for part in re.split(r"[;,]", raw or "")]
    out: list[str] = []
    seen: set[str] = set()
    for value in parts:
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def _extract_first_email(raw: str) -> str:
    matches = EMAIL_PATTERN.findall(raw or "")
    if matches:
        return safe_text(matches[0].lower())
    return safe_text((raw or "").split(";", 1)[0]).lower()


def _extract_profile_id(href: str) -> str:
    match = re.search(r"/id/(\d+)/", href)
    if match:
        return match.group(1)
    return ""


def _build_source_identifier(profile_id: str, firm_name: str, contact_name: str) -> str:
    if profile_id:
        return f"sa-aicsa-{profile_id}"
    seed = safe_text(firm_name or contact_name).casefold()
    slug = re.sub(r"[^a-z0-9]+", "-", seed).strip("-")
    slug = slug or "listing"
    return f"sa-aicsa-{slug}"


def _extract_listings(html: str, logger) -> tuple[list[SaListing], int | None]:
    soup = BeautifulSoup(html, "html.parser")
    count_match = re.search(r"Found\s+(\d+)\s+within", soup.get_text(" ", strip=True), re.IGNORECASE)
    reported_count = int(count_match.group(1)) if count_match else None

    cards = soup.select("#directory-results > .well")
    if not cards:
        cards = soup.select(".well")

    listings: list[SaListing] = []
    for card in cards:
        left = card.select_one(".col-md-2")
        right = card.select_one(".col-md-9")
        if left is None:
            continue

        contact_name = safe_text(left.select_one("h2").get_text(" ", strip=True) if left.select_one("h2") else "")
        firm_name = safe_text(left.select_one("h3").get_text(" ", strip=True) if left.select_one("h3") else "")
        if not firm_name and not contact_name:
            continue

        address_lines = [
            safe_text(line.get_text(" ", strip=True))
            for line in left.select("p")
            if safe_text(line.get_text(" ", strip=True))
        ]
        address = safe_text(", ".join(address_lines))

        details: dict[str, str] = {}
        if right is not None:
            for dt in right.select("dt"):
                key = safe_text(dt.get_text(" ", strip=True)).rstrip(":").casefold()
                if not key:
                    continue
                details[key] = _extract_definition_value(dt)

        phone = safe_text(details.get("phone") or "")
        mobile = safe_text(details.get("mobile") or "")
        if phone and mobile and mobile.casefold() not in phone.casefold():
            phone = f"{phone} / {mobile}"
        elif not phone:
            phone = mobile

        email = _extract_first_email(details.get("email") or "")
        website = safe_text(details.get("company website") or "")

        if website.startswith("mailto:"):
            website = ""

        areas = _extract_specialising(details.get("specialising in") or "")
        if not areas:
            areas = ["Conveyancing"]

        source_url = DIRECTORY_URL
        profile_id = ""
        more_link = card.select_one(".directory-listing-buttons a[href*='/_profiledirectories/fulllisting/id/']")
        if more_link is not None:
            href = safe_text(more_link.get("href") or "")
            if href:
                source_url = urljoin(EMBED_ORIGIN, href)
                profile_id = _extract_profile_id(href)

        listings.append(
            SaListing(
                profile_id=profile_id,
                source_url=source_url,
                contact_name=contact_name,
                firm_name=firm_name,
                address=address,
                phone=phone,
                email=email,
                website=website,
                areas_of_practice=areas,
            )
        )

    deduped: list[SaListing] = []
    seen: set[str] = set()
    for listing in listings:
        key = _build_source_identifier(listing.profile_id, listing.firm_name, listing.contact_name)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(listing)

    logger.info(
        "SA AICSA search parsed %s listing(s)%s.",
        len(deduped),
        f" (reported {reported_count})" if reported_count is not None else "",
    )
    return deduped, reported_count


def scrape_sa_records(*, timeout_seconds: int, logger) -> list[ConveyancerRecord]:
    html = _request_search_html(timeout_seconds=timeout_seconds, logger=logger)
    listings, reported_count = _extract_listings(html, logger=logger)
    if not listings:
        raise RuntimeError("No SA conveyancer listings extracted from AICSA search payload.")

    records: list[ConveyancerRecord] = []
    for listing in listings:
        organization_name = safe_text(listing.firm_name or listing.contact_name)
        contact_name = safe_text(listing.contact_name)
        if contact_name and organization_name and contact_name.casefold() == organization_name.casefold():
            contact_name = ""

        records.append(
            make_record(
                jurisdiction=JURISDICTION,
                regulator_type=REGULATOR_TYPE,
                name=organization_name or contact_name,
                organization_name=organization_name,
                contact_name=contact_name,
                address=listing.address,
                phone=listing.phone,
                email=listing.email,
                website=listing.website,
                areas_of_practice=listing.areas_of_practice,
                source_url=listing.source_url,
                source_identifier=_build_source_identifier(
                    listing.profile_id,
                    listing.firm_name,
                    listing.contact_name,
                ),
            )
        )

    deduped = dedupe_records(records)
    if reported_count is not None and len(deduped) != reported_count:
        logger.warning(
            "SA extracted %s rows but search payload reported %s.",
            len(deduped),
            reported_count,
        )

    logger.info("SA extraction complete: %s record(s)", len(deduped))
    return deduped


def parse_args():
    parser = build_common_parser("Scrape SA conveyancer directory and seed Postgres.")
    return to_common_args(parser.parse_args())


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.sa")
    logger.info("Starting SA scraper (AICSA Find a Conveyancer)")

    records = scrape_sa_records(timeout_seconds=args.timeout_seconds, logger=logger)

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=SOURCE_URLS,
        expected_regulator_types=EXPECTED_REGULATOR_TYPES,
    )

    logger.info("SA scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
