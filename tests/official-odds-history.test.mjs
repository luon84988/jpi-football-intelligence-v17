import test from 'node:test';
import assert from 'node:assert/strict';
import { appendOfficialOddsHistory } from '../worker/official-odds-history.ts';

const fixture = () => ({
  source: '中国体育彩票官方竞彩', stale: false, updatedAt: '2026-10-25T04:30:00Z',
  sourceHealth: { succeeded: 1, hasData: true },
  matches: [{ sourceEventId: '100', salesDate: '2026-10-25', league: '英超', home: 'A', away: 'B', odds: ['2.10', '3.30', '3.50'] }],
});
function fakeDb({ corruptRead = false, failInsert = false, failTransition = false } = {}) {
  const rows = new Map(); const transitions = []; const statements = [];
  let head = null;
  const db = {
    rows, transitions, statements,
    get head() { return head; },
    prepare(sql) {
      statements.push(sql);
      let args = [];
      return {
        sql,
        get args() { return args; },
        bind(...values) { args = values; return this; },
        async run() { return { success: true }; },
      };
    },
    async batch(steps) {
      const oldRows = new Map(rows), oldTransitions = transitions.slice(), oldHead = head;
      try {
        const results = [];
        for (const stmt of steps) {
          const { sql, args } = stmt;
          if (sql.includes('INSERT OR IGNORE INTO official_odds_snapshot_history')) {
            if (failInsert) throw new Error('D1_WRITE_FAILED');
            if (!rows.has(args[0])) rows.set(args[0], {
              snapshot_json: args[3], event_count: args[4], first_seen_at: args[1],
            });
            results.push({ success: true });
          } else if (sql.includes('INSERT INTO official_odds_transition_history')) {
            if (failTransition) throw new Error('D1_TRANSITION_FAILED');
            if (head !== args[0]) transitions.push({
              snapshot_hash: args[0], previous_hash: head, observed_at: args[1],
            });
            results.push({ success: true });
          } else if (sql.includes('INSERT INTO official_odds_transition_head')) {
            head = args[0]; results.push({ success: true });
          } else if (sql.includes('SELECT snapshot_json, event_count')) {
            const row = rows.get(args[0]);
            results.push({ results: row ? [corruptRead ? { ...row, snapshot_json: '{"corrupted":true}' } : row] : [] });
          } else if (sql.includes('SELECT snapshot_hash FROM official_odds_transition_head')) {
            results.push({ results: head ? [{ snapshot_hash: head }] : [] });
          } else if (sql.includes('SELECT snapshot_hash FROM official_odds_transition_history')) {
            results.push({ results: transitions.length ? [transitions.at(-1)] : [] });
          } else {
            throw new Error('UNEXPECTED_SQL');
          }
        }
        return results;
      } catch (error) {
        rows.clear(); for (const [key, value] of oldRows) rows.set(key, value);
        transitions.splice(0, transitions.length, ...oldTransitions); head = oldHead;
        throw error;
      }
    },
  };
  return db;
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

test('official sales dates normalize to one stable market identity', async () => {
  const db = fakeDb();
  const canonical = await appendOfficialOddsHistory(db, fixture());
  for (const salesDate of ['20261025', '2026/10/25']) {
    const next = fixture(); next.matches[0].salesDate = salesDate;
    const result = await appendOfficialOddsHistory(db, next);
    assert.equal(result.snapshotHash, canonical.snapshotHash);
  }
  assert.equal(db.rows.size, 1);
});

test('invalid sales dates and placeholder event IDs fail before D1 operations', async () => {
  const invalid = [
    { salesDate: '' }, { salesDate: null }, { salesDate: '2026-02-30' },
    { salesDate: '2026-13-01' }, { salesDate: '2026-10-2' },
    { sourceEventId: 'UNKNOWN' }, { sourceEventId: 'None' },
    { sourceEventId: false }, { sourceEventId: ' - ' },
  ];
  for (const change of invalid) {
    const db = fakeDb();
    const input = fixture();
    input.matches[0] = { ...input.matches[0], ...change };
    await assert.rejects(appendOfficialOddsHistory(db, input), /OFFICIAL_HISTORY_(SALES_DATE|EVENT_ID)_INVALID/);
    assert.equal(db.statements.length, 0);
  }
});

test('missing D1, insert errors and readback mismatch cannot claim persistence', async () => {
  await assert.rejects(appendOfficialOddsHistory(undefined, fixture()), /D1_UNAVAILABLE/);
  await assert.rejects(appendOfficialOddsHistory(fakeDb({ failInsert: true }), fixture()), /D1_WRITE_FAILED/);
  await assert.rejects(appendOfficialOddsHistory(fakeDb({ corruptRead: true }), fixture()), /WRITE_NOT_VERIFIED/);
});

test('A -> B -> A creates three ordered transitions but only two unique market bodies', async () => {
  const db = fakeDb();
  const a = fixture(), b = fixture();
  b.updatedAt = '2026-10-25T04:31:00Z';
  b.matches[0].odds[0] = '2.20';
  const first = await appendOfficialOddsHistory(db, a);
  const second = await appendOfficialOddsHistory(db, b);
  const again = fixture(); again.updatedAt = '2026-10-25T04:32:00Z';
  const third = await appendOfficialOddsHistory(db, again);
  assert.equal(first.snapshotHash, third.snapshotHash);
  assert.notEqual(first.snapshotHash, second.snapshotHash);
  assert.equal(db.rows.size, 2);
  assert.deepEqual(db.transitions.map(x => x.snapshot_hash), [
    first.snapshotHash, second.snapshotHash, first.snapshotHash,
  ]);
  assert.deepEqual(db.transitions.map(x => x.previous_hash), [
    null, first.snapshotHash, second.snapshotHash,
  ]);
  assert.equal(db.head, first.snapshotHash);
  const repeat = fixture(); repeat.updatedAt = '2026-10-25T04:33:00Z';
  await appendOfficialOddsHistory(db, repeat);
  assert.equal(db.transitions.length, 3, 'unchanged head does not create duplicate transitions');
});

test('failed transition batch rolls back snapshot insert and cannot claim success', async () => {
  const db = fakeDb({ failTransition: true });
  await assert.rejects(appendOfficialOddsHistory(db, fixture()), /D1_TRANSITION_FAILED/);
  assert.equal(db.rows.size, 0);
  assert.equal(db.transitions.length, 0);
  assert.equal(db.head, null);
});
