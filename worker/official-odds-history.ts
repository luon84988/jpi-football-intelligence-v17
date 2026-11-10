/** Append-only, content-addressed D1 observations of official 1X2 odds.
 * first_seen_at is the Worker retrieval time, NOT the provider quote time.
 * This does not freeze a 21:30 snapshot or guarantee tamper-proof storage.
 */
const OFFICIAL_SOURCE = "中国体育彩票官方竞彩";
const MAX_SNAPSHOT_BYTES = 500_000;

/** Normalize official sales-day identity without accepting invalid calendar dates. */
function normalizeSalesDate(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") throw new Error("OFFICIAL_HISTORY_SALES_DATE_INVALID");
  const value = String(raw).trim();
  const parts = /^(\d{4})([-/]?)(\d{2})\2(\d{2})$/.exec(value);
  if (!parts) throw new Error("OFFICIAL_HISTORY_SALES_DATE_INVALID");
  const year = Number(parts[1]), month = Number(parts[3]), day = Number(parts[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error("OFFICIAL_HISTORY_SALES_DATE_INVALID");
  }
  return `${parts[1]}-${parts[3]}-${parts[4]}`;
}

function normalizeOfficialOdds(payload: Record<string, unknown>) {
  if (payload.source !== OFFICIAL_SOURCE || payload.stale === true) throw new Error("OFFICIAL_HISTORY_SOURCE_NOT_VERIFIED");
  const health = payload.sourceHealth as Record<string, unknown> | undefined;
  if (!health || health.succeeded !== 1 || health.hasData !== true) throw new Error("OFFICIAL_HISTORY_HEALTH_NOT_VERIFIED");
  const observedAt = payload.updatedAt;
  if (typeof observedAt !== "string" || !/^(?:\d{4}-\d\d-\d\d)T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("OFFICIAL_HISTORY_OBSERVED_TIME_INVALID");
  }
  if (!Array.isArray(payload.matches) || payload.matches.length === 0) throw new Error("OFFICIAL_HISTORY_NO_MATCHES");
  const ids = new Set<string>();
  const matches = payload.matches.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("OFFICIAL_HISTORY_MATCH_INVALID");
    const match = raw as Record<string, unknown>;
    const rawId = match.sourceEventId;
    if (typeof rawId !== "string" && typeof rawId !== "number") throw new Error("OFFICIAL_HISTORY_EVENT_ID_INVALID");
    const id = String(rawId).trim();
    if (!id || /^(?:undefined|null|none|nan|unknown|-)$/i.test(id) || ids.has(id)) throw new Error("OFFICIAL_HISTORY_EVENT_ID_INVALID");
    const salesDate = normalizeSalesDate(match.salesDate);
    ids.add(id);
    const odds = match.odds;
    if (!Array.isArray(odds) || odds.length !== 3) throw new Error("OFFICIAL_HISTORY_ODDS_INVALID");
    const normalizedOdds = odds.map((x) => Number(x));
    if (normalizedOdds.some((x) => !Number.isFinite(x) || x <= 1)) throw new Error("OFFICIAL_HISTORY_ODDS_INVALID");
    for (const key of ["league", "home", "away"]) {
      if (typeof match[key] !== "string" || !(match[key] as string).trim()) throw new Error("OFFICIAL_HISTORY_TEAM_INVALID");
    }
    return { eventId: id, salesDate, league: match.league,
      home: match.home, away: match.away, odds: normalizedOdds };
  });
  matches.sort((a, b) => a.eventId.localeCompare(b.eventId));
  const serialized = JSON.stringify({ source: OFFICIAL_SOURCE, quoteTimeVerified: false, matches });
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) throw new Error("OFFICIAL_HISTORY_TOO_LARGE");
  return { observedAt, serialized, matchCount: matches.length };
}

export async function appendOfficialOddsHistory(db: D1Database | undefined, payload: Record<string, unknown>) {
  if (!db) throw new Error("OFFICIAL_HISTORY_D1_UNAVAILABLE");
  const { observedAt, serialized, matchCount } = normalizeOfficialOdds(payload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const snapshotHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  await db.prepare(`CREATE TABLE IF NOT EXISTS official_odds_snapshot_history (
    snapshot_hash TEXT PRIMARY KEY,
    first_seen_at TEXT NOT NULL,
    source TEXT NOT NULL,
    quote_time_verified INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    event_count INTEGER NOT NULL
  )`).run();
  // The hash table stores unique market bodies; the transition log records
  // every CHANGE of the current head, including A -> B -> A. Both are append-only.
  await db.prepare(`CREATE TABLE IF NOT EXISTS official_odds_transition_history (
    transition_id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_hash TEXT NOT NULL,
    previous_hash TEXT,
    observed_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS official_odds_transition_head (
    head_key TEXT PRIMARY KEY,
    snapshot_hash TEXT NOT NULL
  )`).run();

  // D1 batch executes sequential statements in one transaction. The transition
  // decision happens inside SQL, not via a racy read/compare in Worker code.
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO official_odds_snapshot_history
      (snapshot_hash, first_seen_at, source, quote_time_verified, snapshot_json, event_count)
      VALUES (?, ?, ?, 0, ?, ?)`)
      .bind(snapshotHash, observedAt, OFFICIAL_SOURCE, serialized, matchCount),
    db.prepare(`INSERT INTO official_odds_transition_history (snapshot_hash, previous_hash, observed_at)
      SELECT ?, h.snapshot_hash, ?
      FROM (SELECT 1) AS seed
      LEFT JOIN official_odds_transition_head h ON h.head_key='sporttery_current'
      WHERE h.snapshot_hash IS NULL OR h.snapshot_hash != ?`)
      .bind(snapshotHash, observedAt, snapshotHash),
    db.prepare(`INSERT INTO official_odds_transition_head (head_key, snapshot_hash)
      VALUES ('sporttery_current', ?)
      ON CONFLICT(head_key) DO UPDATE SET snapshot_hash=excluded.snapshot_hash
      WHERE official_odds_transition_head.snapshot_hash != excluded.snapshot_hash`)
      .bind(snapshotHash),
    db.prepare(`SELECT snapshot_json, event_count FROM official_odds_snapshot_history WHERE snapshot_hash=?`)
      .bind(snapshotHash),
    db.prepare(`SELECT snapshot_hash FROM official_odds_transition_head WHERE head_key='sporttery_current'`),
    db.prepare(`SELECT snapshot_hash FROM official_odds_transition_history ORDER BY transition_id DESC LIMIT 1`),
  ]);
  const persisted = results[3]?.results?.[0] as { snapshot_json: string; event_count: number } | undefined;
  const head = results[4]?.results?.[0] as { snapshot_hash: string } | undefined;
  const latestTransition = results[5]?.results?.[0] as { snapshot_hash: string } | undefined;
  if (!persisted || persisted.snapshot_json !== serialized || persisted.event_count !== matchCount ||
      head?.snapshot_hash !== snapshotHash || latestTransition?.snapshot_hash !== snapshotHash) {
    throw new Error("OFFICIAL_HISTORY_WRITE_NOT_VERIFIED");
  }
  return { snapshotHash, observedAt, matchCount, quoteTimeVerified: false };
}
