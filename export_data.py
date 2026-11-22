#!/usr/bin/env python3
"""Export a dashboard snapshot from the live JPi Worker API.

This script deliberately has no mock-data fallback. A failed, stale, or malformed
source response must never overwrite the last known dashboard snapshot.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

OUTPUT = Path(__file__).with_name("dashboard_data.json")
MAX_AGE_SECONDS = int(os.getenv("MAX_SOURCE_AGE_SECONDS", "1800"))


class ExportError(RuntimeError):
    pass


class LiveHTTPError(ExportError):
    def __init__(self, status: int, message: str, *,
                 upstream_status: int | None = None,
                 upstream_outcome: str | None = None):
        super().__init__(message)
        self.status = status
        self.upstream_status = upstream_status
        self.upstream_outcome = upstream_outcome


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


SITES_SERVICE_HOST = "jpi-football-intelligence-v17.luonan.chatgpt.site"


class RejectCredentialRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ExportError("Authenticated API redirects are disabled; configure the final trusted endpoint.")


def api_request(endpoint: str) -> tuple[Request, bool]:
    headers = {"Accept": "application/json", "User-Agent": "JPi-V17-dashboard-export/1.0"}
    token = os.getenv("SITES_SERVICE_TOKEN", "").strip()
    parsed = urlparse(endpoint)
    if token:
        if (parsed.scheme != "https" or parsed.hostname != SITES_SERVICE_HOST
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.path not in {"/api/football/live", "/api/football/observations"} or parsed.query or parsed.fragment):
            raise ExportError("SITES_SERVICE_TOKEN may only be sent to the configured JPi Sites HTTPS live endpoint.")
        headers["OAI-Sites-Authorization"] = f"Bearer {token}"
    else:
        if parsed.hostname == SITES_SERVICE_HOST:
            raise ExportError("Configure the SITES_SERVICE_TOKEN Actions secret for the private JPi Site.")
        api_key = os.getenv("API_KEY", "").strip()
        if api_key:
            if parsed.scheme != "https" or parsed.username or parsed.password:
                raise ExportError("API_KEY requires an HTTPS endpoint without URL credentials.")
            headers["Authorization"] = f"Bearer {api_key}"
    return Request(endpoint, headers=headers, method="GET"), bool(token or os.getenv("API_KEY", "").strip())


def observation_source(payload: dict) -> bool:
    return (os.getenv("JPI_ALLOW_THIRD_PARTY_OBSERVATIONS") == "1"
            and payload.get("sourceKind") == "THIRD_PARTY_JINGCAI_OBSERVATIONS"
            and payload.get("officialVerification") == "NOT_VERIFIED"
            and payload.get("analysisStatus") == "PRE_ANALYSIS"
            and payload.get("formalEligible") is False)


def validate_source(payload: dict) -> None:
    observed = observation_source(payload)
    if not observed and payload.get("source") != "中国体育彩票官方竞彩":
        raise ExportError("Only current official Sporttery data may be published; fallback or cached sources are rejected.")
    health = payload.get("sourceHealth")
    if not isinstance(health, dict) or health.get("succeeded") != (2 if observed else 1) or health.get("hasData") is not True:
        raise ExportError("Official source health is not verified; refusing to publish.")
    if observed:
        proof = payload.get("persistence", {})
        import re
        if (health.get("officialVerified") is not False or proof.get("status") != "verified"
                or not re.fullmatch(r"[a-f0-9]{64}", str(payload.get("snapshotHash", "")))
                or proof.get("snapshotHash") != payload.get("snapshotHash")):
            raise ExportError("Third-party observation persistence proof is missing")
        if not payload.get("matches") or any(not isinstance(m, dict) or not str(m.get("sourceEventId", "")).startswith("observed:") or m.get("formalEligible") is not False for m in payload["matches"]):
            raise ExportError("Third-party match identity or analysis boundary is invalid")


def http_failure_details(error: HTTPError) -> tuple[str, int | None, str | None]:
    """Return bounded, typed Worker diagnostics without logging arbitrary response text."""
    message = f"Live API returned HTTP {error.code}."
    try:
        raw = error.read(8193)
        if len(raw) > 8192:
            return message, None, None
        payload = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError, TypeError):
        return message, None, None
    if not isinstance(payload, dict):
        return message, None, None
    details = []
    if payload.get("error") == "OFFICIAL_SOURCE_TEMPORARILY_UNAVAILABLE":
        details.append("worker_error=OFFICIAL_SOURCE_TEMPORARILY_UNAVAILABLE")
    if type(payload.get("stale")) is bool:
        details.append("stale=" + str(payload["stale"]).lower())
    upstream_status = None
    upstream_outcome = None
    attempt = payload.get("sourceAttempt")
    if isinstance(attempt, dict):
        status = attempt.get("status")
        if type(status) is int and 100 <= status <= 599:
            upstream_status = status
            details.append(f"upstream_status={status}")
        outcome = attempt.get("outcome")
        if outcome in ("http_error", "invalid_json", "invalid_match_groups", "received",
                       "empty_slate", "timeout", "request_failed"):
            upstream_outcome = outcome
            details.append("upstream_outcome=" + outcome)
    return message + (" " + "; ".join(details) if details else ""), upstream_status, upstream_outcome


def http_failure_message(error: HTTPError) -> str:
    return http_failure_details(error)[0]


def fetch_live_data(endpoint: str) -> dict:
    request, authenticated = api_request(endpoint)
    open_request = build_opener(RejectCredentialRedirects()).open if authenticated else urlopen
    try:
        with open_request(request, timeout=25) as response:
            if response.status != 200:
                raise LiveHTTPError(response.status, f"Live API returned HTTP {response.status}.")
            raw = response.read(5_000_001)
    except HTTPError as exc:
        message, upstream_status, upstream_outcome = http_failure_details(exc)
        raise LiveHTTPError(
            exc.code, message, upstream_status=upstream_status,
            upstream_outcome=upstream_outcome,
        ) from exc
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
        attempt = payload.get("sourceAttempt") or {}
        raise ExportError(f"Live API is unavailable or stale: {payload.get('error', 'stale=true')}; upstream_status={attempt.get('status')}; upstream_outcome={attempt.get('outcome')}")
    validate_source(payload)
    matches = payload.get("matches")
    if not isinstance(matches, list) or not matches:
        raise ExportError("Live API returned no matches; refusing to replace the existing snapshot.")
    updated_at = payload.get("updatedAt")
    if not isinstance(updated_at, str):
        raise ExportError("Live API is missing its updatedAt timestamp.")
    try:
        timestamp = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ExportError("Live API updatedAt must include a timezone.")
    except ValueError as exc:
        raise ExportError("Live API updatedAt is not a valid ISO-8601 timestamp.") from exc
    age = (datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)).total_seconds()
    if age < -300:
        raise ExportError("Live API timestamp is more than five minutes in the future.")
    if age > MAX_AGE_SECONDS:
        raise ExportError(f"Live API data is {int(age)} seconds old (limit {MAX_AGE_SECONDS}); refusing to publish stale data.")
    return payload


def build_dashboard_payload(payload: dict) -> dict:
    validate_source(payload)
    matches = payload.get("matches")
    if not isinstance(matches, list):
        raise ExportError("Source matches must be a list.")
    rows = []
    seen = set()
    skipped = 0
    for match in matches:
        if not isinstance(match, dict):
            skipped += 1
            continue
        league, home, away = match.get("league"), match.get("home"), match.get("away")
        match_id = match.get("sourceEventId") or match.get("matchNum")
        if (type(match_id) not in (str, int) or not str(match_id).strip()
                or not all(isinstance(value, str) and value.strip() for value in (league, home, away))
                or home.strip() == away.strip()):
            skipped += 1
            continue
        identity = str(match_id)
        if identity in seen:
            raise ExportError("Duplicate source match identity; existing dashboard data was preserved.")
        seen.add(identity)
        rows.append({
            "match_id": identity,
            "league": league,
            "home": home,
            "away": away,
            "prob_home": None,
            "prob_draw": None,
            "prob_away": None,
            "probability_basis": "UNAVAILABLE",
            "recommendation": "观察：未提供独立且已校准的模型概率",
            "match_time": match.get("time"),
            "kickoff": match.get("kickoff"),
            "kickoff_display": match.get("time"),
            "risk": "待验证",
            "data_quality": match.get("dq"),
        })
    if not rows:
        raise ExportError("No valid fixtures with a match identity were returned; existing dashboard data was preserved.")
    return {
        "update_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_updated_at": payload["updatedAt"],
        "source": payload.get("source", "JPi live football API"),
        "stale": False,
        "analysis_status": "PRE_ANALYSIS",
        "source_kind": "THIRD_PARTY_JINGCAI_OBSERVATIONS" if observation_source(payload) else "OFFICIAL_FIXTURE_OBSERVATION",
        "official_verified": not observation_source(payload),
        "snapshot_hash": payload.get("snapshotHash"),
        "formal_eligible": False,
        "summary": {
            "total_matches": len(rows),
            "model_version": "V17.0",
            "analysis_status": "PRE_ANALYSIS",
            "probability_basis": "UNAVAILABLE",
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


