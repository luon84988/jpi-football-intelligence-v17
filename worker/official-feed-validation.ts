/** Count official fixtures with usable 1X2 odds; API reachability alone is not data health. */
export function summarizeOfficialFeed(matches: unknown[]): {
  totalCount: number; publishableCount: number; invalidCount: number; duplicateCount: number;
} {
  const seen = new Set<string>();
  let publishableCount = 0, duplicateCount = 0;
  for (const candidate of matches) {
    if (!candidate || typeof candidate !== "object") continue;
    const match = candidate as Record<string, unknown>;
    const id = typeof match.sourceEventId === "string" ? match.sourceEventId.trim() : "";
    if (!id || /^(undefined|null|none|nan|unknown|-)$/i.test(id)) continue;
    if (seen.has(id)) { duplicateCount++; continue; }
    seen.add(id);
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
    publishableCount++;
  }
  return { totalCount: matches.length, publishableCount,
    invalidCount: matches.length - publishableCount, duplicateCount };
}
