import test from "node:test";
import assert from "node:assert/strict";
import { archivedSnapshotResponse } from "../worker/archived-snapshot-response.ts";

test("bundled historical fixtures cannot be mistaken for a fresh official feed", async () => {
  const matches = [{ sourceEventId: "2041001", home: "Example", away: "Example B" }];
  const response = archivedSnapshotResponse(matches);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.matches, matches);
  assert.equal(payload.snapshotDate, "2026-08-23");
  assert.equal(payload.updatedAt, null);
  assert.equal(payload.stale, true);
  assert.equal(payload.error, "ARCHIVED_EXAMPLE_NOT_LIVE");
  assert.notEqual(payload.source, "中国体育彩票官方竞彩");
  assert.equal(payload.sourceHealth.succeeded, 0);
  assert.equal(payload.sourceHealth.hasData, false);
  assert.equal(payload.sourceHealth.mode, "archived_example");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Football-Data"), "archived-example");
});

test("empty historical fixture arrays are also explicitly unverified", async () => {
  const payload = await archivedSnapshotResponse([]).json();
  assert.deepEqual(payload.matches, []);
  assert.equal(payload.stale, true);
  assert.equal(payload.sourceHealth.officialCount, 0);
});
