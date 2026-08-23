const CACHE_KEY = "sporttery_current";

const ensureCache = (db: D1Database) => db.prepare(`CREATE TABLE IF NOT EXISTS live_football_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run();

export async function saveLiveFootballCache(db: D1Database, payload: Record<string, unknown>) {
  await ensureCache(db);
  const updatedAt = String(payload.updatedAt || new Date().toISOString());
  await db.prepare(`INSERT INTO live_football_cache (cache_key,payload,updated_at) VALUES (?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
    .bind(CACHE_KEY, JSON.stringify(payload), updatedAt).run();
}

export async function readLiveFootballCache(db: D1Database) {
  await ensureCache(db);
  const row = await db.prepare(`SELECT payload,updated_at FROM live_football_cache WHERE cache_key=?`).bind(CACHE_KEY).first<{payload:string;updated_at:string}>();
  if (!row) return null;
  try { return { ...JSON.parse(row.payload), updatedAt: row.updated_at, stale: true, cache: "last_success" }; }
  catch { return null; }
}
