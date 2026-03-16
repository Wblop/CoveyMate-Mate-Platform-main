from __future__ import annotations

import re
import sys
import time
from pathlib import Path

# Allow running as `python tools/conveyancers/act.py`.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.logging import get_logger
from lib.normalize import ConveyancerRecord, make_record
from lib.runtime import build_common_parser, debug_dump, persist_records, to_common_args


URL = "https://www.actlawsociety.asn.au/find-a-firm"
DEFAULT_AREA_OF_PRACTICE_ID = "f0256f28-ae9b-4c14-815e-11e207504bae"
JURISDICTION = "ACT"
REGULATOR_TYPE = "law_society"


def _safe_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _maybe_click(page, selectors):
    for selector in selectors:
        locator = page.locator(selector)
        try:
            if locator.count() > 0 and locator.first.is_visible():
                locator.first.click(timeout=1500)
                return True
        except Exception:
            pass
    return False


def _wait_for_results(page, timeout_ms: int = 90000):
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

    candidates = [
        ".directory__result__item",
        ".results__found",
        "#search-results",
        ".directory__results",
    ]
    started = time.time()
    last_error = None

    while (time.time() - started) * 1000 < timeout_ms:
        for selector in candidates:
            try:
                locator = page.locator(selector)
                if locator.count() > 0:
                    if selector == ".directory__result__item":
                        if locator.first.is_visible():
                            return
                    else:
                        return
            except Exception as error:
                last_error = error
        page.wait_for_timeout(500)

    raise PlaywrightTimeoutError(
        f"Results did not appear within {timeout_ms}ms. Last error: {last_error}"
    )


def _click_more_results_until_done(page, max_clicks: int = 200):
    button = page.locator("a.view__more.main-result.firm-section")
    clicks = 0

    while clicks < max_clicks:
        try:
            if button.count() == 0:
                break
            if not button.first.is_visible():
                break

            button.first.scroll_into_view_if_needed(timeout=5000)

            before = page.locator(".directory__result__item:not(.collapse)").count()

            button.first.click(timeout=10000)
            page.wait_for_load_state("networkidle", timeout=30000)

            started = time.time()
            while time.time() - started < 15:
                after = page.locator(".directory__result__item:not(.collapse)").count()
                if after > before:
                    break
                page.wait_for_timeout(500)

            after = page.locator(".directory__result__item:not(.collapse)").count()
            if after <= before:
                break

            clicks += 1
        except Exception:
            break


def _parse_areas(raw: str) -> list[str]:
    parts = [_safe_text(part) for part in (raw or "").split(";")]
    parts = [part for part in parts if part]

    seen = set()
    out = []
    for part in parts:
        key = part.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(part)

    return out


def _extract_firms(page):
    cards = page.locator(".directory__result__item:not(.collapse)")
    count = cards.count()

    firms = []
    for i in range(count):
        card = cards.nth(i)

        name = _safe_text(
            card.locator("h3").first.inner_text() if card.locator("h3").count() else ""
        )

        address = ""
        try:
            left = card.locator(".main-contact-content").first
            if left.count():
                p = left.locator("p").first
                if p.count():
                    address = _safe_text(p.inner_text())
        except Exception:
            pass

        phone = website = email = ""
        areas = []

        try:
            right = card.locator("dl").first
            if right.count():
                phone_link = right.locator("a[href^='tel:']").first
                if phone_link.count():
                    phone = _safe_text(phone_link.inner_text())

                website_link = (
                    right.locator("a[href^='http'], a[href^='https'], a[target='_blank']")
                    .filter(has_text="http")
                    .first
                )
                if website_link.count():
                    website = _safe_text(website_link.get_attribute("href") or website_link.inner_text())

                email_link = right.locator("a[href^='mailto:']").first
                if email_link.count():
                    email = _safe_text((email_link.get_attribute("href") or "").replace("mailto:", "")) or _safe_text(
                        email_link.inner_text()
                    )

                area_items = right.locator("dd:has-text('Areas Of Practice:')").locator("xpath=../dt//li")
                for j in range(area_items.count()):
                    areas.append(_safe_text(area_items.nth(j).inner_text()))
        except Exception:
            pass

        if not name:
            continue

        parsed_areas = _parse_areas("; ".join([area for area in areas if area]))

        firms.append(
            {
                "name": name,
                "address": address,
                "phone": phone,
                "web": website,
                "email": email,
                "areas_of_practice": parsed_areas,
                "areas_of_practice_count": len(parsed_areas),
            }
        )

    seen = set()
    deduped = []
    for firm in firms:
        key = (firm["name"].lower(), firm["email"].lower(), firm["phone"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(firm)

    return deduped


def parse_args():
    parser = build_common_parser("Fetch ACT conveyancer data from ACT Law Society.")
    return to_common_args(parser.parse_args())


def scrape_act_records(*, headless: bool, timeout_seconds: int, debug_dump_dir: Path) -> list[ConveyancerRecord]:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as error:  # pragma: no cover - environment guard
        raise RuntimeError(
            "playwright is not installed. Run: pip install -r tools/conveyancers/requirements.txt && python -m playwright install chromium"
        ) from error

    logger = get_logger("conveyancers.act")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(timeout_seconds * 1000)

        try:
            logger.info("Opening %s", URL)
            page.goto(URL, wait_until="domcontentloaded", timeout=timeout_seconds * 1000)

            _maybe_click(
                page,
                [
                    "button:has-text('Accept')",
                    "button:has-text('I agree')",
                    "text=Accept all",
                    "text=Accept",
                ],
            )

            page.wait_for_selector(
                "form#frmDesktopFirmSearch, form#frmMobileFirmSearch, form[action*='find-a-firm']",
                state="attached",
                timeout=timeout_seconds * 1000,
            )

            selector = page.locator("select#firmSearch_AreaOfPracticeId")
            if selector.count():
                try:
                    selector.select_option(DEFAULT_AREA_OF_PRACTICE_ID)
                except Exception:
                    logger.warning("Could not pre-select ACT conveyancing area option.")

            if not _maybe_click(
                page,
                [
                    "button.member-search-submit",
                    "button[type='submit']:has-text('Search')",
                    "form#frmDesktopFirmSearch button[type='submit']",
                ],
            ):
                page.locator("form#frmDesktopFirmSearch").evaluate("form => form.submit()")

            page.wait_for_load_state("domcontentloaded", timeout=timeout_seconds * 1000)
            page.wait_for_load_state("networkidle", timeout=timeout_seconds * 1000)

            _wait_for_results(page, timeout_ms=timeout_seconds * 1000)
            _click_more_results_until_done(page)

            firms = _extract_firms(page)
            if not firms:
                debug_dump(page, debug_dump_dir, "act_no_firms", logger_name="conveyancers.act")
                raise RuntimeError("No firms extracted from ACT source.")

            records: list[ConveyancerRecord] = []
            for firm in firms:
                records.append(
                    make_record(
                        jurisdiction=JURISDICTION,
                        regulator_type=REGULATOR_TYPE,
                        name=firm["name"],
                        address=firm.get("address", ""),
                        phone=firm.get("phone", ""),
                        email=firm.get("email", ""),
                        website=firm.get("web", ""),
                        areas_of_practice=firm.get("areas_of_practice", []),
                        source_url=URL,
                    )
                )

            logger.info("Extracted %s ACT firm record(s)", len(records))
            return records
        except Exception:
            debug_dump(page, debug_dump_dir, "act_failure", logger_name="conveyancers.act")
            raise
        finally:
            context.close()
            browser.close()


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.act")
    logger.info("Starting ACT scraper (headless=%s timeout=%ss)", args.headless, args.timeout_seconds)

    records = scrape_act_records(
        headless=args.headless,
        timeout_seconds=args.timeout_seconds,
        debug_dump_dir=args.debug_dump_dir / "act",
    )

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=[URL],
        expected_regulator_types=[REGULATOR_TYPE],
    )

    logger.info("ACT scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
