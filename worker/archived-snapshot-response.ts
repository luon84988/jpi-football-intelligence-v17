/** Explicitly label bundled historical examples; never attest them as a live official feed. */
export function archivedSnapshotResponse(matches: unknown[]): Response {
  return Response.json(
    {
      matches,
      updatedAt: null,
      snapshotDate: "2026-08-23",
      source: "JPi bundled historical example (not a live official feed)",
      stale: true,
      error: "ARCHIVED_EXAMPLE_NOT_LIVE",
      sourceHealth: {
        requested: 0,
        succeeded: 0,
        hasData: false,
        officialCount: 0,
        mode: "archived_example",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Football-Data": "archived-example",
      },
    },
  );
}
