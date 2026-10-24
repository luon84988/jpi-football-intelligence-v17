import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { saveLiveFootballCache, readLiveFootballCache } from '../worker/live-football-cache.ts';

function fakeD1({ rejectWrite = false, corruptRead = false, writeDelayMs = 0 } = {}) {
  let row = null;
  const statements = [];
  return {
    statements,
    get row() { return row; },
    prepare(sql) {
      statements.push(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (/INSERT INTO live_football_cache/.test(sql)) {
            if (rejectWrite) throw new Error('D1_WRITE_FAILED');
            if (writeDelayMs) await new Promise(resolve => setTimeout(resolve, writeDelayMs));
            row = { payload: args[1], updated_at: args[2] };
          }
          return { success: true };
        },
        async first() {
          if (corruptRead && row) return { ...row, payload: '{"unexpected":true}' };
          return row;
        },
      };
    },
  };
}

test('D1 save awaits write and verifies exact stored payload and timestamp', async () => {
  const db = fakeD1({ writeDelayMs: 30 });
  const payload = { updatedAt: '2026-10-24T12:00:00.000Z', source: '中国体育彩票官方竞彩', matches: [{ sourceEventId: '42' }] };
  let completed = false;
  const saving = saveLiveFootballCache(db, payload).then(() => { completed = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(completed, false, 'save must not resolve before D1 write finishes');
  await saving;
  assert.deepEqual(db.row, { payload: JSON.stringify(payload), updated_at: payload.updatedAt });
  assert.equal(db.statements.filter(sql => /SELECT payload,updated_at/.test(sql)).length, 1);
});

test('D1 write errors fail closed instead of being treated as persisted', async () => {
  const db = fakeD1({ rejectWrite: true });
  await assert.rejects(saveLiveFootballCache(db, { updatedAt: '2026-10-24T12:00:00Z' }), /D1_WRITE_FAILED/);
});

test('D1 readback mismatch fails closed', async () => {
  const db = fakeD1({ corruptRead: true });
  await assert.rejects(saveLiveFootballCache(db, { updatedAt: '2026-10-24T12:00:00Z' }), /D1_LIVE_CACHE_WRITE_NOT_VERIFIED/);
});

test('cached response remains explicitly stale and is never a verified live response', async () => {
  const db = fakeD1();
  const payload = { updatedAt: '2026-10-24T12:00:00Z', stale: false, matches: [{ sourceEventId: '42' }] };
  await saveLiveFootballCache(db, payload);
  const cached = await readLiveFootballCache(db);
  assert.equal(cached.stale, true);
  assert.equal(cached.cache, 'last_success');
  assert.equal(cached.updatedAt, payload.updatedAt);
});

test('Worker official feed awaits D1 confirmation before reporting live success', async () => {
  const source = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
  assert.match(source, /await saveLiveFootballCache\(env\.DB, payload\)/);
  assert.doesNotMatch(source, /ctx\.waitUntil\(saveLiveFootballCache/);
});
