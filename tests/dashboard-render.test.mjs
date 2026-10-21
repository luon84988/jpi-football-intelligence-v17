import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const script = scripts.at(-1)?.[1];
assert.ok(script, 'dashboard inline script exists');

async function render(payload, status = 200) {
  const nodes = {
    'update-time': { innerText: '', textContent: '' },
    'match-list': { innerHTML: '', textContent: '' },
  };
  const context = {
    document: { getElementById: id => nodes[id] },
    fetch: async () => ({ ok: status === 200, status, json: async () => payload }),
    Date,
  };
  runInNewContext(script, context);
  await runInNewContext('loadData()', context);
  return nodes;
}

const base = {
  update_time: '2026-10-21T08:00:00Z',
  matches: [{
    league: '测试联赛', home: '主队', away: '客队',
    recommendation: '观察', risk: '待验证', kickoff_display: '10/21 20:00',
    prob_home: 0.5, prob_draw: 0.3, prob_away: 0.2,
  }],
};

test('market probabilities render without model scores and are not called predictions', async () => {
  const nodes = await render(base);
  assert.match(nodes['match-list'].innerHTML, /去水市场概率（非模型预测）：胜 50% · 平 30% · 负 20%/);
  assert.doesNotMatch(nodes['match-list'].innerHTML, /预期进球/);
});

test('all untrusted match text is HTML-escaped', async () => {
  const injected = '<img src=x onerror=alert(1)>';
  const payload = { ...base, matches: [{ ...base.matches[0], league: injected, home: injected, away: injected, recommendation: injected, risk: injected, kickoff_display: injected }] };
  const nodes = await render(payload);
  assert.doesNotMatch(nodes['match-list'].innerHTML, /<img/);
  assert.equal((nodes['match-list'].innerHTML.match(/&lt;img/g) || []).length, 6);
});

test('invalid market probabilities are not displayed', async () => {
  const payload = { ...base, matches: [{ ...base.matches[0], prob_draw: null }] };
  const nodes = await render(payload);
  assert.doesNotMatch(nodes['match-list'].innerHTML, /去水市场概率/);
});

test('empty data remains clearly marked as unavailable', async () => {
  const nodes = await render({ status: 'no_api_key', update_time: '-', matches: [] });
  assert.match(nodes['update-time'].innerText, /no_api_key/);
  assert.match(nodes['match-list'].textContent, /暂无真实竞彩数据/);
});

test('HTTP failures do not render a successful snapshot', async () => {
  const nodes = await render(base, 503);
  assert.match(nodes['update-time'].innerText, /数据读取失败/);
});
