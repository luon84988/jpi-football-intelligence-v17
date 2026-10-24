import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test('GitHub Pages escapes every external match field before innerHTML', async () => {
  assert.ok(script, 'inline dashboard script must exist');
  const attack = '<img src=x onerror=alert(1)>';
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerText: '', innerHTML: '', textContent: '' });
      return elements.get(id);
    },
  };
  const data = {
    update_time: '2026-10-24T00:00:00Z',
    matches: [{
      league: attack, home: attack, away: attack,
      kickoff_display: attack, recommendation: attack, risk: attack,
      prob_home: 0.5, prob_draw: 0.3, prob_away: 0.2,
      xg_home: attack, xg_away: attack, scores: [attack], over25: 0.5,
    }],
  };
  runInNewContext(script, {
    document,
    Date,
    fetch: async () => ({ json: async () => data }),
  });
  await new Promise(resolve => setImmediate(resolve));
  const rendered = elements.get('match-list').innerHTML;
  assert.ok(rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!rendered.includes(attack), 'raw injected HTML must never reach innerHTML');
  assert.equal(rendered.match(/&lt;img src=x onerror=alert\(1\)&gt;/g)?.length, 6);
});

test('HTML metacharacters are encoded, including quotes and ampersands', async () => {
  assert.ok(script);
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerText: '', innerHTML: '', textContent: '' });
      return elements.get(id);
    },
  };
  runInNewContext(script, {
    document,
    Date,
    fetch: async () => ({ json: async () => ({
      update_time: '-', matches: [{
        league: '&<>"\'', home: '主队', away: '客队',
        odds: [], recommendation: '观察', risk: '待验证',
      }],
    }) }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(elements.get('match-list').innerHTML.includes('&amp;&lt;&gt;&quot;&#39;'));
});

test('Pages renders market-only exporter probabilities without requiring model scores', async () => {
  assert.ok(script);
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerText: '', innerHTML: '', textContent: '' });
      return elements.get(id);
    },
  };
  const row = {
    match_id: 'official-123', league: '英超', home: '主队', away: '客队',
    prob_home: 0.5, prob_draw: 0.3, prob_away: 0.2,
    probability_basis: 'de-vigged_market_odds',
    recommendation: '观察：未提供独立且已校准的模型概率', risk: '待验证',
  };
  runInNewContext(script, {
    document, Date,
    fetch: async () => ({ json: async () => ({
      update_time: '2026-10-24T00:00:00Z',
      summary: { probability_basis: 'de-vigged_market_odds; not independent model probabilities' },
      matches: [row],
    }) }),
  });
  await new Promise(resolve => setImmediate(resolve));
  const rendered = elements.get('match-list').innerHTML;
  assert.ok(rendered.includes('市场去水概率（非独立模型）'));
  assert.ok(rendered.includes('胜 50%'));
  assert.ok(rendered.includes('平 30%'));
  assert.ok(rendered.includes('负 20%'));
  assert.ok(!rendered.includes('预期进球'));
  assert.ok(!rendered.includes('EV'));
});

test('Pages does not present malformed market probabilities', async () => {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerText: '', innerHTML: '', textContent: '' });
      return elements.get(id);
    },
  };
  runInNewContext(script, {
    document, Date,
    fetch: async () => ({ json: async () => ({
      update_time: '-',
      matches: [{ league: '测试', home: '甲', away: '乙',
        prob_home: 0.7, prob_draw: null, prob_away: 0.3,
        recommendation: '观察', risk: '待验证' }],
    }) }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!elements.get('match-list').innerHTML.includes('市场去水概率'));
});
