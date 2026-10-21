#!/usr/bin/env python3
"""Read-only production monitor. Never publishes or modifies dashboard data."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from export_data import source_endpoint, fetch_live_data, ExportError

def check():
    base = os.environ.get("JPI_API_URL", "")
    if not base:
        raise ExportError("JPI_API_URL is not configured")
    endpoint = source_endpoint(base)
    payload = fetch_live_data(endpoint)
    count = len(payload["matches"])
    if count < 1:
        raise ExportError("No official matches")
    print(json.dumps({"status": "healthy", "checkedAt": datetime.now(timezone.utc).isoformat(),
        "source": payload["source"], "matches": count, "sourceUpdatedAt": payload["updatedAt"]},
        ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        sys.exit(check())
    except (ExportError, HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
        print(f"::error::JPi monitor failed: {exc}", file=sys.stderr)
        sys.exit(2)
