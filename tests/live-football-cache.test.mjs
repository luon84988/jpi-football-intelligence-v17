import test from "node:test";
import assert from "node:assert/strict";
import { saveLiveFootballCache, readLiveFootballCache } from "../worker/live-football-cache.ts";

class MemoryD1 {
  constructor() { this.snapshots = new Map(); this.cache = null; this.fail = false; }
  prepare(sql) {
    const db = this;
    return {
      params: [],
      bind(...params) { this.params = params; return this; },
      async run() { return { success: true }; },
      async first() {
        if (sql.includes("FROM live_football_snapshots"))
          return db.snapshots.has(this.params[0]) ? { snapshot_hash: this.params[0] } : null;
        return db.cache;
      }
    };
  }
  async batch(stmts) {
    if (this.fail) throw Error("database failure");
    const [hash, data] = stmts[0].params;
    if (!this.snapshots.has(hash)) this.snapshots.set(hash, data);
    this.cache = { payload: stmts[1].params[1], updated_at: stmts[1].params[2] };
    return [{ success: true }, { success: true }];
  }
}
const official = (odds=["1.8","3.4","4.2"]) => ({
  source: "中国体育彩票官方竞彩", stale: false, updatedAt: "2026-10-22T00:00:00Z",
  sourceHealth: { succeeded: 1, hasData: true },
  matches: [{ sourceEventId: "m1", odds }]
});
test("rejects invalid or stale input", async () => {
  const db = new MemoryD1();
  await assert.rejects(saveLiveFootballCache(db, { ...official(), matches: [] }));
  await assert.rejects(saveLiveFootballCache(db, { ...official(), stale: true }));
  await assert.rejects(saveLiveFootballCache(db, { ...official(), matches: [{ odds: ["—","—","—"] }] }));
  assert.equal(db.snapshots.size, 0);
});
test("persists a content-addressed snapshot and readable cache", async () => {
  const db = new MemoryD1();
  const a = await saveLiveFootballCache(db, official());
  const b = await saveLiveFootballCache(db, official());
  assert.equal(a.snapshotHash, b.snapshotHash);
  assert.equal(db.snapshots.size, 1);
  assert.equal((await readLiveFootballCache(db)).stale, true);
  const c = await saveLiveFootballCache(db, official(["1.9","3.2","4.0"]));
  assert.notEqual(a.snapshotHash, c.snapshotHash);
  assert.equal(db.snapshots.size, 2);
});
test("does not report success on database failure", async () => {
  const db = new MemoryD1(); db.fail = true;
  await assert.rejects(saveLiveFootballCache(db, official()), /database failure/);
});

test("ignores derived model changes, odds formatting and match ordering", async () => {
  const db = new MemoryD1();
  const first = { ...official(), matches: [
    { sourceEventId: "m2", odds: ["1.8", "3.4", "4.2"], homeXg: 1.1 },
    { sourceEventId: "m1", odds: ["2.0", "3.1", "3.8"], signal: "home" },
  ] };
  const second = { ...official(), updatedAt: "2026-10-22T00:02:00Z", matches: [
    { sourceEventId: "m1", odds: ["2.00", "3.10", "3.80"], signal: "draw" },
    { sourceEventId: "m2", odds: ["1.80", "3.40", "4.20"], homeXg: 1.7 },
  ] };
  const a = await saveLiveFootballCache(db, first);
  const originalSnapshot = db.snapshots.get(a.snapshotHash);
  const b = await saveLiveFootballCache(db, second);
  assert.equal(a.snapshotHash, b.snapshotHash);
  assert.equal(db.snapshots.size, 1);
  assert.equal(db.snapshots.get(a.snapshotHash), originalSnapshot);
  assert.equal(JSON.parse(db.cache.payload).matches[0].signal, "draw");
});
test("retains changes in handicap odds as distinct snapshots", async () => {
  const db = new MemoryD1();
  const a = await saveLiveFootballCache(db, { ...official(), matches: [{sourceEventId:"m1",odds:["1.8","3.4","4.2"],handicap:"-1",hhadOdds:"2.5/3.2/2.1"}] });
  const b = await saveLiveFootballCache(db, { ...official(), matches: [{sourceEventId:"m1",odds:["1.8","3.4","4.2"],handicap:"-1",hhadOdds:"2.6/3.2/2.1"}] });
  assert.notEqual(a.snapshotHash, b.snapshotHash);
  assert.equal(db.snapshots.size, 2);
});
test("rejects missing or duplicated official event identifiers", async () => {
  const db = new MemoryD1();
  await assert.rejects(saveLiveFootballCache(db, {...official(), matches:[{odds:["1.8","3.4","4.2"]}]}), /sourceEventId/);
  await assert.rejects(saveLiveFootballCache(db, {...official(), matches:[official().matches[0], official().matches[0]]}), /duplicate/);
  assert.equal(db.snapshots.size, 0);
});
