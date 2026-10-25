import test from 'node:test';
import assert from 'node:assert/strict';
import { appendOfficialOddsHistory } from '../worker/official-odds-history.ts';

const fixture = () => ({
  source: '中国体育彩票官方竞彩', stale: false, updatedAt: '2026-10-25T04:30:00Z',
  sourceHealth: { succeeded: 1, hasData: true },
  matches: [{ sourceEventId: '100', salesDate: '2026-10-25', league: '英超', home: 'A', away: 'B', odds: ['2.10', '3.30', '3.50'] }],
});
function fakeDb({ corruptRead = false, failInsert = false } = {}) {
  const rows = new Map(); const statements = [];
  return {
    rows, statements,
    prepare(sql) {
      statements.push(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (sql.includes('INSERT OR IGNORE')) {
            if (failInsert) throw new Error('D1_WRITE_FAILED');
            if (!rows.has(args[0])) rows.set(args[0], { snapshot_json: args[3], event_count: args[4], first_seen_at: args[1] });
          }
          return { success: true };
        },
        async first() {
          const row = rows.get(args[0]);
          return corruptRead && row ? { ...row, snapshot_json: '{"corrupted":true}' } : row ?? null;
        },
      };
    },
  };
}

test('append-only history verifies D1 readback and never changes first observation', async () => {
  const db = fakeDb();
  const first = await appendOfficialOddsHistory(db, fixture());
  const again = fixture(); again.updatedAt = '2026-10-25T04:35:00Z';
  const second = await appendOfficialOddsHistory(db, again);
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(db.rows.size, 1);
  assert.equal([...db.rows.values()][0].first_seen_at, first.observedAt);
  assert.equal(first.quoteTimeVerified, false);
  assert.equal(db.statements.some(x => /\bUPDATE\b|\bDELETE\b|\bREPLACE\b/i.test(x)), false);
});

test('changed odds create a distinct historical observation', async () => {
  const db = fakeDb();
  await appendOfficialOddsHistory(db, fixture());
  const changed = fixture(); changed.matches[0].odds[0] = '2.20';
  await appendOfficialOddsHistory(db, changed);
  assert.equal(db.rows.size, 2);
});

test('nonofficial, stale, malformed and duplicate observations fail closed before D1 write', async () => {
  const bad = [
    { source: 'fallback' }, { stale: true }, { sourceHealth: { succeeded: 0, hasData: false } },
    { updatedAt: '2026-10-25 04:30' }, { matches: [] },
    { matches: [{ ...fixture().matches[0], odds: ['-', '3.2', '2.0'] }] },
    { matches: [fixture().matches[0], fixture().matches[0]] },
  ];
  for (const changes of bad) {
    const db = fakeDb();
    await assert.rejects(appendOfficialOddsHistory(db, { ...fixture(), ...changes }));
    assert.equal(db.statements.length, 0);
  }
});

test('missing D1, insert errors and readback mismatch cannot claim persistence', async () => {
  await assert.rejects(appendOfficialOddsHistory(undefined, fixture()), /D1_UNAVAILABLE/);
  await assert.rejects(appendOfficialOddsHistory(fakeDb({ failInsert: true }), fixture()), /D1_WRITE_FAILED/);
  await assert.rejects(appendOfficialOddsHistory(fakeDb({ corruptRead: true }), fixture()), /WRITE_NOT_VERIFIED/);
});
