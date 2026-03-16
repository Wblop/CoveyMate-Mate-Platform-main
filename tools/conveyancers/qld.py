from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

# Allow running as `python tools/conveyancers/qld.py`.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.logging import get_logger
from lib.normalize import ConveyancerRecord, dedupe_records, make_record, safe_text
from lib.runtime import build_common_parser, debug_dump, persist_records, to_common_args


JURISDICTION = "QLD"
REGULATOR_TYPE = "law_society"
DIRECTORY_URL = "https://www.youandthelaw.com.au/directory"
LAW_FIRM_TYPE_VALUE = "organisation"
PROPERTY_RESIDENTIAL_LABEL = "Property - Residential"
PROPERTY_RESIDENTIAL_VALUE = "fbef872c-e2d3-eb11-bacc-0022481809a8"
MAX_DISTANCE_VALUE = "100"
MAX_RESULTS_PAGES = 80
SEARCH_POSTCODE_ALL = "0"

SOURCE_URLS = [DIRECTORY_URL]
# Keep Fair Trading scoped for deactivation only.
# We no longer scrape that source because it is unstable for this pipeline.
EXPECTED_REGULATOR_TYPES = [REGULATOR_TYPE, "fair_trading"]


@dataclass(frozen=True)
class QldFirmListing:
    firm_name: str
    profile_url: str
    address: str
    phone: str
    email: str
    areas: list[str]


@dataclass(frozen=True)
class QldFirmDetails:
    solicitors: list[str]
    website: str
    address: str
    phone: str
    email: str
    areas: list[str]


def _parse_areas(raw: str) -> list[str]:
    parts = [safe_text(part) for part in (raw or "").split("|")]
    parts = [part for part in parts if part]
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        key = part.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(part)
    return out


def _merge_areas(*groups: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for area in group:
            value = safe_text(area)
            if not value:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(value)
    return out


def _to_absolute_url(base_url: str, href: str | None) -> str:
    if not href:
        return ""
    return safe_text(urljoin(base_url, href))


def _extract_listing_cards(html: str, *, base_url: str, logger) -> list[QldFirmListing]:
    soup = BeautifulSoup(html, "html.parser")
    cards = soup.select(".search-list-view .card[data-map-card], .row.profile-card .card[data-map-card]")
    listings: list[QldFirmListing] = []

    for card in cards:
        title_el = card.select_one("h3.title")
        profile_link = card.select_one(".heading-row a[href]")
        firm_name = safe_text(title_el.get_text(" ", strip=True) if title_el else "")
        profile_url = _to_absolute_url(base_url, profile_link.get("href") if profile_link else "")

        if not firm_name or not profile_url or "/organisation/" not in profile_url:
            continue

        email_link = card.select_one("a[href^='mailto:']")
        phone_link = card.select_one("a[href^='tel:']")
        address_el = card.select_one("span[data-map-address]")
        areas_el = card.select_one(".practice-list")

        email = safe_text((email_link.get("href") or "").replace("mailto:", "")) if email_link else ""
        if not email and email_link:
            email = safe_text(email_link.get_text(" ", strip=True))

        phone = safe_text(phone_link.get_text(" ", strip=True)) if phone_link else ""
        if not phone and phone_link:
            phone = safe_text((phone_link.get("href") or "").replace("tel:", ""))

        address = safe_text(address_el.get_text(" ", strip=True)) if address_el else ""
        areas = _parse_areas(areas_el.get_text(" ", strip=True) if areas_el else "")

        if PROPERTY_RESIDENTIAL_LABEL.casefold() not in {area.casefold() for area in areas}:
            continue

        listings.append(
            QldFirmListing(
                firm_name=firm_name,
                profile_url=profile_url,
                address=address,
                phone=phone,
                email=email,
                areas=areas,
            )
        )

    deduped: list[QldFirmListing] = []
    seen_urls: set[str] = set()
    for listing in listings:
        if listing.profile_url in seen_urls:
            continue
        seen_urls.add(listing.profile_url)
        deduped.append(listing)

    logger.info("QLD listing cards parsed: %s unique firm(s)", len(deduped))
    return deduped


def _extract_total_pages(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    pages = {1}
    for link in soup.select(".pagination a[href]"):
        href = link.get("href") or ""
        match = re.search(r"[?&]Page=(\d+)", href, re.IGNORECASE)
        if match:
            try:
                pages.add(int(match.group(1)))
            except ValueError:
                continue

    return min(max(pages), MAX_RESULTS_PAGES)


def _extract_profile_details(html: str) -> QldFirmDetails:
    soup = BeautifulSoup(html, "html.parser")

    website = ""
    website_link = soup.select_one(".profile-details .contact-info .website a[href]")
    if website_link:
        raw_href = safe_text(website_link.get("href") or "")
        website = raw_href or safe_text(website_link.get_text(" ", strip=True))

    address = ""
    address_el = soup.select_one(".profile-details .contact-info .address span")
    if address_el:
        address = safe_text(address_el.get_text(" ", strip=True))

    phone = ""
    phone_link = soup.select_one(".profile-details .contact-info a[href^='tel:']")
    if phone_link:
        phone = safe_text(phone_link.get_text(" ", strip=True))
        if not phone:
            phone = safe_text((phone_link.get("href") or "").replace("tel:", ""))

    email = ""
    email_link = soup.select_one(".profile-details .contact-info a[href^='mailto:']")
    if email_link:
        email = safe_text((email_link.get("href") or "").replace("mailto:", ""))
        if not email:
            email = safe_text(email_link.get_text(" ", strip=True))

    # Many QLD profiles expose email on solicitor cards instead of the contact block.
    # Fall back to any mailto links when a firm-level email is absent.
    if not email:
        candidate_emails: list[str] = []
        for mailto_link in soup.select("a[href^='mailto:']"):
            href = safe_text(mailto_link.get("href") or "")
            value = href.replace("mailto:", "").split("?", 1)[0].strip()
            if not value:
                value = safe_text(mailto_link.get_text(" ", strip=True))
            if "@" not in value:
                continue
            candidate_emails.append(value)

        deduped_candidates: list[str] = []
        seen_candidates: set[str] = set()
        for value in candidate_emails:
            key = value.casefold()
            if key in seen_candidates:
                continue
            seen_candidates.add(key)
            deduped_candidates.append(value)

        if deduped_candidates:
            preferred_prefixes = ("info@", "contact@", "enquiries@", "enquiry@", "admin@", "office@")
            preferred = next(
                (
                    candidate
                    for candidate in deduped_candidates
                    if candidate.casefold().startswith(preferred_prefixes)
                ),
                None,
            )
            email = preferred or deduped_candidates[0]

    solicitors: list[str] = []
    for staff_name in soup.select(".staff-list .card h3.title"):
        value = safe_text(staff_name.get_text(" ", strip=True))
        if value:
            solicitors.append(value)

    seen_staff: set[str] = set()
    deduped_solicitors: list[str] = []
    for solicitor in solicitors:
        key = solicitor.casefold()
        if key in seen_staff:
            continue
        seen_staff.add(key)
        deduped_solicitors.append(solicitor)

    profile_areas = [
        safe_text(item.get_text(" ", strip=True))
        for item in soup.select(".profile-details .practice-list .practice-item")
    ]
    profile_areas = [area for area in profile_areas if area]

    return QldFirmDetails(
        solicitors=deduped_solicitors,
        website=website,
        address=address,
        phone=phone,
        email=email,
        areas=profile_areas,
    )


def _build_source_identifier(profile_url: str, firm_name: str) -> str:
    parsed = urlparse(profile_url)
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[0].casefold() == "organisation" and parts[1].isdigit():
        return f"qld-organisation-{parts[1]}"
    slug = re.sub(r"[^a-z0-9]+", "-", firm_name.casefold()).strip("-")
    slug = slug or "firm"
    return f"qld-organisation-{slug}"


def _wait_for_results_or_empty(page, timeout_ms: int) -> None:
    page.wait_for_function(
        """
        () => {
            const hasCards = document.querySelectorAll(".search-list-view .card[data-map-card]").length > 0;
            const hasNoResults = document.body.innerText.includes("No exact matches found");
            return hasCards || hasNoResults;
        }
        """,
        timeout=timeout_ms,
    )


def _set_law_firm_and_area(page, logger) -> None:
    radio_selector = f"input#{LAW_FIRM_TYPE_VALUE}"
    label_selector = f"label[for='{LAW_FIRM_TYPE_VALUE}']"

    if page.locator(label_selector).count():
        page.locator(label_selector).first.click(force=True)

    try:
        page.eval_on_selector(
            radio_selector,
            """
            el => {
                el.checked = true;
                el.dispatchEvent(new Event("click", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            """,
        )
    except Exception:
        logger.warning("Could not force-check QLD law firm radio input.")

    selector = page.locator("select#AreaOfPractice")
    if selector.count():
        selector.select_option(PROPERTY_RESIDENTIAL_VALUE)


def _set_location(
    page,
    logger,
) -> None:
    location = page.locator("#Location")
    if location.count() == 0:
        logger.warning("QLD location input not found; relying on existing form values.")
        return

    location.first.click()
    location.first.fill(SEARCH_POSTCODE_ALL)
    page.wait_for_timeout(300)

    lat = safe_text(page.locator("#Latitude").first.input_value() if page.locator("#Latitude").count() else "")
    lng = safe_text(page.locator("#Longitude").first.input_value() if page.locator("#Longitude").count() else "")

    if lat in {"", "0", "0.0"} or lng in {"", "0", "0.0"}:
        logger.info("QLD using postcode '0' statewide query with latitude/longitude 0.")
        if page.locator("#Latitude").count():
            page.eval_on_selector(
                "#Latitude",
                """
                el => {
                    el.value = "0";
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                }
                """,
            )
        if page.locator("#Longitude").count():
            page.eval_on_selector(
                "#Longitude",
                """
                el => {
                    el.value = "0";
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                }
                """,
            )


def _submit_search(page) -> None:
    submit = page.locator("form[action='/directory/search'] button[type='submit']").first
    submit.click(force=True)


def _try_expand_radius(page, logger) -> None:
    radius = page.locator("select#MaxDist")
    if radius.count() == 0:
        return

    current_value = safe_text(radius.first.input_value())
    if current_value == MAX_DISTANCE_VALUE:
        return

    radius.first.select_option(MAX_DISTANCE_VALUE)
    logger.info("Expanded QLD search radius to %skm", MAX_DISTANCE_VALUE)
    _submit_search(page)


def scrape_qld_records(*, headless: bool, timeout_seconds: int, debug_dump_dir: Path) -> list[ConveyancerRecord]:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as error:  # pragma: no cover - environment guard
        raise RuntimeError(
            "playwright is not installed. Run: pip install -r tools/conveyancers/requirements.txt && python -m playwright install chromium"
        ) from error

    logger = get_logger("conveyancers.qld")
    timeout_ms = timeout_seconds * 1000

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1400, "height": 1000},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(timeout_ms)

        try:
            listing_by_profile: dict[str, QldFirmListing] = {}
            last_error: Exception | None = None

            for attempt in range(1, 3):
                logger.info(
                    "Opening %s for statewide postcode query '%s' (attempt %s/2)",
                    DIRECTORY_URL,
                    SEARCH_POSTCODE_ALL,
                    attempt,
                )
                try:
                    page.goto(DIRECTORY_URL, wait_until="domcontentloaded", timeout=timeout_ms)
                    page.wait_for_selector(
                        "form[action='/directory/search']",
                        state="attached",
                        timeout=timeout_ms,
                    )

                    _set_law_firm_and_area(page, logger)
                    _set_location(page, logger)
                    _submit_search(page)

                    page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
                    page.wait_for_load_state("networkidle", timeout=timeout_ms)
                    _wait_for_results_or_empty(page, timeout_ms=timeout_ms)

                    _try_expand_radius(page, logger)
                    page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
                    page.wait_for_load_state("networkidle", timeout=timeout_ms)
                    _wait_for_results_or_empty(page, timeout_ms=timeout_ms)

                    first_page_html = page.content()
                    total_pages_hint = _extract_total_pages(first_page_html)
                    logger.info(
                        "QLD pagination UI indicates %s page(s); scanning up to %s pages until empty pages are hit.",
                        total_pages_hint,
                        MAX_RESULTS_PAGES,
                    )

                    listing_by_profile.clear()
                    for listing in _extract_listing_cards(first_page_html, base_url=page.url, logger=logger):
                        listing_by_profile[listing.profile_url] = listing

                    empty_page_streak = 0
                    for page_number in range(2, MAX_RESULTS_PAGES + 1):
                        page_url = f"{DIRECTORY_URL}?searched=True&Page={page_number}"
                        logger.info(
                            "Opening QLD result page %s/%s+: %s",
                            page_number,
                            total_pages_hint,
                            page_url,
                        )
                        page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
                        page.wait_for_load_state("networkidle", timeout=timeout_ms)
                        page_listings = _extract_listing_cards(page.content(), base_url=page.url, logger=logger)
                        if not page_listings:
                            empty_page_streak += 1
                            logger.info(
                                "QLD result page %s had no listings (empty streak=%s).",
                                page_number,
                                empty_page_streak,
                            )
                            if empty_page_streak >= 2:
                                logger.info("Stopping QLD page scan after consecutive empty pages.")
                                break
                            continue

                        empty_page_streak = 0
                        for listing in page_listings:
                            listing_by_profile[listing.profile_url] = listing

                    logger.info(
                        "QLD statewide postcode query produced %s unique profile(s)",
                        len(listing_by_profile),
                    )
                    break
                except Exception as error:
                    last_error = error
                    listing_by_profile.clear()
                    if attempt == 1:
                        logger.warning(
                            "QLD statewide query failed on attempt %s/2: %s",
                            attempt,
                            error,
                        )
                        continue

            if not listing_by_profile:
                raise RuntimeError(
                    "QLD statewide query failed after retries; aborting to avoid partial refresh. "
                    + f"Last error: {last_error}"
                )

            records: list[ConveyancerRecord] = []
            for index, listing in enumerate(
                sorted(listing_by_profile.values(), key=lambda item: item.firm_name.casefold()),
                start=1,
            ):
                try:
                    page.goto(listing.profile_url, wait_until="domcontentloaded", timeout=timeout_ms)
                    page.wait_for_load_state("networkidle", timeout=timeout_ms)
                    details = _extract_profile_details(page.content())
                except Exception as error:
                    logger.warning("Failed QLD profile fetch for %s: %s", listing.profile_url, error)
                    details = QldFirmDetails(
                        solicitors=[],
                        website="",
                        address="",
                        phone="",
                        email="",
                        areas=[],
                    )

                combined_areas = _merge_areas(listing.areas, details.areas)
                if PROPERTY_RESIDENTIAL_LABEL.casefold() not in {
                    area.casefold() for area in combined_areas
                }:
                    continue

                records.append(
                    make_record(
                        jurisdiction=JURISDICTION,
                        regulator_type=REGULATOR_TYPE,
                        name=listing.firm_name,
                        organization_name=listing.firm_name,
                        contact_name=", ".join(details.solicitors),
                        address=listing.address or details.address,
                        phone=listing.phone or details.phone,
                        email=listing.email or details.email,
                        website=details.website,
                        areas_of_practice=combined_areas,
                        source_url=listing.profile_url,
                        source_identifier=_build_source_identifier(listing.profile_url, listing.firm_name),
                    )
                )

                if index % 10 == 0 or index == len(listing_by_profile):
                    logger.info("QLD profile progress: %s/%s", index, len(listing_by_profile))

            deduped = dedupe_records(records)
            if not deduped:
                debug_dump(page, debug_dump_dir, "qld_no_records", logger_name="conveyancers.qld")
                raise RuntimeError("No QLD records extracted from youandthelaw directory.")

            logger.info("QLD extraction complete: %s firm record(s)", len(deduped))
            return deduped
        except Exception:
            debug_dump(page, debug_dump_dir, "qld_failure", logger_name="conveyancers.qld")
            raise
        finally:
            context.close()
            browser.close()


def parse_args():
    parser = build_common_parser("Scrape QLD conveyancer directory and seed Postgres.")
    return to_common_args(parser.parse_args())


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.qld")
    logger.info("Starting QLD scraper (You and the Law directory)")

    records = scrape_qld_records(
        headless=args.headless,
        timeout_seconds=args.timeout_seconds,
        debug_dump_dir=args.debug_dump_dir / "qld",
    )
    # Defensive guard: QLD script should only persist law-society records.
    # Any accidental non-law-society rows are excluded.
    records = [record for record in records if record.regulator_type == REGULATOR_TYPE]
    if not records:
        raise RuntimeError("No QLD records extracted from configured source.")

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=SOURCE_URLS,
        expected_regulator_types=EXPECTED_REGULATOR_TYPES,
    )

    logger.info("QLD scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
