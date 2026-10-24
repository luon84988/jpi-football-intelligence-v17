import test from 'node:test';
import assert from 'node:assert/strict';
import { makeValueObservation } from '../app/value-observation.mjs';

test('high market PDI cannot become a fabricated independent model or positive EV', () => {
  const row = makeValueObservation({ odds: ['1.50', '4.00', '7.00'], pdi: 0.99, signal: '主队倾向' });
  assert.equal(row.model, null);
  assert.equal(row.ev, null);
  assert.equal(row.edge, null);
  assert.equal(row.status, 'WATCH');
  assert.equal(row.price, 1.5);
  assert.ok(row.marketP > 0 && row.marketP < 1);
  assert.ok(row.gaps.some(x => x.includes('独立')));
});

test('invalid or partial odds never create market or EV figures', () => {
  for (const odds of [[1.5, 4], [1.5, 'NaN', 7], [1.5, Infinity, 7], null]) {
    const row = makeValueObservation({ odds, pdi: 0.8, signal: '主队倾向' });
    assert.equal(row.price, null);
    assert.equal(row.marketP, null);
    assert.equal(row.breakEven, null);
    assert.equal(row.ev, null);
    assert.equal(row.edge, null);
  }
});

test('market probability is normalized and distinct from model probability', () => {
  const odds = [2.2, 3.1, 3.4];
  const rows = ['主队倾向', '均衡 / 防平', '客队倾向'].map(signal =>
    makeValueObservation({ odds, signal, pdi: 0.99 }));
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.marketP, 0) - 1) < 1e-12);
  assert.ok(rows.every(row => row.model === null && row.ev === null && row.edge === null));
});
