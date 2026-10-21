#!/usr/bin/env python3
"""Export a dashboard snapshot from the live JPi Worker API.

This script deliberately has no mock-data fallback. A failed, stale, or malformed
source response must never overwrite the last known dashboard snapshot.
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

OUTPUT = Path(__file__).with_name("dashboard_data.json")
MAX_AGE_SECONDS = int(os.getenv("MAX_SOURCE_AGE_SECONDS", "1800"))


class ExportError(RuntimeError):
    pass


def source_endpoint(base_url: str) -> str:
    base_url = base_url.strip().rstrip("/")
    if not base_url:
        raise ExportError("JPI_API_URL is empty; configure it as a GitHub Actions repository variable.")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ExportError("JPI_API_URL must be an absolute http(s) URL.")
    if parsed.path.rstrip("/").endswith("/api/football/live"):
        return base_url
    return base_url + "/api/football/live"


def fetch_live_data(endpoint: str) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "JPi-V17-dashboard-export/1.0"}
    api_key = os.getenv("API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(endpoint, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=25) as response:
            if response.status != 200:
                raise ExportError(f"Live API returned HTTP {response.status}.")
            raw = response.read(5_000_001)
    except HTTPError as exc:
        raise ExportError(f"Live API returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise ExportError(f"Live API request failed: {exc}") from exc
    if len(raw) > 5_000_000:
        raise ExportError("Live API response exceeded the 5 MB safety limit.")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ExportError("Live API did not return valid UTF-8 JSON.") from exc
    if not isinstance(payload, dict):
        raise ExportError("Live API payload must be a JSON object.")
    if payload.get("error") or payload.get("stale") is True:
        raise ExportError(f"Live API is unavailable or stale: {payload.get('error', 'stale=true')}")
    if payload.get("source") != "中国体育彩票官方竞彩":
        raise ExportError("Only current official Sporttery data may be published; fallback or cached sources are rejected.")
    health = payload.get("sourceHealth")
    if not isinstance(health, dict) or health.get("succeeded") != 1 or health.get("hasData") is not True:
        raise ExportError("Official source health is not verified; refusing to publish.")
    matches = payload.get("matches")
    if not isinstance(matches, list) or not matches:
        raise ExportError("Live API returned no matches; refusing to replace the existing snapshot.")
    updated_at = payload.get("updatedAt")
    if not isinstance(updated_at, str):
        raise ExportError("Live API is missing its updatedAt timestamp.")
    try:
        timestamp = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ExportError("Live API updatedAt is not a valid ISO-8601 timestamp.") from exc
    age = (datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)).total_seconds()
    if age < -300:
        raise ExportError("Live API timestamp is more than five minutes in the future.")
    if age > MAX_AGE_SECONDS:
        raise ExportError(f"Live API data is {int(age)} seconds old (limit {MAX_AGE_SECONDS}); refusing to publish stale data.")
    return payload


def odds_probabilities(raw_odds: object) -> tuple[float, float, float] | None:
    if not isinstance(raw_odds, (list, tuple)) or len(raw_odds) != 3:
        return None
    try:
        odds = [float(value) for value in raw_odds]
    except (TypeError, ValueError):
        return None
    if any(not math.isfinite(value) or value <= 1 for value in odds):
        return None
    inverse = [1.0 / value for value in odds]
    total = sum(inverse)
    if total <= 0:
        return None
    return tuple(value / total for value in inverse)


def build_dashboard_payload(payload: dict) -> dict:
    if payload.get("source") != "中国体育彩票官方竞彩":
        raise ExportError("Non-official or fallback data cannot be exported.")
    health = payload.get("sourceHealth")
    if not isinstance(health, dict) or health.get("succeeded") != 1 or health.get("hasData") is not True:
        raise ExportError("Official source health is not verified.")
    rows = []
    skipped = 0
    for match in payload["matches"]:
        if not isinstance(match, dict):
            skipped += 1
            continue
        league, home, away = match.get("league"), match.get("home"), match.get("away")
        probs = odds_probabilities(match.get("odds"))
        if not all(isinstance(value, str) and value.strip() for value in (league, home, away)) or probs is None:
            skipped += 1
            continue
        rows.append({
            "match_id": match.get("sourceEventId") or match.get("matchNum"),
            "league": league,
            "home": home,
            "away": away,
            "prob_home": round(probs[0], 6),
            "prob_draw": round(probs[1], 6),
            "prob_away": round(probs[2], 6),
            "probability_basis": "de-vigged_market_odds",
            "ev_value": None,
            "recommendation": "观察：未提供独立且已校准的模型概率",
            "match_time": match.get("time"),
            "kickoff": match.get("time"),
            "risk": "待验证",
            "odds": match.get("odds"),
            "data_quality": match.get("dq"),
        })
    if not rows:
        raise ExportError("No valid matches with three-way odds were returned; existing dashboard data was preserved.")
    return {
        "update_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_updated_at": payload["updatedAt"],
        "source": payload.get("source", "JPi live football API"),
        "stale": False,
        "summary": {
            "total_matches": len(rows),
            "ev_positive_count": 0,
            "model_version": "V17.0",
            "probability_basis": "de-vigged_market_odds; not independent model probabilities",
            "skipped_invalid_matches": skipped,
        },
        "matches": rows,
    }


def main() -> int:
    try:
        endpoint = source_endpoint(os.getenv("JPI_API_URL", ""))
        source_payload = fetch_live_data(endpoint)
        dashboard_payload = build_dashboard_payload(source_payload)
        serialized = json.dumps(dashboard_payload, ensure_ascii=False, indent=2) + "\n"
        temporary = OUTPUT.with_suffix(OUTPUT.suffix + ".tmp")
        temporary.write_text(serialized, encoding="utf-8")
        temporary.replace(OUTPUT)
        print(
            f"Exported {len(dashboard_payload['matches'])} live matches from {endpoint}; "
            f"source_updated_at={dashboard_payload['source_updated_at']}."
        )
        return 0
    except ExportError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"ERROR: File operation failed: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
