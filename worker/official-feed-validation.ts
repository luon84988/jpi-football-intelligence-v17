/** Only validated, unique official 1X2 observations may enter the live D1 cache. */
type OfficialFeedQuality = {
  totalCount: number; publishableCount: number; invalidCount: number; duplicateCount: number;
};

export function selectPublishableOfficialFeed(matches: unknown[]): {
  matches: Record<string, unknown>[]; quality: OfficialFeedQuality;
} {
  const seen = new Set<string>();
  const selected: Record<string, unknown>[] = [];
  let duplicateCount = 0;
  for (const candidate of matches) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const match = candidate as Record<string, unknown>;
    const id = typeof match.sourceEventId === "string" ? match.sourceEventId.trim() : "";
    if (!id || /^(undefined|null|none|nan|unknown|-)$/i.test(id)) continue;
    if (seen.has(id)) { duplicateCount++; continue; }
    if (![match.league, match.home, match.away].every(
      value => typeof value === "string" && value.trim().length > 0
    )) continue;
    const odds = match.odds;
    if (!Array.isArray(odds) || odds.length !== 3 ||
        !odds.every(value => {
          if (typeof value !== "number" && typeof value !== "string") return false;
          if (typeof value === "string" && !value.trim()) return false;
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 1;
        })) continue;
    seen.add(id);
    selected.push({ ...match, sourceEventId: id });
  }
  return { matches: selected, quality: {
    totalCount: matches.length, publishableCount: selected.length,
    invalidCount: matches.length - selected.length, duplicateCount,
  } };
}

/** Backwards-compatible summary for monitoring and regression tests. */
export function summarizeOfficialFeed(matches: unknown[]): OfficialFeedQuality {
  return selectPublishableOfficialFeed(matches).quality;
}
