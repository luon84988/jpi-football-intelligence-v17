/** Only validated, unique, non-conflicting official 1X2 observations may enter the live D1 cache. */
type OfficialFeedQuality = {
  totalCount: number; publishableCount: number; invalidCount: number; duplicateCount: number;
};

export function selectPublishableOfficialFeed(matches: unknown[]): {
  matches: Record<string, unknown>[]; quality: OfficialFeedQuality;
} {
  // A duplicate event with different prices or teams is ambiguous without an
  // upstream quote timestamp. Reject the entire event rather than trusting
  // whichever row happens to appear first in the feed.
  const fingerprints = new Map<string, string>();
  const selected = new Map<string, Record<string, unknown>>();
  let duplicateCount = 0;
  for (const candidate of matches) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const match = candidate as Record<string, unknown>;
    const id = typeof match.sourceEventId === "string" ? match.sourceEventId.trim() : "";
    if (!id || /^(undefined|null|none|nan|unknown|-)$/i.test(id)) continue;
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

    const fingerprint = JSON.stringify([
      (match.league as string).trim(), (match.home as string).trim(),
      (match.away as string).trim(), odds.map(Number),
    ]);
    if (fingerprints.has(id)) {
      duplicateCount++;
      if (fingerprints.get(id) !== fingerprint) selected.delete(id);
      continue;
    }
    fingerprints.set(id, fingerprint);
    selected.set(id, { ...match, sourceEventId: id });
  }
  const rows = [...selected.values()];
  return { matches: rows, quality: {
    totalCount: matches.length, publishableCount: rows.length,
    invalidCount: matches.length - rows.length, duplicateCount,
  } };
}

/** Backwards-compatible summary for monitoring and regression tests. */
export function summarizeOfficialFeed(matches: unknown[]): OfficialFeedQuality {
  return selectPublishableOfficialFeed(matches).quality;
}
