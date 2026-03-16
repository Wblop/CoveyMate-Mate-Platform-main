from __future__ import annotations

from dataclasses import dataclass
import logging
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urljoin

if TYPE_CHECKING:
    from playwright.sync_api import Page

from .normalize import ConveyancerRecord, dedupe_records
from .runtime import debug_dump
from .scrape import (
    accept_common_cookies,
    apply_keyword_search,
    click_load_more,
    collect_paginated_html,
    extract_records_from_html,
)


@dataclass(frozen=True)
class SourceConfig:
    name: str
    root_url: str
    regulator_type: str
    directory_paths: tuple[str, ...] = ()
    link_text_patterns: tuple[str, ...] = ()
    keyword: str = "convey"
    max_pages: int = 10
    max_load_more_clicks: int = 100
    require_keyword: bool = True



def scrape_source(
    *,
    page: "Page",
    jurisdiction: str,
    config: SourceConfig,
    timeout_seconds: int,
    debug_dump_dir: Path,
    logger: logging.Logger,
) -> list[ConveyancerRecord]:
    timeout_ms = timeout_seconds * 1000

    logger.info("[%s] Opening %s", config.name, config.root_url)
    page.goto(config.root_url, wait_until="domcontentloaded", timeout=timeout_ms)
    accept_common_cookies(page)

    discovered_url = _discover_directory_url(page, config, timeout_ms, logger)
    if discovered_url and discovered_url != page.url:
        logger.info("[%s] Navigating to discovered directory URL %s", config.name, discovered_url)
        page.goto(discovered_url, wait_until="domcontentloaded", timeout=timeout_ms)
        accept_common_cookies(page)

    if config.keyword:
        try:
            apply_keyword_search(page, config.keyword, logger=logger)
        except Exception:
            logger.warning("[%s] Keyword search could not be applied.", config.name)

    click_load_more(page, config.max_load_more_clicks, logger=logger)
    snapshots = collect_paginated_html(page, config.max_pages, logger=logger)

    records: list[ConveyancerRecord] = []
    for html in snapshots:
        records.extend(
            extract_records_from_html(
                html=html,
                jurisdiction=jurisdiction,
                regulator_type=config.regulator_type,
                source_url=page.url or config.root_url,
                base_url=page.url or config.root_url,
                keyword_filter=config.keyword if config.require_keyword else None,
            )
        )

    deduped = dedupe_records(records)

    if not deduped and config.require_keyword:
        logger.warning("[%s] No keyword-filtered records found; retrying without keyword filter.", config.name)
        relaxed: list[ConveyancerRecord] = []
        for html in snapshots:
            relaxed.extend(
                extract_records_from_html(
                    html=html,
                    jurisdiction=jurisdiction,
                    regulator_type=config.regulator_type,
                    source_url=page.url or config.root_url,
                    base_url=page.url or config.root_url,
                    keyword_filter=None,
                )
            )
        deduped = dedupe_records(relaxed)

    if not deduped:
        debug_dump(page, debug_dump_dir, f"{jurisdiction.lower()}_{config.name}_no_records")

    logger.info("[%s] Extracted %s record(s)", config.name, len(deduped))
    return deduped


def _discover_directory_url(
    page: "Page",
    config: SourceConfig,
    timeout_ms: int,
    logger: logging.Logger,
) -> str | None:
    for path in config.directory_paths:
        candidate = urljoin(config.root_url, path)
        try:
            response = page.goto(candidate, wait_until="domcontentloaded", timeout=timeout_ms)
            if response is None:
                return candidate
            if response.ok:
                return candidate
        except Exception:
            continue

    for pattern in config.link_text_patterns:
        try:
            locator = page.locator(f"a:has-text('{pattern}')")
            if locator.count() == 0 or not locator.first.is_visible():
                continue
            href = locator.first.get_attribute("href")
            if href:
                return urljoin(config.root_url, href)

            locator.first.click(timeout=5000)
            page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
            return page.url
        except Exception:
            continue

    logger.warning("[%s] Could not discover a directory-specific URL. Staying on current page.", config.name)
    return None
