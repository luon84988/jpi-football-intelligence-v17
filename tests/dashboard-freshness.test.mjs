import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]);
const script = scripts.find(x => x.includes('async function loadData'));
const helper = new URL('dashboard-freshness.mjs', root);
const assessSnapshot = fs.existsSync(helper) ? (await import(helper.href)).assessSnapshot : undefined;
const now = Date.parse('2026-11-19T13:34:00Z');
const fixture = () => ({update_time:'2026-11-19T13:33:59Z', source_updated_at:'2026-11-19T13:03:00Z',
    stale:false, matches:[{league:'SYNTHETIC',home:'HOME',away:'AWAY',recommendation:'SYNTHETIC MODEL PICK',
    prob_home:.5,prob_draw:.3,prob_away:.2,scores:['1-0'],xg_home:1,xg_away:.5,over25:.4}]});

async function page(data) {
    const elements = Object.fromEntries(['update-time','match-list'].map(k=>[k,{innerText:'',innerHTML:''}]));
    let clock = now; let fetches = 0; const timers = [];
    class Clock extends Date { static now() { return clock; } }
    const context = vm.createContext({Date:Clock, assessSnapshot: data => assessSnapshot(data, clock),
        document:{getElementById:id=>elements[id]},
        fetch:async()=>{ fetches++; return {ok:true,json:async()=>data}; },
        setInterval:callback=>timers.push(callback)});
    vm.runInContext(script.replace(/^\s*import[^\n]*\n/gm,''), context);
    await vm.runInContext('loadData()', context);
    return {elements, get fetches() { return fetches; }, advance(ms) { clock += ms; for(const timer of timers) timer(); }};
}

test('expired source is marked even when publication timestamp is new and stale flag is false', async()=>{
    const p = await page(fixture());
    assert.match(p.elements['update-time'].innerText, /已过期/);
    assert.match(p.elements['match-list'].innerHTML, /HOME vs AWAY/);
    assert.doesNotMatch(p.elements['match-list'].innerHTML, /SYNTHETIC MODEL PICK|预期进球/);
});

test('missing timezone or future source cannot borrow a recent publication timestamp', async()=>{
    for(const timestamp of [undefined,'2026-11-19T13:33:59','2026-11-19T13:40:00Z']) {
        const d=fixture(); d.source_updated_at=timestamp;
        const p=await page(d);
        assert.match(p.elements['update-time'].innerText,/无法核验|来源时间异常/);
        assert.doesNotMatch(p.elements['match-list'].innerHTML,/SYNTHETIC MODEL PICK/);
    }
});

test('an already open page expires its output without another network request', async()=>{
    const d=fixture();d.source_updated_at='2026-11-19T13:33:00Z';
    const p=await page(d);
    assert.match(p.elements['match-list'].innerHTML,/SYNTHETIC MODEL PICK/);
    const fetches = p.fetches;
    p.advance(1800000);
    assert.equal(p.fetches, fetches);
    assert.match(p.elements['update-time'].innerText,/已过期/);
    assert.doesNotMatch(p.elements['match-list'].innerHTML,/SYNTHETIC MODEL PICK|预期进球/);
});

test('explicit stale and non-ok status remain unavailable even with a recent source', async()=>{
    for(const change of [{stale:true},{status:'unavailable'}]) {
        const d={...fixture(),source_updated_at:'2026-11-19T13:33:00Z',...change};
        const p=await page(d);
        assert.doesNotMatch(p.elements['match-list'].innerHTML,/SYNTHETIC MODEL PICK/);
    }
});

test('a malformed snapshot cannot leave a failing periodic render running', async()=>{
    for(const data of [{matches:null}, {}, []]) {
        const p = await page(data);
        assert.doesNotThrow(() => p.advance(30000));
        assert.equal(p.elements['match-list'].textContent, '暂时无法读取已发布的赛程。');
    }
});
