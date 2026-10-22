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

/**
 * Persist the last-success cache and an immutable snapshot atomically.
 * A repeated identical market state updates the cache but not the historical row.
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
  if (!matches.some((match) => {
    if (!match || typeof match !== "object") return false;
    const odds = (match as { odds?: unknown }).odds;
    return Array.isArray(odds) && odds.length === 3 &&
      odds.every((v) => Number.isFinite(Number(v)) && Number(v) > 1);
  })) {
    throw new Error("Official feed has no valid three-way odds");
  }
  const updatedAt = payload.updatedAt;
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Official payload is missing a valid retrieval timestamp");
  }
  const serialized = JSON.stringify(payload);
  const fingerprint = JSON.stringify({ source: payload.source, matches });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const snapshotHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  await ensureCache(db);
  await ensureSnapshots(db);
  const results = await db.batch([
    db.prepare(`INSERT INTO live_football_snapshots (snapshot_hash,payload,first_seen_at,source,match_count)
      VALUES (?,?,?,?,?) ON CONFLICT(snapshot_hash) DO NOTHING`)
      .bind(snapshotHash, serialized, updatedAt, payload.source, matches.length),
    db.prepare(`INSERT INTO live_football_cache (cache_key,payload,updated_at) VALUES (?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
      .bind(CACHE_KEY, serialized, updatedAt),
  ]);
  if (results.length !== 2 || results.some(result => result.success !== true)) {
    throw new Error("D1 did not acknowledge both snapshot and cache writes");
  }
  const row = await db.prepare(`SELECT snapshot_hash FROM live_football_snapshots WHERE snapshot_hash=?`)
    .bind(snapshotHash).first<{ snapshot_hash: string }>();
  if (row?.snapshot_hash !== snapshotHash) {
    throw new Error("D1 snapshot readback verification failed");
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
