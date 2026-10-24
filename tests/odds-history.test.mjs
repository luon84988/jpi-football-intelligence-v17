import test from "node:test";
import assert from "node:assert/strict";
import { writeEuropean, writeAsian } from "../worker/source-database.ts";

// Mock the D1 statement contract and the existing unique
// (match_id, bookmaker, snapshot_type, observed_at) constraint.
function fakeD1() {
  const rows = { european_odds: [], asian_lines: [] };
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      const table = sql.includes("european_odds") ? "european_odds" : "asian_lines";
      if (!["european_odds", "asian_lines"].includes(table)) throw new Error("Unexpected table");
      if (/\bDELETE\b/i.test(sql)) throw new Error("Historical deletion is forbidden");
      return {
        bind(...args) {
          return {
            async first() {
              assert.match(sql, /^SELECT 1 FROM /);
              return rows[table].some(r => r.matchId === args[0] && r.type === "OPEN") ? { present: 1 } : null;
            },
            async run() {
              assert.match(sql, /^INSERT OR IGNORE INTO /);
              const [matchId, type] = args;
              const observedAt = args.at(-2);
              if (!rows[table].some(r => r.matchId === matchId && r.type === type && r.observedAt === observedAt)) {
                rows[table].push({ matchId, type, observedAt, values: args });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db, rows, statements };
}

test("European odds retain OPEN and every distinct CURRENT timestamp", async () => {
  const { db, rows, statements } = fakeD1();
  await writeEuropean(db, "event-42", [2.1, 3.2, 3.5], "2026-10-24T10:00:00Z");
  await writeEuropean(db, "event-42", [2.0, 3.3, 3.6], "2026-10-24T10:05:00Z");
  await writeEuropean(db, "event-42", [1.9, 3.4, 3.7], "2026-10-24T10:10:00Z");
  await writeEuropean(db, "event-42", [1.9, 3.4, 3.7], "2026-10-24T10:10:00Z");
  assert.deepEqual(rows.european_odds.map(r => [r.type, r.observedAt]), [
    ["OPEN", "2026-10-24T10:00:00Z"],
    ["CURRENT", "2026-10-24T10:05:00Z"],
    ["CURRENT", "2026-10-24T10:10:00Z"],
  ]);
  for (const row of rows.european_odds) {
    const probs = row.values.slice(5, 8);
    assert.ok(Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  }
  assert.equal(statements.some(s => /\bDELETE\b/i.test(s)), false);
});

test("Asian lines retain all distinct CURRENT observations without destructive cleanup", async () => {
  const { db, rows, statements } = fakeD1();
  await writeAsian(db, "event-42", { line: -1, homeWater: 1.91, awayWater: 1.96 }, "2026-10-24T10:00:00Z");
  await writeAsian(db, "event-42", { line: -1.25, homeWater: 1.94, awayWater: 1.92 }, "2026-10-24T10:05:00Z");
  await writeAsian(db, "event-42", { line: -1, homeWater: 1.88, awayWater: 2.01 }, "2026-10-24T10:10:00Z");
  await writeAsian(db, "event-42", { line: -1, homeWater: 1.88, awayWater: 2.01 }, "2026-10-24T10:10:00Z");
  assert.deepEqual(rows.asian_lines.map(r => [r.type, r.observedAt]), [
    ["OPEN", "2026-10-24T10:00:00Z"],
    ["CURRENT", "2026-10-24T10:05:00Z"],
    ["CURRENT", "2026-10-24T10:10:00Z"],
  ]);
  assert.equal(statements.some(s => /\bDELETE\b/i.test(s)), false);
});
