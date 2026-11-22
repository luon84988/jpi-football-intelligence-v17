#!/usr/bin/env python3
"""Read-only production monitor. Never publishes or modifies dashboard data."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime, timezone
from time import sleep
from urllib.error import URLError, HTTPError
from export_data import source_endpoint, fetch_live_data, build_dashboard_payload, observation_source, ExportError, LiveHTTPError

TRANSIENT_UPSTREAM_HTTP_STATUSES = {500, 502, 503, 504}
TRANSIENT_UPSTREAM_OUTCOMES = {"timeout", "request_failed"}


def read_current_feed(endpoint: str) -> dict:
    try:
        return fetch_live_data(endpoint)
    except LiveHTTPError as exc:
        transient_upstream = (
            exc.upstream_status in TRANSIENT_UPSTREAM_HTTP_STATUSES
            or exc.upstream_outcome in TRANSIENT_UPSTREAM_OUTCOMES
        )
        if exc.status not in {502, 503, 504} or not transient_upstream:
            raise
        print(
            "::notice::JPi live feed has a transient upstream failure; "
            f"retrying once after 20 seconds. {exc}",
            file=sys.stderr,
        )
        sleep(20)
        return fetch_live_data(endpoint)


def check():
    base = os.environ.get("JPI_API_URL", "")
    if not base:
        raise ExportError("JPI_API_URL is not configured")
    endpoint = source_endpoint(base)
    payload = read_current_feed(endpoint)
    count = len(build_dashboard_payload(payload)["matches"])
    if count < 1:
        raise ExportError("No official matches")
    print(json.dumps({"status": "collection_healthy", "officialFeedVerified": not observation_source(payload), "formalAnalysisReady": False, "analysisStatus": "PRE_ANALYSIS", "upstreamAttempt": payload.get("sourceAttempt"), "checkedAt": datetime.now(timezone.utc).isoformat(),
        "source": payload["source"], "matches": count, "sourceUpdatedAt": payload["updatedAt"]},
        ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        sys.exit(check())
    except (ExportError, HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
        print(f"::error::JPi monitor failed: {exc}", file=sys.stderr)
        sys.exit(2)

