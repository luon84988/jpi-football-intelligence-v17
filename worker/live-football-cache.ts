/** Official feed cache plus append-only, content-addressed odds snapshots. */
const CACHE_KEY = "sporttery_current";

const ensureCache = (db: D1Database) => db.prepare(`CREATE TABLE IF NOT EXISTS live_football_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run();

const ensureSnapshots = (db: D1Database) => db.prepare(`CREATE TABLE IF NOT EXISTS live_football_snapshots (
  snapshot_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  source TEXT NOT NULL,
  match_count INTEGER NOT NULL
)`).run();

/** Append one event per observed market-state transition, including A→B→A reversals. */
const ensureTransitionLog = async (db: D1Database) => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS live_football_snapshot_head (
    cache_key TEXT PRIMARY KEY,
    snapshot_hash TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS live_football_snapshot_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_hash TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    previous_snapshot_hash TEXT
  )`).run();
};

/** Canonicalize official three-way market states, independent of model scores and row order. */
function canonicalMarkets(matches: unknown[]) {
  const markets: Array<{ id: string; odds: string[]; handicap: string | null; hhadOdds: string[] | null }> = [];
  for (const match of matches) {
    if (!match || typeof match !== "object") continue;
    const row = match as Record<string, unknown>;
    if (!Array.isArray(row.odds) || row.odds.length !== 3) continue;
    const odds = row.odds.map(Number);
    if (!odds.every(value => Number.isFinite(value) && value > 1)) continue;
    const id = String(row.sourceEventId ?? "").trim();
    if (!id || id === "undefined" || id === "null") {
      throw new Error("Official odds row is missing a stable sourceEventId");
    }
    const handicap = row.handicap == null || String(row.handicap).trim() === ""
      ? null : String(Number(row.handicap));
    if (handicap === "NaN" || handicap === "Infinity") {
      throw new Error("Official odds row has an invalid handicap");
    }
    const hhadValues = typeof row.hhadOdds === "string" ? row.hhadOdds.split("/").map(Number) : [];
    const hhadOdds = hhadValues.length === 3 && hhadValues.every(value => Number.isFinite(value) && value > 1)
      ? hhadValues.map(String) : null;
    markets.push({ id, odds: odds.map(String), handicap, hhadOdds });
  }
  if (!markets.length) throw new Error("Official feed has no identifiable valid three-way odds");
  markets.sort((a, b) => a.id.localeCompare(b.id));
  if (markets.some((market, index) => index > 0 && market.id === markets[index - 1].id)) {
    throw new Error("Official feed contains duplicate sourceEventId values");
  }
  return markets;
}

/**
 * Persist the last-success cache and an immutable snapshot atomically.
 * A repeated identical market state updates the cache without adding a transition.
 * If odds return to a previous state (A→B→A), append a new transition event
 * even though the immutable market-state body already exists.
 * The hash describes content, NOT an independently verified upstream quote time.
 */
export async function saveLiveFootballCache(db: D1Database, payload: Record<string, unknown>) {
  const matches = payload.matches;
  if (payload.source !== "中国体育彩票官方竞彩" || payload.stale === true ||
      !Array.isArray(matches) || matches.length === 0) {
    throw new Error("Refusing to persist non-official, stale or empty football data");
  }
  const health = payload.sourceHealth;
  if (!health || typeof health !== "object" ||
      (health as { succeeded?: number }).succeeded !== 1 ||
      (health as { hasData?: boolean }).hasData !== true) {
    throw new Error("Official source health is not verified");
  }
  const markets = canonicalMarkets(matches);
  const updatedAt = payload.updatedAt;
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Official payload is missing a valid retrieval timestamp");
  }
  const serialized = JSON.stringify(payload);
  const fingerprint = JSON.stringify({ source: payload.source, markets });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const snapshotHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  await ensureCache(db);
  await ensureSnapshots(db);
  await ensureTransitionLog(db);
  const results = await db.batch([
    db.prepare(`INSERT INTO live_football_snapshots (snapshot_hash,payload,first_seen_at,source,match_count)
      VALUES (?,?,?,?,?) ON CONFLICT(snapshot_hash) DO NOTHING`)
      .bind(snapshotHash, serialized, updatedAt, payload.source, markets.length),
    db.prepare(`INSERT INTO live_football_snapshot_events (snapshot_hash,observed_at,previous_snapshot_hash)
      SELECT ?,?,(SELECT snapshot_hash FROM live_football_snapshot_head WHERE cache_key=?)
      WHERE NOT EXISTS (
        SELECT 1 FROM live_football_snapshot_head WHERE cache_key=? AND snapshot_hash=?
      )`).bind(snapshotHash, updatedAt, CACHE_KEY, CACHE_KEY, snapshotHash),
    db.prepare(`INSERT INTO live_football_snapshot_head (cache_key,snapshot_hash) VALUES (?,?)
      ON CONFLICT(cache_key) DO UPDATE SET snapshot_hash=excluded.snapshot_hash`)
      .bind(CACHE_KEY, snapshotHash),
    db.prepare(`INSERT INTO live_football_cache (cache_key,payload,updated_at) VALUES (?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
      .bind(CACHE_KEY, serialized, updatedAt),
  ]);
  if (results.length !== 4 || results.some(result => result.success !== true)) {
    throw new Error("D1 did not acknowledge snapshot, transition, head and cache writes");
  }
  const row = await db.prepare(`SELECT snapshot_hash FROM live_football_snapshots WHERE snapshot_hash=?`)
    .bind(snapshotHash).first<{ snapshot_hash: string }>();
  if (row?.snapshot_hash !== snapshotHash) {
    throw new Error("D1 snapshot readback verification failed");
  }
  const head = await db.prepare(`SELECT snapshot_hash FROM live_football_snapshot_head WHERE cache_key=?`)
    .bind(CACHE_KEY).first<{ snapshot_hash: string }>();
  if (head?.snapshot_hash !== snapshotHash) {
    throw new Error("D1 transition head readback verification failed");
  }
  return { snapshotHash, persisted: true };
}

export async function readLiveFootballCache(db: D1Database) {
  await ensureCache(db);
  const row = await db.prepare(`SELECT payload,updated_at FROM live_football_cache WHERE cache_key=?`)
    .bind(CACHE_KEY).first<{ payload: string; updated_at: string }>();
  if (!row) return null;
  try { return { ...JSON.parse(row.payload), updatedAt: row.updated_at, stale: true, cache: "last_success" }; }
  catch { return null; }
}
