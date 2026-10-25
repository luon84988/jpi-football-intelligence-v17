/** Read-only D1 cache probe; never implies verified source odds or immutable history. */
const CACHE_KEY = "sporttery_current";

export async function probeLiveFootballStorage(db: D1Database | undefined) {
  const unavailable = {
    status: "unavailable", storage: "unavailable", cacheRecordFound: false,
    cacheUpdatedAt: null, matchCount: 0, source: null,
    officialQuoteTimeVerified: false, immutableHistoryVerified: false,
    independentModelVerified: false,
  };
  if (!db) return unavailable;
  try {
    // Do not call ensureCache(): a health probe must never create tables or write rows.
    const row = await db.prepare("SELECT payload, updated_at FROM live_football_cache WHERE cache_key=?")
      .bind(CACHE_KEY).first<{ payload: string; updated_at: string }>();
    const base = { ...unavailable, storage: "D1" };
    if (!row) return { ...base, status: "empty" };
    let payload: unknown;
    try { payload = JSON.parse(row.payload); } catch { return { ...base, status: "invalid_cache" }; }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ...base, status: "invalid_cache" };
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.matches) || typeof row.updated_at !== "string" ||
        record.updatedAt !== row.updated_at || record.source !== "中国体育彩票官方竞彩" ||
        record.matches.length === 0 || record.stale === true) {
      return { ...base, status: "invalid_cache" };
    }
    return {
      ...base, status: "cache_present", cacheRecordFound: true,
      cacheUpdatedAt: row.updated_at, matchCount: record.matches.length,
      source: record.source,
    };
  } catch {
    // Missing binding, table or D1 outage: no error details or credentials in public responses.
    return unavailable;
  }
}
