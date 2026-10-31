import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOfficialFootball, OFFICIAL_FOOTBALL_URL } from '../worker/official-feed.ts';

test('one official match is observed without inventing a minimum slate size', async () => {
  const {official, attempt} = await fetchOfficialFootball(async (url, init) => {
    assert.equal(url, OFFICIAL_FOOTBALL_URL);
    assert.ok(init.signal);
    return Response.json({value:{matchInfoList:[{subMatchList:[{matchId:123}]}]}});
  });
  assert.equal(official.value.matchInfoList.length, 1);
  assert.equal(attempt.receivedMatches, 1);
  assert.equal(attempt.outcome, 'received');
});
test('records an upstream block without exposing its body', async () => {
  const r = await fetchOfficialFootball(async () => new Response('private upstream body', {status:567}));
  assert.equal(r.official, null); assert.equal(r.attempt.status, 567);
  assert.equal(r.attempt.outcome, 'http_error');
  assert.ok(!JSON.stringify(r).includes('private upstream body'));
});
test('distinguishes invalid JSON from HTTP success', async () => {
  const r = await fetchOfficialFootball(async () => new Response('<html>challenge</html>'));
  assert.equal(r.official, null); assert.equal(r.attempt.outcome, 'invalid_json');
});
test('rejects malformed groups before mapping matches', async () => {
  for (const group of [null, {}, {subMatchList:'wrong'}]) {
    const r = await fetchOfficialFootball(async () => Response.json({value:{matchInfoList:[group]}}));
    assert.equal(r.official,null); assert.equal(r.attempt.outcome,'invalid_match_groups');
  }
});
test('empty official slate is distinguishable from a connection failure', async () => {
  const r = await fetchOfficialFootball(async () => Response.json({value:{matchInfoList:[]}}));
  assert.equal(r.attempt.outcome, 'empty_slate'); assert.equal(r.attempt.receivedMatches, 0);
});
test('timeouts are bounded and report no exception secrets', async () => {
  const r = await fetchOfficialFootball(async () => {throw new DOMException('secret text', 'TimeoutError');});
  assert.equal(r.official,null); assert.equal(r.attempt.outcome,'timeout');
  assert.ok(!JSON.stringify(r).includes('secret text'));
});
