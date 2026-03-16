from __future__ import annotations

from pathlib import Path
import logging

from .normalize import ConveyancerRecord
from .scrape import with_retries
from .source_runner import SourceConfig, scrape_source



def scrape_sources_with_playwright(
    *,
    jurisdiction: str,
    sources: list[SourceConfig],
    headless: bool,
    timeout_seconds: int,
    debug_dump_dir: Path,
    logger: logging.Logger,
) -> list[ConveyancerRecord]:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as error:  # pragma: no cover - environment guard
        raise RuntimeError(
            "playwright is not installed. Run: pip install -r tools/conveyancers/requirements.txt && python -m playwright install chromium"
        ) from error

    records: list[ConveyancerRecord] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
            ),
        )

        try:
            for source in sources:
                page = context.new_page()
                page.set_default_timeout(timeout_seconds * 1000)
                source_records = with_retries(
                    action=lambda: scrape_source(
                        page=page,
                        jurisdiction=jurisdiction,
                        config=source,
                        timeout_seconds=timeout_seconds,
                        debug_dump_dir=debug_dump_dir,
                        logger=logger,
                    ),
                    logger=logger,
                    attempts=3,
                    sleep_seconds=2.0,
                )
                records.extend(source_records)
                page.close()
        finally:
            context.close()
            browser.close()

    return records
