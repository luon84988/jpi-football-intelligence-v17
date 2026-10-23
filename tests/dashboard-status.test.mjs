import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeFeedStatus } from '../app/dashboard-status.mjs';

test('empty feed never claims a healthy or cached source', () => {
  assert.deepEqual(describeFeedStatus({ count: 0, live: true, timestamp: new Date() }), {
    headline: 'SOURCE UNAVAILABLE', source: '暂无可用竞彩数据', feed: '未连接'
  });
});
test('live Worker response does not claim upstream timestamp verification', () => {
  const result = describeFeedStatus({ count: 2, live: true, timestamp: new Date('2026-10-24T00:00:00Z') });
  assert.equal(result.headline, 'SOURCE CONNECTED');
  assert.match(result.source, /上游更新时间未验证/);
});
test('cached matches are never described as live', () => {
  const result = describeFeedStatus({ count: 2, live: false, timestamp: new Date('2026-10-24T00:00:00Z') });
  assert.equal(result.feed, '缓存');
  assert.match(result.source, /非实时/);
});
test('invalid timestamp prevents a healthy source indicator', () => {
  assert.equal(describeFeedStatus({ count: 2, live: true, timestamp: new Date('invalid') }).feed, '未连接');
});
test('dashboard has no fabricated quality or hit-rate percentages', () => {
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /68\.2%|87\.4/);
  assert.match(page, /MODEL HIT RATE <b>未验证<\/b>/);
  assert.match(page, /describeFeedStatus\(/);
});
