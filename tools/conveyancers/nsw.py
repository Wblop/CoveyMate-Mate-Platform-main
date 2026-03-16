from __future__ import annotations

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
from lib.runtime import CommonArgs, build_common_parser, persist_records, to_common_args


JURISDICTION = "NSW"
LAW_SOCIETY_REGULATOR_TYPE = "law_society"
AICNSW_REGULATOR_TYPE = "industry_association"

LAW_SOCIETY_PUBLIC_URL = "https://www.lawsociety.com.au/register-of-solicitors"
LAW_SOCIETY_ORIGIN_URL = "https://ros.lawsociety.com.au"
LAWYER_SEARCH_API_URL = "https://ros-link.lawsociety.com.au/api/lawyer/"
LAWYER_DETAIL_API_URL_TEMPLATE = "https://ros-link.lawsociety.com.au/api/lawyer/{lawyer_id}"
LAWYER_SPECIALIST_FILTER = "Property Law"
LAWYER_PAGE_SIZE = 50
LAWYER_MAX_PAGES = 25

AICNSW_DIRECTORY_URL = "https://www.findaconveyancer.com.au/find-a-conveyancer/"
AICNSW_SEARCH_API_URL = "https://www.findaconveyancer.com.au/wp-admin/admin-ajax.php"
AICNSW_REST_STORES_URL = "https://www.findaconveyancer.com.au/wp-json/wp/v2/wpsl_stores"
AICNSW_REST_PAGE_SIZE = 100
AICNSW_MAX_RESULTS = 50
AICNSW_SEARCH_RADIUS_KM = 50

AICNSW_SEEDS: tuple[tuple[float, float, str], ...] = (
    (-33.8688, 151.2093, "Sydney"),
    (-33.8136, 151.0034, "Parramatta"),
    (-33.8610, 151.2050, "TheRocks"),
    (-33.9450, 151.1770, "Marrickville"),
    (-33.7324, 150.9980, "PennantHills"),
    (-33.6770, 151.3020, "Terrigal"),
    (-33.4269, 151.3417, "Gosford"),
    (-33.7540, 150.6950, "Penrith"),
    (-34.4278, 150.8931, "Wollongong"),
    (-34.4816, 150.4180, "Bowral"),
    (-34.7520, 149.7180, "Goulburn"),
    (-35.1082, 147.3598, "Wagga"),
    (-36.0737, 146.9135, "Albury"),
    (-35.9140, 150.0800, "BatemansBay"),
    (-36.2167, 149.1333, "Bega"),
    (-31.9523, 141.4545, "BrokenHill"),
    (-32.2569, 148.6011, "Dubbo"),
    (-31.0910, 150.9290, "Tamworth"),
    (-31.4300, 152.9080, "PortMacquarie"),
    (-32.9283, 151.7817, "Newcastle"),
    (-30.2963, 153.1135, "CoffsHarbour"),
    (-29.4650, 149.8410, "Moree"),
    (-30.5150, 151.6650, "Armidale"),
    (-28.8135, 153.2773, "Lismore"),
    (-28.7790, 153.6120, "Ballina"),
    (-33.2830, 149.0998, "Orange"),
    (-33.4190, 149.5810, "Bathurst"),
    (-34.5690, 150.8280, "Kiama"),
    (-34.8840, 150.6010, "Nowra"),
    (-31.2740, 149.2760, "Coonabarabran"),
    (-30.3340, 149.7870, "Narrabri"),
    (-34.4973, 144.8410, "Griffith"),
    (-35.3289, 149.4500, "Queanbeyan"),
    (-34.0480, 150.8160, "Campbelltown"),
    (-33.9180, 151.0470, "Bankstown"),
    (-33.8040, 151.0030, "NorthParramatta"),
    (-33.8678, 151.2130, "SydneyCBD2"),
    (-33.8950, 151.0700, "Burwood"),
    (-33.7700, 151.1120, "Chatswood"),
    (-33.9880, 151.1050, "Hurstville"),
)

HTTP_ATTEMPTS = 3
_FORCE_INSECURE_TLS = False
_WARNED_INSECURE_TLS = False

SOURCE_URLS = [
    LAW_SOCIETY_PUBLIC_URL,
    LAWYER_SEARCH_API_URL,
    AICNSW_DIRECTORY_URL,
    AICNSW_SEARCH_API_URL,
    AICNSW_REST_STORES_URL,
]
EXPECTED_REGULATOR_TYPES = [
    LAW_SOCIETY_REGULATOR_TYPE,
    AICNSW_REGULATOR_TYPE,
]


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(str(value)))
        except (TypeError, ValueError):
            return None


def _request_json_any(
    *,
    url: str,
    method: str,
    timeout_seconds: int,
    logger,
    payload: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> Any:
    global _FORCE_INSECURE_TLS
    global _WARNED_INSECURE_TLS

    base_headers = {
        "accept": "application/json",
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
        ),
    }
    if extra_headers:
        base_headers.update(extra_headers)
    if payload is not None:
        base_headers.setdefault("content-type", "application/json")

    for attempt in range(1, HTTP_ATTEMPTS + 1):
        ssl_context: ssl.SSLContext = (
            ssl._create_unverified_context()
            if _FORCE_INSECURE_TLS
            else ssl.create_default_context()
        )
        try:
            data = json.dumps(payload).encode("utf-8") if payload is not None else None
            request = Request(url=url, method=method.upper(), headers=base_headers, data=data)
            with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
                raw = response.read().decode("utf-8")
            parsed = json.loads(raw)
            return parsed
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            if not _FORCE_INSECURE_TLS and _is_tls_verification_error(error):
                _FORCE_INSECURE_TLS = True
                if not _WARNED_INSECURE_TLS:
                    logger.warning(
                        "TLS certificate verification failed for %s. Switching to insecure TLS for NSW API requests.",
                        url,
                    )
                    _WARNED_INSECURE_TLS = True
                continue

            if attempt >= HTTP_ATTEMPTS:
                raise RuntimeError(f"NSW API request failed ({method} {url}): {error}") from error
            sleep_seconds = min(2 * attempt, 6)
            logger.warning(
                "Retrying NSW API request (%s/%s): %s %s -> %s",
                attempt,
                HTTP_ATTEMPTS,
                method.upper(),
                url,
                error,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError(f"NSW API request exhausted retries ({method} {url})")


def _request_json(
    *,
    url: str,
    method: str,
    timeout_seconds: int,
    logger,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    extra_headers: dict[str, str] | None = None
    if payload is not None:
        extra_headers = {
            "content-type": "application/json",
            "origin": LAW_SOCIETY_ORIGIN_URL,
            "referer": f"{LAW_SOCIETY_ORIGIN_URL}/",
            "x-requested-with": "XMLHttpRequest",
        }
    parsed = _request_json_any(
        url=url,
        method=method,
        timeout_seconds=timeout_seconds,
        logger=logger,
        payload=payload,
        extra_headers=extra_headers,
    )
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Expected object JSON from {url}, got {type(parsed).__name__}")
    return parsed


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


def _build_person_name(summary: dict[str, Any], detail: dict[str, Any]) -> str:
    first = safe_text(
        str(
            detail.get("preferredName")
            or detail.get("firstName")
            or summary.get("preferredName")
            or summary.get("firstName")
            or ""
        )
    )
    middle = safe_text(str(detail.get("middleName") or summary.get("middleName") or ""))
    last = safe_text(str(detail.get("lastName") or summary.get("lastName") or ""))

    combined = safe_text(" ".join(part for part in [first, middle, last] if part))
    if combined:
        return combined

    full_name = safe_text(str(summary.get("fullName") or detail.get("name") or ""))
    if "," in full_name:
        last_part, first_part = [safe_text(part) for part in full_name.split(",", 1)]
        reordered = safe_text(f"{first_part} {last_part}")
        if reordered:
            return reordered

    return full_name


def _format_address(address: Any) -> str:
    if not isinstance(address, dict):
        return ""

    street = safe_text(str(address.get("street") or ""))
    suburb = safe_text(str(address.get("suburb") or ""))
    state = safe_text(str(address.get("state") or ""))
    post_code = safe_text(str(address.get("postCode") or ""))

    locality = safe_text(" ".join(part for part in [suburb, state, post_code] if part))
    if street and locality:
        return f"{street}, {locality}"
    return street or locality


def _extract_areas(detail: dict[str, Any]) -> list[str]:
    out: list[str] = []
    raw_areas = detail.get("specialistAccreditation")
    if isinstance(raw_areas, list):
        for value in raw_areas:
            area = safe_text(str(value))
            if area:
                out.append(area)
    elif isinstance(raw_areas, str):
        area = safe_text(raw_areas)
        if area:
            out.append(area)

    if not any(area.casefold() == LAWYER_SPECIALIST_FILTER.casefold() for area in out):
        out.append(LAWYER_SPECIALIST_FILTER)

    return out


def _fetch_lawyer_summaries(timeout_seconds: int, logger) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    reported_total: int | None = None

    for page in range(1, LAWYER_MAX_PAGES + 1):
        payload = {
            "lastName": "",
            "otherName": "",
            "suburb": "",
            "region": "",
            "accreditedSpecialist": LAWYER_SPECIALIST_FILTER,
            "page": page,
            "pageSize": LAWYER_PAGE_SIZE,
        }
        response = _request_json(
            url=LAWYER_SEARCH_API_URL,
            method="POST",
            payload=payload,
            timeout_seconds=timeout_seconds,
            logger=logger,
        )
        if reported_total is None:
            reported_total = _as_int(response.get("resultCount"))

        results = response.get("results")
        if not isinstance(results, list):
            raise RuntimeError(f"Unexpected NSW lawyer payload shape on page {page}: 'results' missing list.")

        for item in results:
            if not isinstance(item, dict):
                continue
            lawyer_id = _as_int(item.get("id"))
            if lawyer_id is None:
                continue
            summary = dict(item)
            summary["id"] = lawyer_id
            summaries.append(summary)

        logger.info(
            "NSW law society page %s fetched: %s rows (%s collected of %s expected).",
            page,
            len(results),
            len(summaries),
            reported_total if reported_total is not None else "?",
        )

        if not results:
            break
        if len(results) < LAWYER_PAGE_SIZE:
            break
        if reported_total is not None and len(summaries) >= reported_total:
            break

    if not summaries:
        raise RuntimeError("No NSW lawyers were returned from ros-link list API.")

    if reported_total is not None and len(summaries) != reported_total:
        logger.warning(
            "NSW law society API reported %s rows but %s rows were collected.",
            reported_total,
            len(summaries),
        )

    unique_lawyer_ids = len({_as_int(summary.get("id")) for summary in summaries if _as_int(summary.get("id")) is not None})
    duplicate_rows = len(summaries) - unique_lawyer_ids
    if duplicate_rows > 0:
        logger.info(
            "NSW law society includes %s additional firm/branch rows across %s unique lawyer IDs.",
            duplicate_rows,
            unique_lawyer_ids,
        )

    return summaries


def _record_from_lawyer_payload(
    *,
    lawyer_id: int,
    summary: dict[str, Any],
    detail: dict[str, Any],
) -> ConveyancerRecord | None:
    person_name = _build_person_name(summary, detail)
    if not person_name:
        return None

    street_address = _format_address(detail.get("streetAddress"))
    postal_address = _format_address(detail.get("postalAddress"))
    place_of_practice = safe_text(str(detail.get("placeOfPractice") or summary.get("practice") or ""))
    summary_practice = safe_text(str(summary.get("practice") or ""))
    summary_suburb = safe_text(str(summary.get("suburb") or ""))
    firm_name = summary_practice or place_of_practice
    listing_name = firm_name or person_name
    contact_name = person_name
    organization_name = firm_name

    phone = safe_text(str(detail.get("phoneWithAreaCode") or ""))
    if not phone:
        phone = safe_text(
            f"{safe_text(str(detail.get('firmPhoneAreaCode') or ''))} "
            f"{safe_text(str(detail.get('firmPhone') or ''))}"
        )

    email = safe_text(str(detail.get("email") or detail.get("firmEmail") or ""))
    website = safe_text(str(detail.get("website") or ""))

    base_address = street_address or postal_address
    if base_address and summary_practice and summary_practice.casefold() not in base_address.casefold():
        primary_address = safe_text(f"{summary_practice}, {base_address}")
    elif base_address:
        primary_address = base_address
    else:
        locality = safe_text(" ".join(part for part in [summary_suburb, "NSW"] if part))
        primary_address = safe_text(", ".join(part for part in [summary_practice or place_of_practice, locality] if part))

    return make_record(
        jurisdiction=JURISDICTION,
        regulator_type=LAW_SOCIETY_REGULATOR_TYPE,
        name=listing_name,
        contact_name=contact_name,
        organization_name=organization_name,
        address=primary_address,
        phone=phone,
        email=email,
        website=website,
        areas_of_practice=_extract_areas(detail),
        source_url=LAW_SOCIETY_PUBLIC_URL,
        source_identifier=_build_source_identifier(lawyer_id=lawyer_id, summary=summary),
    )


def scrape_nsw_law_society_records(*, timeout_seconds: int, logger) -> list[ConveyancerRecord]:
    summaries = _fetch_lawyer_summaries(timeout_seconds=timeout_seconds, logger=logger)
    lawyer_ids = sorted({_as_int(summary.get("id")) for summary in summaries if _as_int(summary.get("id")) is not None})
    detail_by_lawyer_id: dict[int, dict[str, Any]] = {}
    records: list[ConveyancerRecord] = []

    for index, lawyer_id in enumerate(lawyer_ids, start=1):
        assert lawyer_id is not None
        detail_url = LAWYER_DETAIL_API_URL_TEMPLATE.format(lawyer_id=lawyer_id)
        detail = _request_json(
            url=detail_url,
            method="GET",
            timeout_seconds=timeout_seconds,
            logger=logger,
        )
        detail_by_lawyer_id[lawyer_id] = detail

        if index % 25 == 0 or index == len(lawyer_ids):
            logger.info("NSW law society detail progress: %s/%s", index, len(lawyer_ids))

    for summary in summaries:
        lawyer_id = _as_int(summary.get("id"))
        if lawyer_id is None:
            continue
        detail = detail_by_lawyer_id.get(lawyer_id)
        if detail is None:
            continue
        record = _record_from_lawyer_payload(
            lawyer_id=lawyer_id,
            summary=summary,
            detail=detail,
        )
        if record is not None:
            records.append(record)

    deduped = dedupe_records(records)
    logger.info(
        "NSW law society extracted %s record(s) from %s listing rows and %s API IDs.",
        len(deduped),
        len(summaries),
        len(lawyer_ids),
    )
    return deduped


def _build_source_identifier(*, lawyer_id: int, summary: dict[str, Any]) -> str:
    composite = safe_text(str(summary.get("compositeFirmKey") or ""))
    if composite and composite != "0_0":
        normalized = composite.replace("_", "-")
        return f"nsw-lawyer-{lawyer_id}-{normalized}"
    return f"nsw-lawyer-{lawyer_id}"


def _decode_html_text(value: Any) -> str:
    return safe_text(unescape(str(value or "")))


def _aicnsw_address(row: dict[str, Any]) -> str:
    parts = [
        _decode_html_text(row.get("address")),
        _decode_html_text(row.get("address2")),
        _decode_html_text(row.get("city")),
        _decode_html_text(row.get("state")),
        _decode_html_text(row.get("zip")),
    ]
    return safe_text(", ".join(part for part in parts if part))


def _record_from_aicnsw_search_row(row: dict[str, Any]) -> ConveyancerRecord | None:
    store_id = _as_int(row.get("id"))
    if store_id is None:
        return None

    firm_name = _decode_html_text(row.get("store"))
    if not firm_name:
        return None

    return make_record(
        jurisdiction=JURISDICTION,
        regulator_type=AICNSW_REGULATOR_TYPE,
        name=firm_name,
        organization_name=firm_name,
        contact_name="",
        address=_aicnsw_address(row),
        phone=_decode_html_text(row.get("phone")),
        email=_decode_html_text(row.get("email")),
        website=_decode_html_text(row.get("url")),
        areas_of_practice=["Conveyancing"],
        source_url=AICNSW_DIRECTORY_URL,
        source_identifier=f"nsw-aicnsw-{store_id}",
    )


def _record_from_aicnsw_rest_item(store: dict[str, str]) -> ConveyancerRecord:
    store_id = _as_int(store.get("id"))
    title = _decode_html_text(store.get("title"))
    if store_id is None or not title:
        raise RuntimeError(f"Invalid AICNSW REST store payload: {store}")

    return make_record(
        jurisdiction=JURISDICTION,
        regulator_type=AICNSW_REGULATOR_TYPE,
        name=title,
        organization_name=title,
        contact_name="",
        address="",
        phone="",
        email="",
        website="",
        areas_of_practice=["Conveyancing"],
        source_url=safe_text(store.get("link") or AICNSW_DIRECTORY_URL),
        source_identifier=f"nsw-aicnsw-{store_id}",
    )


def _dedupe_aicnsw_equivalent_records(
    records: list[ConveyancerRecord],
) -> tuple[list[ConveyancerRecord], int]:
    deduped: list[ConveyancerRecord] = []
    seen: set[tuple[str, str, str, str, str]] = set()

    for record in records:
        key = (
            record.name.casefold(),
            record.address.casefold(),
            record.phone.casefold(),
            record.email.casefold(),
            record.website.casefold(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)

    return deduped, len(records) - len(deduped)


def _fetch_aicnsw_store_index(timeout_seconds: int, logger) -> dict[int, dict[str, str]]:
    stores: dict[int, dict[str, str]] = {}
    page = 1

    while True:
        url = (
            f"{AICNSW_REST_STORES_URL}"
            f"?per_page={AICNSW_REST_PAGE_SIZE}&page={page}&_fields=id,title,link"
        )
        payload = _request_json_any(
            url=url,
            method="GET",
            timeout_seconds=timeout_seconds,
            logger=logger,
            extra_headers={"referer": AICNSW_DIRECTORY_URL},
        )
        if not isinstance(payload, list):
            raise RuntimeError(
                f"Unexpected AICNSW REST payload on page {page}: {type(payload).__name__}"
            )
        if not payload:
            break

        added = 0
        for item in payload:
            if not isinstance(item, dict):
                continue
            store_id = _as_int(item.get("id"))
            if store_id is None:
                continue
            title_payload = item.get("title")
            title = ""
            if isinstance(title_payload, dict):
                title = _decode_html_text(title_payload.get("rendered"))
            if not title:
                title = _decode_html_text(item.get("slug"))
            stores[store_id] = {
                "id": str(store_id),
                "title": title,
                "link": safe_text(str(item.get("link") or AICNSW_DIRECTORY_URL)),
            }
            added += 1

        logger.info(
            "NSW AICNSW REST page %s fetched: %s rows (total indexed=%s).",
            page,
            added,
            len(stores),
        )

        if len(payload) < AICNSW_REST_PAGE_SIZE:
            break
        page += 1

    return stores


def _fetch_aicnsw_search_rows_for_seed(
    *,
    lat: float,
    lng: float,
    label: str,
    timeout_seconds: int,
    logger,
) -> list[dict[str, Any]]:
    params = {
        "action": "store_search",
        "lat": f"{lat:.6f}",
        "lng": f"{lng:.6f}",
        "max_results": str(AICNSW_MAX_RESULTS),
        "search_radius": str(AICNSW_SEARCH_RADIUS_KM),
        "search": label,
    }
    url = f"{AICNSW_SEARCH_API_URL}?{urlencode(params)}"
    payload = _request_json_any(
        url=url,
        method="GET",
        timeout_seconds=timeout_seconds,
        logger=logger,
        extra_headers={
            "accept": "application/json,text/javascript,*/*;q=0.1",
            "referer": AICNSW_DIRECTORY_URL,
        },
    )
    if not isinstance(payload, list):
        if isinstance(payload, str) and payload.strip() in {"0", ""}:
            return []
        raise RuntimeError(
            f"Unexpected AICNSW search payload for seed '{label}': {type(payload).__name__}"
        )
    return [row for row in payload if isinstance(row, dict)]


def scrape_nsw_findaconveyancer_records(*, timeout_seconds: int, logger) -> list[ConveyancerRecord]:
    indexed_stores = _fetch_aicnsw_store_index(timeout_seconds=timeout_seconds, logger=logger)
    if not indexed_stores:
        raise RuntimeError("No NSW AICNSW stores found in REST index.")

    detailed_rows: dict[int, dict[str, Any]] = {}
    for seed_number, (lat, lng, label) in enumerate(AICNSW_SEEDS, start=1):
        try:
            rows = _fetch_aicnsw_search_rows_for_seed(
                lat=lat,
                lng=lng,
                label=label,
                timeout_seconds=timeout_seconds,
                logger=logger,
            )
            for row in rows:
                store_id = _as_int(row.get("id"))
                if store_id is None:
                    continue
                detailed_rows[store_id] = row
            logger.info(
                "NSW AICNSW seed %s/%s '%s' yielded %s rows (%s detailed IDs total).",
                seed_number,
                len(AICNSW_SEEDS),
                label,
                len(rows),
                len(detailed_rows),
            )
        except Exception as error:
            logger.warning("NSW AICNSW seed '%s' failed: %s", label, error)

    records: list[ConveyancerRecord] = []
    detailed_ids: set[int] = set()
    fallback_count = 0

    for store_id, row in sorted(detailed_rows.items()):
        record = _record_from_aicnsw_search_row(row)
        if record is None:
            continue
        records.append(record)
        if store_id in indexed_stores:
            detailed_ids.add(store_id)

    for store_id, indexed_store in sorted(indexed_stores.items()):
        if store_id in detailed_rows:
            continue
        records.append(_record_from_aicnsw_rest_item(indexed_store))
        fallback_count += 1

    semantic_deduped, semantic_removed = _dedupe_aicnsw_equivalent_records(records)
    deduped = dedupe_records(semantic_deduped)
    coverage_pct = (len(detailed_ids) / len(indexed_stores) * 100.0) if indexed_stores else 0.0
    logger.info(
        "NSW AICNSW extracted %s records (detailed=%s, fallback=%s, indexed_total=%s, detailed_coverage=%.1f%%, semantic_dedup_removed=%s).",
        len(deduped),
        len(detailed_ids),
        fallback_count,
        len(indexed_stores),
        coverage_pct,
        semantic_removed,
    )
    return deduped


def scrape_nsw_records(
    *,
    args: CommonArgs,
    logger,
) -> tuple[list[ConveyancerRecord], list[str]]:
    law_society_records = scrape_nsw_law_society_records(
        timeout_seconds=args.timeout_seconds,
        logger=logger,
    )
    if not law_society_records:
        raise RuntimeError("No NSW Law Society records extracted from ros-link API.")

    aicnsw_records = scrape_nsw_findaconveyancer_records(
        timeout_seconds=args.timeout_seconds,
        logger=logger,
    )

    expected_regulators = [LAW_SOCIETY_REGULATOR_TYPE, AICNSW_REGULATOR_TYPE]
    merged = dedupe_records([*law_society_records, *aicnsw_records])
    logger.info(
        "NSW total merged records: %s (law_society=%s, industry_association=%s, expected_scopes=%s)",
        len(merged),
        len(law_society_records),
        len(aicnsw_records),
        ",".join(expected_regulators),
    )
    return merged, expected_regulators


def parse_args():
    parser = build_common_parser("Scrape NSW conveyancer directories and seed Postgres.")
    return to_common_args(parser.parse_args())


def main() -> int:
    args = parse_args()
    logger = get_logger("conveyancers.nsw")
    logger.info("Starting NSW scraper (law society API + AICNSW directory)")

    records, expected_regulators = scrape_nsw_records(args=args, logger=logger)
    if not records:
        raise RuntimeError("No NSW records extracted from configured sources.")

    summary = persist_records(
        args=args,
        jurisdiction=JURISDICTION,
        records=records,
        source_urls=SOURCE_URLS,
        expected_regulator_types=expected_regulators,
    )

    logger.info("NSW scrape complete: %s extracted", summary.extracted_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
