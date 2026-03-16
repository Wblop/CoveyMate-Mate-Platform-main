from __future__ import annotations

from collections.abc import Iterable
import logging
import re
import time
from typing import Callable
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .normalize import ConveyancerRecord, dedupe_records, make_record, safe_text


SEARCH_INPUT_SELECTORS = [
    "input[type='search']",
    "input[name*='search' i]",
    "input[id*='search' i]",
    "input[name*='keyword' i]",
    "input[placeholder*='Search' i]",
    "input[placeholder*='Name' i]",
]

SEARCH_BUTTON_SELECTORS = [
    "button[type='submit']",
    "button:has-text('Search')",
    "button:has-text('Find')",
    "input[type='submit']",
]

LOAD_MORE_SELECTORS = [
    "button:has-text('Load more')",
    "button:has-text('Show more')",
    "a:has-text('Load more')",
    "a:has-text('View more')",
    "a:has-text('Show more')",
]

NEXT_PAGE_SELECTORS = [
    "a[rel='next']",
    "button[rel='next']",
    "a:has-text('Next')",
    "button:has-text('Next')",
    "a.pagination-next",
    "li.next a",
]

COOKIE_SELECTORS = [
    "button:has-text('Accept')",
    "button:has-text('Accept all')",
    "button:has-text('I agree')",
    "button:has-text('Allow all')",
]


def maybe_click(page, selectors: Iterable[str], timeout_ms: int = 1500) -> bool:
    for selector in selectors:
        locator = page.locator(selector)
        try:
            if locator.count() > 0 and locator.first.is_visible():
                locator.first.click(timeout=timeout_ms)
                return True
        except Exception:
            continue
    return False


def accept_common_cookies(page) -> None:
    maybe_click(page, COOKIE_SELECTORS, timeout_ms=2000)


def apply_keyword_search(page, keyword: str, logger: logging.Logger | None = None) -> bool:
    for selector in SEARCH_INPUT_SELECTORS:
        locator = page.locator(selector)
        try:
            if locator.count() > 0 and locator.first.is_visible():
                locator.first.fill("")
                locator.first.fill(keyword)
                page.keyboard.press("Enter")
                page.wait_for_load_state("networkidle", timeout=15000)
                if logger:
                    logger.info("Applied keyword search '%s' via selector %s", keyword, selector)
                return True
        except Exception:
            continue

    clicked = maybe_click(page, SEARCH_BUTTON_SELECTORS, timeout_ms=3000)
    if clicked:
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
    return clicked


def click_load_more(page, max_clicks: int, logger: logging.Logger | None = None) -> int:
    clicks = 0
    while clicks < max_clicks:
        if not maybe_click(page, LOAD_MORE_SELECTORS, timeout_ms=5000):
            break
        clicks += 1
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(500)

    if logger and clicks > 0:
        logger.info("Clicked load-more controls %s time(s)", clicks)

    return clicks


def collect_paginated_html(page, max_pages: int, logger: logging.Logger | None = None) -> list[str]:
    snapshots: list[str] = []
    seen_signatures: set[str] = set()

    def _append_snapshot() -> None:
        html = page.content()
        signature = f"{page.url}|{len(html)}"
        if signature not in seen_signatures:
            seen_signatures.add(signature)
            snapshots.append(html)

    _append_snapshot()

    for _ in range(max_pages - 1):
        clicked = False
        for selector in NEXT_PAGE_SELECTORS:
            locator = page.locator(selector)
            try:
                if locator.count() == 0 or not locator.first.is_visible():
                    continue
                disabled = (locator.first.get_attribute("aria-disabled") or "").lower() == "true"
                classes = (locator.first.get_attribute("class") or "").lower()
                if disabled or "disabled" in classes:
                    continue
                locator.first.click(timeout=5000)
                page.wait_for_load_state("networkidle", timeout=20000)
                page.wait_for_timeout(300)
                clicked = True
                break
            except Exception:
                continue

        if not clicked:
            break

        _append_snapshot()

    if logger:
        logger.info("Captured %s paginated HTML snapshot(s)", len(snapshots))

    return snapshots


def with_retries(
    *,
    action: Callable[[], list[ConveyancerRecord]],
    logger: logging.Logger,
    attempts: int = 3,
    sleep_seconds: float = 2.0,
) -> list[ConveyancerRecord]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except Exception as error:  # pragma: no cover - exercised in runtime
            last_error = error
            logger.exception("Scrape attempt %s/%s failed: %s", attempt, attempts, error)
            if attempt < attempts:
                time.sleep(sleep_seconds * attempt)

    assert last_error is not None
    raise last_error


def extract_records_from_html(
    *,
    html: str,
    jurisdiction: str,
    regulator_type: str,
    source_url: str,
    base_url: str,
    keyword_filter: str | None = None,
) -> list[ConveyancerRecord]:
    soup = BeautifulSoup(html, "html.parser")
    records: list[ConveyancerRecord] = []

    candidates: list[Tag] = []
    selectors = [
        ".directory__result__item",
        ".search-result",
        ".result",
        ".listing",
        ".member",
        ".profile",
        ".card",
        "article",
        "li",
        "tr",
    ]

    for selector in selectors:
        candidates.extend([node for node in soup.select(selector) if isinstance(node, Tag)])

    if not candidates:
        candidates = [node for node in soup.find_all(["article", "div", "li", "tr"]) if isinstance(node, Tag)]

    for node in candidates:
        text = safe_text(node.get_text(" ", strip=True))
        if len(text) < 20:
            continue

        lowered = text.lower()
        if keyword_filter and keyword_filter.lower() not in lowered and "convey" not in lowered:
            continue

        has_contact = bool(node.select_one("a[href^='mailto:'], a[href^='tel:']"))
        has_contact = has_contact or bool(re.search(r"\b\+?\d[\d\s()\-]{7,}\b", text))
        has_contact = has_contact or bool(re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I))

        class_text = " ".join(node.get("class", []))
        has_hint = bool(re.search(r"result|listing|directory|member|profile|contact|card", class_text, re.I))

        if not has_contact and not has_hint:
            continue

        name = _extract_name(node)
        if not name:
            continue

        phone = _extract_phone(node, text)
        email = _extract_email(node, text)
        website = _extract_website(node, base_url)
        address = _extract_address(node)
        areas = _extract_areas(node, text)

        try:
            records.append(
                make_record(
                    jurisdiction=jurisdiction,
                    regulator_type=regulator_type,
                    name=name,
                    address=address,
                    phone=phone,
                    email=email,
                    website=website,
                    areas_of_practice=areas,
                    source_url=source_url,
                )
            )
        except ValueError:
            continue

    return dedupe_records(records)


def combine_and_dedupe(record_groups: Iterable[Iterable[ConveyancerRecord]]) -> list[ConveyancerRecord]:
    merged: list[ConveyancerRecord] = []
    for records in record_groups:
        merged.extend(records)
    return dedupe_records(merged)


def _extract_name(node: Tag) -> str:
    for selector in ["h1", "h2", "h3", "h4", ".name", ".title", "strong", "b"]:
        child = node.select_one(selector)
        if child:
            value = safe_text(child.get_text(" ", strip=True))
            if 2 <= len(value) <= 120:
                return value

    text = safe_text(node.get_text("\n", strip=True))
    first_line = safe_text(text.split("\n")[0] if text else "")
    if 2 <= len(first_line) <= 120:
        return first_line

    return ""


def _extract_phone(node: Tag, text: str) -> str:
    tel_link = node.select_one("a[href^='tel:']")
    if tel_link:
        href = tel_link.get("href", "")
        return safe_text(href.replace("tel:", "") or tel_link.get_text(" ", strip=True))

    match = re.search(r"\b(?:\+?61|0)[\d\s()\-]{7,}\d\b", text)
    return safe_text(match.group(0)) if match else ""


def _extract_email(node: Tag, text: str) -> str:
    mail_link = node.select_one("a[href^='mailto:']")
    if mail_link:
        href = mail_link.get("href", "")
        return safe_text(href.replace("mailto:", "") or mail_link.get_text(" ", strip=True))

    match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I)
    return safe_text(match.group(0)) if match else ""


def _extract_website(node: Tag, base_url: str) -> str:
    links = node.select("a[href]")
    for link in links:
        href = safe_text(link.get("href", ""))
        if not href:
            continue
        if href.startswith("mailto:") or href.startswith("tel:") or href.startswith("#"):
            continue

        full = urljoin(base_url, href)
        if full.startswith("http"):
            return full

    return ""


def _extract_address(node: Tag) -> str:
    address_tag = node.select_one("address")
    if address_tag:
        return safe_text(address_tag.get_text(" ", strip=True))

    for selector in [
        ".address",
        "[class*='address']",
        "[class*='location']",
    ]:
        child = node.select_one(selector)
        if child:
            value = safe_text(child.get_text(" ", strip=True))
            if value:
                return value

    text = safe_text(node.get_text(" ", strip=True))
    street_match = re.search(
        r"\b\d{1,4}\s+[A-Za-z0-9'\-.\s]+\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Place|Pl|Circuit|Cct|Terrace|Tce|Highway|Hwy)\b[^,;]{0,80}",
        text,
        re.I,
    )
    return safe_text(street_match.group(0)) if street_match else ""


def _extract_areas(node: Tag, text: str) -> list[str]:
    areas: list[str] = []

    for li in node.select("li"):
        value = safe_text(li.get_text(" ", strip=True))
        if not value:
            continue
        if re.search(r"convey", value, re.I):
            areas.append(value)

    if not areas and re.search(r"convey", text, re.I):
        areas.append("Conveyancing")

    return areas
