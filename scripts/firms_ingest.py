#!/usr/bin/env python3
"""NASA FIRMS active-fire ingestion (VIIRS NOAA-20 / NOAA-21, near real time).

Security notes
- The key is read ONLY from the FIRMS_MAP_KEY environment variable.
- FIRMS puts the key inside the URL path, so URLs and raw exception text are
  never logged; every message is passed through redact().
- Output contains daily detection counts only, never the key or the URL.
"""
import csv
import io
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SOURCES = ("VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")  # S-NPP delivery ended Nov 2026
DAY_RANGE = 5  # FIRMS area API accepts 1-5
DEFAULT_OUT = Path("data/firms/daily_counts.json")

log = logging.getLogger("firms")


class FirmsError(Exception):
    """Error whose message is always safe to print."""


def redact(text, key):
    text = str(text)
    return text.replace(key, "***") if key else text


def get_key():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise FirmsError("FIRMS_MAP_KEY is not set.")
    if not re.fullmatch(r"[A-Za-z0-9]{32}", key):
        raise FirmsError("FIRMS_MAP_KEY has an unexpected format (expected 32 letters/digits).")
    return key


def fetch_csv(source, key, retries=4, timeout=120):
    url = f"{BASE}/{key}/{source}/world/{DAY_RANGE}"
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            first = body.lstrip().split("\n", 1)[0].lower()
            if "latitude" not in first or "acq_date" not in first:
                raise FirmsError(f"{source}: response was not CSV (invalid key or service message).")
            return body
        except urllib.error.HTTPError as e:
            code = e.code
            if code == 429 or code >= 500:
                wait = min(2 ** attempt * 5, 120)
                ra = e.headers.get("Retry-After") if e.headers else None
                if ra and str(ra).isdigit():
                    wait = min(int(ra), 300)
                log.warning("%s: HTTP %s, retry %d/%d in %ss", source, code, attempt, retries, wait)
                time.sleep(wait)
                continue
            raise FirmsError(f"{source}: HTTP {code}.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            wait = 2 ** attempt * 5
            log.warning("%s: network error, retry %d/%d in %ss", source, attempt, retries, wait)
            time.sleep(wait)
    raise FirmsError(f"{source}: failed after {retries} attempts.")


def summarize(csv_text):
    days = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        d = row.get("acq_date")
        if not d:
            continue
        rec = days.setdefault(d, {"detections": 0, "high_confidence": 0, "frp_mw_sum": 0.0})
        rec["detections"] += 1
        if (row.get("confidence") or "").strip().lower() in ("h", "high"):
            rec["high_confidence"] += 1
        try:
            rec["frp_mw_sum"] += float(row.get("frp") or 0)
        except ValueError:
            pass
    for rec in days.values():
        rec["frp_mw_sum"] = round(rec["frp_mw_sum"], 1)
    return days


def merge(existing, source, days):
    bucket = existing.setdefault("data", {}).setdefault(source, {})
    bucket.update(days)  # NRT values can be revised, so newest fetch wins
    existing["data"][source] = dict(sorted(bucket.items()))
    return existing


def main(out_path=DEFAULT_OUT):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        key = get_key()
    except FirmsError as e:
        log.error("%s", e)
        return 1
    out = Path(out_path)
    state = json.loads(out.read_text()) if out.exists() else {}
    ok = 0
    for source in SOURCES:
        try:
            days = summarize(fetch_csv(source, key))
            merge(state, source, days)
            log.info("%s: %d days, %d detections", source, len(days),
                     sum(d["detections"] for d in days.values()))
            ok += 1
        except FirmsError as e:
            log.error("%s", redact(e, key))
    if not ok:
        return 1
    state["meta"] = {
        "provider": "NASA FIRMS (LANCE)",
        "nature": "Satellite observation (VIIRS active-fire detections, near real time)",
        "unit": "detections per UTC day; FRP in MW",
        "limitations": "Detections are thermal anomalies, not burned area; NRT values may be revised.",
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(state, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
