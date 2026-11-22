# Production collection and publication

The deployed Site source is maintained in the Sites source repository. The matching application files are mirrored into `luon84988/jpi-football-intelligence-v17`; deploy the matching Worker and Actions revisions together. The V17 Word manual describes historical behavior.

## Data path

GitHub Actions `JPi V17 Auto Run` executes `scripts/domestic.py`, retaining exact public 500 and OKOOO response bytes and per-source observations. Current Beijing sales date, match number, teams and kickoff must agree. Both sources must report the fixture available. Failed or conflicting inputs never overwrite successful snapshots.

`scripts/upload_observations.py` uses the existing host-bound `SITES_SERVICE_TOKEN` to POST to `/api/football/observations`. It sends no credentials to upstream sources. The private Site validates provenance, capture hashes, timestamps, fixture identity agreement and bounded payloads, then atomically appends raw captures and snapshot envelopes to D1. It rereads the stored snapshot and bytes before acknowledging success. Repeated delivery is idempotent.

`GET /api/football/live` attempts the official source first. It accepts one or more uniquely identified official fixtures and awaits D1 cache readback. When official access fails, a current, saved 500/OKOOO snapshot may be returned with explicit third-party provenance, namespaced observation IDs and PRE_ANALYSIS status. Published observations expire after 30 minutes; sold or started matches are excluded. Archived bundled examples require an explicit historical date plus allowFallback=1 and have no fresh timestamp.

The exporter accepts third-party observations only with `JPI_ALLOW_THIRD_PARTY_OBSERVATIONS=1`, matching persistence receipt, PRE_ANALYSIS and NOT_VERIFIED flags. Its default remains official-only. The snapshot exposes schedule and provenance. Independent match probabilities are currently unavailable. Monitoring reports collection health, official-source status and formal readiness separately. A healthy observation feed does not certify the official feed or the model.

## Formal analysis

Each saved envelope contains source-referenced partial fixture inputs and explicit missing inputs. There are no invented Elo, xG, injury, lineup, rule-validation or historical backtest values. Seven AC stages remain unpassed until their real evidence exists; test fixtures and fixture-only output must never be counted as formal analyses or backtest samples.

## Acceptance and recovery

1. Verify the collector's actual run and POST persistence receipt (snapshot hash, observation time, sales date and count).
2. Read `/api/football/observations` and D1 `domestic_feed_snapshots`; verify matching hash and current date. Raw bytes are in `domestic_source_captures`.
3. Read `/api/football/live`; verify sourceKind, stale=false and analysisStatus=PRE_ANALYSIS. If official HTTP 567 persists, report that status separately.
4. Verify dashboard_data.json's source, source_updated_at, snapshot_hash and formal_eligible=false; inspect the website's actual displayed teams and date.
5. Failed collection/upload/export must leave previous immutable evidence intact. A stale feed remains an alert. Never refresh evidence timestamps or relabel old data.

Database migration 0005 adds only the two observation tables. Existing tables/data are preserved. Rollback uses the previous saved Site version and the matching GitHub revision; additive tables may remain. Do not replay old snapshots as current evidence.

Deploy the Sites Worker before switching the Actions collector. The updated Worker accepts both existing observation snapshots and fixture-only observations. The export requires a source match identity and teams; probability fields stay null until an independent model is wired into the export.


## Health-monitor retry boundary

The read-only health monitor retries at most once only when Worker diagnostics identify an upstream HTTP 500/502/503/504 or an explicit timeout/request failure. Upstream 567 policy denials, other 4xx responses, quota responses, and unclassified HTTP 503 errors are not retried. A scheduled monitor failure may trigger the separate authorized 500/OKOOO observation refresh; that refresh remains PRE_ANALYSIS and NOT_VERIFIED and does not restore official-source health.
