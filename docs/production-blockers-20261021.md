# Production data pipeline verification (2026-10-21)

The latest main dashboard snapshot has `status: no_api_key` and zero matches. The latest successful GitHub Pages deployment verifies only static hosting, not live data collection.

Required independent evidence before declaring the system operational:

1. A deployed Worker URL and successful fresh response from `/api/football/live`, with official source provenance and valid three-way odds.
2. GitHub Actions production export using the configured `JPI_API_URL`, with a fresh nonempty `dashboard_data.json` committed to `main`.
3. D1 binding verified against the actual deployed environment, plus a successful write/read of the last official snapshot; the existing `ctx.waitUntil` cache write is not proof of persistence.
4. GitHub Pages showing that exact fresh snapshot and market probabilities, with a documented model provenance.
5. Historical immutable snapshot retention and replayable analysis/backtest evidence. The current single-row `live_football_cache` upsert does not provide an immutable history.

The frontend currently gates the market probability display on the presence of `m.scores`, but the official exporter deliberately does not produce model score predictions. Therefore valid market probabilities remain hidden until that condition is fixed. Do not present de-vigged odds as calibrated model probabilities or claim positive EV without independent evidence.

Do not paste API secrets or Cloudflare tokens into this repository. No production data has been modified by this document.
