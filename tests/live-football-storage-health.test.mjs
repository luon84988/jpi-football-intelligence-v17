import test from 'node:test';
import assert from 'node:assert/strict';
import { probeLiveFootballStorage } from '../worker/live-football-storage-health.ts';

function fakeDb(row, calls) {
  return {
    prepare(sql) {
      calls.push(sql);
      return {
        bind(key) {
          calls.push(key);
          return { async first() { if (row instanceof Error) throw row; return row; } };
        },
      };
    },
  };
}

const stored = { matches: [{ sourceEventId: '123', odds: ['2.1','3.2','3.5'] }], updatedAt: '2026-10-25T00:00:00Z', source: '中国体育彩票官方竞彩', secret: 'must-not-leak' };

test('missing D1 binding fails closed', async () => {
  const result = await probeLiveFootballStorage(undefined);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.cacheRecordFound, false);
});

test('D1 query failure returns sanitized unavailable status', async () => {
  const calls = [];
  const result = await probeLiveFootballStorage(fakeDb(new Error('secret D1 details'), calls));
  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  assert.equal(calls.length, 2);
});

test('empty D1 cache is not a healthy live feed', async () => {
  const calls = [];
  const result = await probeLiveFootballStorage(fakeDb(null, calls));
  assert.equal(result.status, 'empty');
  assert.equal(result.storage, 'D1');
  assert.equal(result.cacheRecordFound, false);
});

test('valid D1 cache readback exposes metadata only and never claims a production loop', async () => {
  const calls = [];
  const result = await probeLiveFootballStorage(fakeDb({ payload: JSON.stringify(stored), updated_at: stored.updatedAt }, calls));
  assert.equal(result.status, 'cache_present');
  assert.equal(result.matchCount, 1);
  assert.equal(result.cacheUpdatedAt, stored.updatedAt);
  assert.equal(result.officialQuoteTimeVerified, false);
  assert.equal(result.immutableHistoryVerified, false);
  assert.equal(result.independentModelVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^SELECT /i);
  assert.equal(calls[1], 'sporttery_current');
});

test('malformed cache and timestamp mismatch fail closed', async () => {
  for (const row of [
    { payload: '{bad json', updated_at: stored.updatedAt },
    { payload: JSON.stringify(stored), updated_at: '2026-10-25T01:00:00Z' },
    { payload: JSON.stringify({ ...stored, matches: null }), updated_at: stored.updatedAt },
    { payload: JSON.stringify({ ...stored, matches: [] }), updated_at: stored.updatedAt },
    { payload: JSON.stringify({ ...stored, source: 'fallback' }), updated_at: stored.updatedAt },
  ]) {
    const result = await probeLiveFootballStorage(fakeDb(row, []));
    assert.equal(result.status, 'invalid_cache');
    assert.equal(result.cacheRecordFound, false);
  }
});
