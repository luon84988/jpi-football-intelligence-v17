#!/usr/bin/env python3
"""Read-only production monitor. Never publishes or modifies dashboard data."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime, timezone
from urllib.error import URLError, HTTPError
from export_data import source_endpoint, fetch_live_data, build_dashboard_payload, ExportError


def check():
    base = os.environ.get("JPI_API_URL", "")
    if not base:
        raise ExportError("JPI_API_URL is not configured")
    endpoint = source_endpoint(base)
    payload = fetch_live_data(endpoint)

    # Source health alone is insufficient: unpriced official fixtures cannot be
    # published by the exporter. Monitor exactly the same publishability contract.
    validated = build_dashboard_payload(payload)
    count = len(validated["matches"])
    if count < 1:
        raise ExportError("No publishable official matches with valid 1X2 odds")
    raw_count = len(payload["matches"])
    print(json.dumps({
        "status": "healthy",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "source": payload["source"],
        "matches": count,
        "rawMatches": raw_count,
        "invalidMatches": raw_count - count,
        "sourceUpdatedAt": payload["updatedAt"],
        "probabilityBasis": "de-vigged_market_odds",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(check())
    except (ExportError, HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
        print(f"::error::JPi monitor failed: {exc}", file=sys.stderr)
        sys.exit(2)
