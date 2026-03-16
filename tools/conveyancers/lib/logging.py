from __future__ import annotations

import logging
import sys
import time
from typing import Optional


class _UtcFormatter(logging.Formatter):
    converter = time.gmtime


def configure_logging(level: int = logging.INFO) -> None:
    """Configure consistent UTC console logging for all scraper modules."""
    root = logging.getLogger()
    if root.handlers:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        _UtcFormatter(
            fmt="%(asctime)sZ | %(levelname)s | %(name)s | %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )

    root.setLevel(level)
    root.addHandler(handler)


def get_logger(name: str, level: Optional[int] = None) -> logging.Logger:
    configure_logging()
    logger = logging.getLogger(name)
    if level is not None:
        logger.setLevel(level)
    return logger
