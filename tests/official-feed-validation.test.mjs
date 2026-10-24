import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeOfficialFeed, selectPublishableOfficialFeed } from '../worker/official-feed-validation.ts';

const valid = (id = '20261024001') => ({
  sourceEventId: id, league: '测试联赛', home: '主队', away: '客队',
  odds: ['2.10', '3.25', '3.50'],
});
test('valid official 1X2 observation is publishable', () => {
  assert.deepEqual(summarizeOfficialFeed([valid()]), {
    totalCount: 1, publishableCount: 1, invalidCount: 0, duplicateCount: 0 });
});
test('official source may return fixtures but zero publishable odds', () => {
  const bad = [{ ...valid(), odds: ['—', '—', '—'] },
    { ...valid('20261024002'), odds: ['', '3.2', '4.0'] }];
  assert.equal(summarizeOfficialFeed(bad).publishableCount, 0);
});
test('missing or placeholder event identity is rejected', () => {
  for (const id of ['', 'undefined', 'null', 'unknown', '-']) {
    assert.equal(summarizeOfficialFeed([valid(id)]).publishableCount, 0, id);
  }
});
test('duplicate event identity does not inflate valid count', () => {
  assert.deepEqual(summarizeOfficialFeed([valid(), valid(), valid('20261024002')]), {
    totalCount: 3, publishableCount: 2, invalidCount: 1, duplicateCount: 1 });
});
test('invalid team, league and odds are rejected', () => {
  const bad = [
    { ...valid(), league: '' },
    { ...valid('2'), home: null },
    { ...valid('3'), odds: ['2.1', 'NaN', '3.4'] },
    { ...valid('4'), odds: [2.1, Infinity, 3.4] },
    { ...valid('5'), odds: [1, 3, 4] },
  ];
  assert.equal(summarizeOfficialFeed(bad).publishableCount, 0);
});
test('Worker requires publishable rows before reporting live source success', async () => {
  const source = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const feedSelection = selectPublishableOfficialFeed\(matches\)/);
  assert.match(source, /matches: feedSelection\.matches/);
  assert.match(source, /if \(feedQuality\.publishableCount > 0\)/);
  assert.match(source, /publishableCount: feedQuality\.publishableCount/);
});

test('an invalid earlier quote does not suppress a later valid quote for same event', () => {
  const observations = [{ ...valid(), odds: ['—', '—', '—'] }, valid()];
  assert.deepEqual(summarizeOfficialFeed(observations), {
    totalCount: 2, publishableCount: 1, invalidCount: 1, duplicateCount: 0 });
});

test('only unique valid odds reach the live cache payload', () => {
  const rows = [valid(), valid(), { ...valid('20261024002'), odds: ['—', '3.2', '4.0'] },
    valid('undefined'), valid('20261024003')];
  const selection = selectPublishableOfficialFeed(rows);
  assert.deepEqual(selection.matches.map(match => match.sourceEventId),
    ['20261024001', '20261024003']);
  assert.deepEqual(selection.quality, {
    totalCount: 5, publishableCount: 2, invalidCount: 3, duplicateCount: 1 });
  assert.deepEqual(summarizeOfficialFeed(rows), selection.quality);
});

test('an invalid first observation cannot hide a later valid quote', () => {
  const selection = selectPublishableOfficialFeed([
    { ...valid(), odds: ['—', '—', '—'] }, valid()]);
  assert.deepEqual(selection.matches, [valid()]);
  assert.equal(selection.quality.duplicateCount, 0);
});

test('event identifiers are normalized before persistence', () => {
  const selection = selectPublishableOfficialFeed([
    valid(' 20261024001 '), valid('20261024001')]);
  assert.equal(selection.matches[0].sourceEventId, '20261024001');
  assert.equal(selection.quality.duplicateCount, 1);
});

test('all-invalid source has no rows eligible for D1 persistence', () => {
  const selection = selectPublishableOfficialFeed([
    null, [], { ...valid(), league: '' }]);
  assert.deepEqual(selection.matches, []);
  assert.equal(selection.quality.publishableCount, 0);
});

test('conflicting valid prices for the same event are excluded, not first-row-wins', () => {
  const rows = [valid(), { ...valid(), odds: ['1.80', '3.25', '4.50'] }, valid('20261024002')];
  const selection = selectPublishableOfficialFeed(rows);
  assert.deepEqual(selection.matches.map(match => match.sourceEventId), ['20261024002']);
  assert.deepEqual(selection.quality, {
    totalCount: 3, publishableCount: 1, invalidCount: 2, duplicateCount: 1 });
});

test('conflicting team identity excludes the event even with matching odds', () => {
  const selection = selectPublishableOfficialFeed([valid(), { ...valid(), away: '不同客队' }]);
  assert.deepEqual(selection.matches, []);
  assert.equal(selection.quality.publishableCount, 0);
});

test('equivalent numeric quote formatting remains an identical duplicate', () => {
  const selection = selectPublishableOfficialFeed([
    valid(), { ...valid(), odds: [2.1, '3.250', 3.5] }]);
  assert.equal(selection.matches.length, 1);
  assert.equal(selection.quality.duplicateCount, 1);
});

test('a third copy cannot restore an event already rejected for conflicting odds', () => {
  const selection = selectPublishableOfficialFeed([
    valid(), { ...valid(), odds: ['1.80', '3.25', '4.50'] }, valid()]);
  assert.equal(selection.matches.length, 0);
  assert.equal(selection.quality.duplicateCount, 2);
});
