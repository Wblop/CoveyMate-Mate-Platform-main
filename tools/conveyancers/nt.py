from __future__ import annotations

from dataclasses import dataclass
from html import unescape
import json
import re
import ssl
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.logging import get_logger
from lib.normalize import ConveyancerRecord, dedupe_records, make_record, safe_text
from lib.runtime import build_common_parser, persist_records, to_common_args


JURISDICTION = "NT"
REGULATOR_TYPE = "industry_association"
DIRECTORY_URL = "https://aicntconveyancers.com.au/find-a-conveyancer/"
AJAX_URL = "https://aicntconveyancers.com.au/wp-admin/admin-ajax.php"
SOURCE_URLS = [DIRECTORY_URL, AJAX_URL]
EXPECTED_REGULATOR_TYPES = [REGULATOR_TYPE, "law_society"]

HTTP_ATTEMPTS = 3
REQUEST_SLEEP_SECONDS = 0.1
MAX_PAGES = 100
GMT_OFFSET = "9.5"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)

_FORCE_INSECURE_TLS = False
_WARNED_INSECURE_TLS = False


@dataclass(frozen=True)
class NtDirectoryBootstrap:
    directory_id: str
    base_post: str
    nonce: str


@dataclass(frozen=True)
class NtListing:
    display_name: str
    business_name: str
    suburb: str
    profile_url: str


@dataclass(frozen=True)
class NtProfile:
    business_name: str
    address: str
    phone: str
    email: str
    website: str


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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


def _request_text(
    *,
    url: str,
    method: str,
    timeout_seconds: int,
    logger,
    form_data: dict[str, Any] | None = None,
) -> str:
    global _FORCE_INSECURE_TLS
    global _WARNED_INSECURE_TLS

    headers = {
        "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT,
    }

    encoded_data = None
    if form_data is not None:
        headers.update(
            {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
                "origin": "https://aicntconveyancers.com.au",
                "referer": DIRECTORY_URL,
            }
        )
        encoded_data = urlencode(form_data).encode("utf-8")

    for attempt in range(1, HTTP_ATTEMPTS + 1):
        ssl_context: ssl.SSLContext = (
            ssl._create_unverified_context()
            if _FORCE_INSECURE_TLS
            else ssl.create_default_context()
        )
        try:
            request = Request(url=url, method=method.upper(), headers=headers, data=encoded_data)
            with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
                return response.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            if not _FORCE_INSECURE_TLS and _is_tls_verification_error(error):
                _FORCE_INSECURE_TLS = True
                if not _WARNED_INSECURE_TLS:
                    logger.warning(
                        "TLS verification failed for %s. Switching to insecure TLS for NT HTTP requests.",
                        url,
                    )
                    _WARNED_INSECURE_TLS = True
                continue

            if attempt >= HTTP_ATTEMPTS:
                raise RuntimeError(f"NT request failed ({method} {url}): {error}") from error

            sleep_seconds = min(2 * attempt, 6)
            logger.warning(
                "Retrying NT request (%s/%s): %s %s -> %s",
                attempt,
                HTTP_ATTEMPTS,
                method.upper(),
                url,
                error,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError(f"NT request exhausted retries ({method} {url})")


def _html_to_text(value: Any) -> str:
    raw = safe_text(str(value or ""))
    if not raw:
        return ""
    if "<" in raw and ">" in raw:
        raw = safe_text(BeautifulSoup(raw, "html.parser").get_text(" ", strip=True))
    return safe_text(unescape(raw))


def _extract_bootstrap(html: str) -> NtDirectoryBootstrap:
    soup = BeautifulSoup(html, "html.parser")
    directory = soup.select_one("div.um.um-directory[data-hash][data-base-post]")
    if directory is None:
        raise RuntimeError("NT directory bootstrap element not found on Find a Conveyancer page.")

    directory_id = safe_text(directory.get("data-hash") or "")
    base_post = safe_text(directory.get("data-base-post") or "")
    if not directory_id or not base_post:
        raise RuntimeError("NT directory bootstrap missing data-hash or data-base-post.")

    nonce = ""
    script_match = re.search(r"var\s+um_scripts\s*=\s*(\{.*?\});", html, flags=re.DOTALL)
    if script_match:
        payload = json.loads(script_match.group(1))
        nonce = safe_text(str(payload.get("nonce") or ""))

    if not nonce:
        fallback = re.search(r'"nonce"\s*:\s*"([A-Za-z0-9_-]{8,})"', html)
        if fallback:
            nonce = safe_text(fallback.group(1))

    if not nonce:
        raise RuntimeError("Could not find NT Ultimate Member nonce.")

    return NtDirectoryBootstrap(directory_id=directory_id, base_post=base_post, nonce=nonce)


def _fetch_members_page(
    *,
    bootstrap: NtDirectoryBootstrap,
    page_number: int,
    timeout_seconds: int,
    logger,
) -> dict[str, Any]:
    payload = {
        "directory_id": bootstrap.directory_id,
        "page": page_number,
        "search": "",
        "sorting": "",
        "gmt_offset": GMT_OFFSET,
        "post_refferer": bootstrap.base_post,
        "nonce": bootstrap.nonce,
        "action": "um_get_members",
    }

    raw = _request_text(
        url=AJAX_URL,
        method="POST",
        timeout_seconds=timeout_seconds,
        form_data=payload,
        logger=logger,
    )

    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Unexpected NT response type for page {page_number}: {type(parsed).__name__}")
    if not bool(parsed.get("success")):
        raise RuntimeError(f"NT members API returned success=false on page {page_number}.")

    data = parsed.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"NT members API missing data object on page {page_number}.")

    return data


def _extract_listings(page_data: dict[str, Any]) -> list[NtListing]:
    users = page_data.get("users")
    if not isinstance(users, list):
        return []

    listings: list[NtListing] = []
    for user in users:
        if not isinstance(user, dict):
            continue

        profile_url = safe_text(urljoin(DIRECTORY_URL, str(user.get("profile_url") or "")))
        if not profile_url:
            continue

        display_name = _html_to_text(user.get("display_name_html") or user.get("display_name"))
        business_name = _html_to_text(user.get("business_name"))
        suburb = _html_to_text(user.get("suburb"))

        listings.append(
            NtListing(
                display_name=display_name,
                business_name=business_name,
                suburb=suburb,
                profile_url=profile_url,
            )
        )

    return listings


def _extract_field_value(soup: BeautifulSoup, key: str) -> str:
    node = soup.select_one(f".um-field[data-key='{key}'] .um-field-value")
    if node is None:
        return ""
    return safe_text(node.get_text(" ", strip=True))


def _extract_field_link(soup: BeautifulSoup, key: str, *, href_prefix: str | None = None) -> str:
    node = soup.select_one(f".um-field[data-key='{key}'] .um-field-value")
    if node is None:
        return ""

    for link in node.select("a[href]"):
        href = safe_text(link.get("href") or "")
        if not href:
            continue
        if href_prefix and not href.casefold().startswith(href_prefix.casefold()):
            continue

        if href_prefix:
            value = unquote(href[len(href_prefix) :]).split("?", 1)[0]
            value = safe_text(value)
            if not value:
                value = safe_text(link.get_text(" ", strip=True))
            return value

        return href

    if href_prefix:
        return ""
    return safe_text(node.get_text(" ", strip=True))


def _decode_cf_email(hex_value: str) -> str:
    raw = safe_text(hex_value)
    if len(raw) < 2 or len(raw) % 2 != 0:
        return ""
    try:
        key = int(raw[:2], 16)
        chars = [chr(int(raw[i : i + 2], 16) ^ key) for i in range(2, len(raw), 2)]
        return safe_text("".join(chars))
    except Exception:
        return ""


def _extract_profile_email(soup: BeautifulSoup) -> str:
    direct = _extract_field_link(soup, "user_email", href_prefix="mailto:")
    if direct:
        return direct

    encoded = soup.select_one(".um-field[data-key='user_email'] .__cf_email__[data-cfemail]")
    if encoded is not None:
        decoded = _decode_cf_email(encoded.get("data-cfemail") or "")
        if decoded:
            return decoded

    fallback = _extract_field_value(soup, "user_email")
    if "@" in fallback:
        return fallback
    return ""


def _extract_profile(listing: NtListing, profile_html: str) -> NtProfile:
    soup = BeautifulSoup(profile_html, "html.parser")

    business_name = _extract_field_value(soup, "business_name") or listing.business_name

    street_address = _extract_field_value(soup, "street_address")
    suburb = _extract_field_value(soup, "suburb") or listing.suburb
    postcode = _extract_field_value(soup, "postcode")
    locality = safe_text(" ".join(part for part in [suburb, "NT", postcode] if part))
    address = safe_text(", ".join(part for part in [street_address, locality] if part))

    phone = _extract_field_link(soup, "phone_number", href_prefix="tel:")
    if not phone:
        phone = _extract_field_value(soup, "phone_number")

    email = _extract_profile_email(soup)
    website = _extract_field_link(soup, "user_url")
    if website and not website.startswith("http://") and not website.startswith("https://"):
        website = f"https://{website}"

    return NtProfile(
        business_name=business_name,
        address=address,
        phone=phone,
        email=email,
        website=website,
    )


def _build_source_identifier(profile_url: str, business_name: str, display_name: str) -> str:
    parsed = urlparse(profile_url)
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[0].casefold() == "profile":
        slug = safe_text(parts[1]).casefold()
        if slug:
            return f"nt-aicnt-{slug}"

    seed = safe_text(business_name or display_name).casefold()
    slug = re.sub(r"[^a-z0-9]+", "-", seed).strip("-")
    slug = slug or "profile"
    return f"nt-aicnt-{slug}"


def scrape_nt_records(*, timeout_seconds: int, logger) -> list[ConveyancerRecord]:
    directory_html = _request_text(
        url=DIRECTORY_URL,
        method="GET",
        timeout_seconds=timeout_seconds,
        logger=logger,
    )
    bootstrap = _extract_bootstrap(directory_html)

    first_page_data = _fetch_members_page(
        bootstrap=bootstrap,
        page_number=1,
        timeout_seconds=timeout_seconds,
        logger=logger,
    )

    pagination = first_page_data.get("pagination")
    if not isinstance(pagination, dict):
        raise RuntimeError("NT members API pagination payload missing.")

    total_pages = _as_int(pagination.get("total_pages")) or 1
    total_users = _as_int(pagination.get("total_users"))
    total_pages = min(max(1, total_pages), MAX_PAGES)

    logger.info(
        "NT directory pagination: %s page(s), %s total user(s).",
        total_pages,
        total_users if total_users is not None else "?",
    )

    listing_by_profile: dict[str, NtListing] = {}
    for listing in _extract_listings(first_page_data):
        listing_by_profile[listing.profile_url] = listing

    for page_number in range(2, total_pages + 1):
        data = _fetch_members_page(
            bootstrap=bootstrap,
            page_number=page_number,
            timeout_seconds=timeout_seconds,
            logger=logger,
        )
        for listing in _extract_listings(data):
            listing_by_profile[listing.profile_url] = listing

        logger.info(
            "NT listing pagination progress: page %s/%s (%s unique profiles)",
            page_number,
            total_pages,
            len(listing_by_profile),
        )
        time.sleep(REQUEST_SLEEP_SECONDS)

    if not listing_by_profile:
        raise RuntimeError("No NT listings discovered from AIC NT directory API.")

    records: list[ConveyancerRecord] = []
    sorted_listings = sorted(
        listing_by_profile.values(),
        key=lambda item: (item.business_name or item.display_name).casefold(),
    )

    for index, listing in enumerate(sorted_listings, start=1):
        try:
            profile_html = _request_text(
                url=listing.profile_url,
                method="GET",
                timeout_seconds=timeout_seconds,
                logger=logger,
            )
            profile = _extract_profile(listing, profile_html)
        except Exception as error:
            logger.warning("NT profile fetch failed for %s: %s", listing.profile_url, error)
            profile = NtProfile(
                business_name=listing.business_name,
                address=safe_text(", ".join(part for part in [listing.suburb, "NT"] if part)),
                phone="",
                email="",
                website="",
            )

        contact_name = safe_text(listing.display_name)
        organization_name = safe_text(profile.business_name or listing.business_name)
        if not organization_name:
            organization_name = contact_name
            contact_name = ""
        if contact_name and contact_name.casefold() == organization_name.casefold():
            contact_name = ""

        record_name = organization_name or contact_name
        if not record_name:
            continue

        records.append(
            make_record(
                jurisdiction=JURISDICTION,
                regulator_type=REGULATOR_TYPE,
                name=record_name,
                organization_name=organization_name,
                contact_name=contact_name,
                address=profile.address,
                phone=profile.phone,
                email=profile.email,
                website=profile.website,
                areas_of_practice=["Conveyancing"],
                source_url=listing.profile_url,
                source_identifier=_build_source_identifier(
                    listing.profile_url,
                    business_name=organization_name,
                    display_name=listing.display_name,
                ),
            )
        )

        if index % 10 == 0 or index == len(sorted_listings):
            logger.info("NT profile parse progress: %s/%s", index, len(sorted_listings))
        time.sleep(REQUEST_SLEEP_SECONDS)

    deduped = dedupe_records(records)
    if not deduped:
        raise RuntimeError("No NT records extracted from AIC NT profiles.")

    if total_users is not None and len(deduped) != total_users:
        logger.warning("NT extracted %s records but API reported %s users.", len(deduped), total_users)

    logger.info("NT extraction complete: %s record(s)", len(deduped))
    return deduped


def parse_args():
    parser = build_common_parser("Scrape NT conveyancer directory and seed Postgres.")
    return to_common_args(parser.parse_args())


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.nt")
    logger.info("Starting NT scraper (AIC NT Find a Conveyancer)")

    records = scrape_nt_records(timeout_seconds=args.timeout_seconds, logger=logger)

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=SOURCE_URLS,
        expected_regulator_types=EXPECTED_REGULATOR_TYPES,
    )

    logger.info("NT scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
