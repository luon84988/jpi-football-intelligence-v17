/** Authenticated owner-only collector intake. Never issues formal certification. */
export const DOMESTIC_URLS = { '500': 'https://trade.500.com/jczq/index.php?playid=312&g=2', okooo: 'https://www.okooo.com/jingcai/' };
export const INPUT_GAPS = ['source_bound_team_strength_and_L6', 'verified_player_and_context_inputs', 'independent_model_execution', 'validated_rule_evidence', 'traceable_backtest_and_calibration', 'certified_risk_rating', 'pre_deadline_freeze_and_delivery'];
export const salesDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
export const digest = async (raw: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function timestamp(value: unknown) { requireValue(typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'timezone_required'); const n=Date.parse(value); requireValue(Number.isFinite(n),'invalid_timestamp'); return n; }
const prices = (x: any) => Array.isArray(x) && x.length===3 && x.every(v=> typeof v==='string' && /^\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v)) && Number(v)>1);
const same = (a:any,b:any) => JSON.stringify(a)===JSON.stringify(b);

export async function validateObservation(body: any, now = new Date()) {
  const p=body?.observation;
  requireValue(p && p.source_kind==='THIRD_PARTY_JINGCAI_OBSERVATIONS' && p.official_verification==='NOT_VERIFIED' && p.formal_eligible===false,'observation_provenance_required');
  const at=timestamp(p.observed_at);
  requireValue(at<=now.getTime()+300000 && now.getTime()-at<=1800000 && p.sales_date===salesDay(now),'observation_not_current');
  requireValue(Array.isArray(p.matches) && p.matches.length>0 && p.matches.length<=200,'nonempty_bounded_matches_required');
  requireValue(Array.isArray(p.sources) && p.sources.length===2 && new Set(p.sources.map((x:any)=>x.source)).size===2,'both_sources_required');
  const captures:any[]=[];
  for (const key of ['500','okooo'] as const) {
    const s=p.sources.find((x:any)=>x.source===key), c=s?.capture;
    requireValue(s?.status==='success' && s.url===DOMESTIC_URLS[key] && c?.url===s.url && c?.sha256===s.response_sha256,'source_capture_required');
    const fetched=timestamp(c.fetched_at), first=timestamp(c.first_seen_at);
    requireValue(first<=fetched && fetched<=at+300000 && at-fetched<=1800000,'source_capture_not_current');
    requireValue(typeof body.captures?.[key]==='string' && body.captures[key].length<=2000004,'bounded_capture_required');
    const bytes=Uint8Array.from(atob(body.captures[key]),v=>v.charCodeAt(0));
    requireValue(bytes.length>0 && bytes.length<=1500000 && await digest(bytes)===c.sha256,'capture_hash_mismatch');
    captures.push({ source:key, sha256:c.sha256, url:s.url, first_seen_at:c.first_seen_at, bytes });
  }
  const seen=new Set();
  // Noon +08 and UTC share the calendar day; getUTCDay gives that day's weekday.
  const expectedWeekday=['日','一','二','三','四','五','六'][new Date(p.sales_date+'T12:00:00+08:00').getUTCDay()];
  for (const m of p.matches) {
    requireValue(m.sales_date===p.sales_date && new RegExp('^周'+expectedWeekday+'\\d{3}$').test(m.match_num) && !seen.has(m.match_num),'invalid_or_duplicate_match_identity'); seen.add(m.match_num);
    requireValue(m.formal_eligible===false && m.official_verification==='NOT_VERIFIED' && m.observed_at===p.observed_at,'match_provenance_required');
    requireValue(['home','away'].every(k=>typeof m[k]==='string' && m[k].length>0 && m[k].length<=80 && !m[k].includes('\ufffd')) && m.home!==m.away,'invalid_team_identity');
    const kick=timestamp(m.kickoff), end=timestamp(m.reported_sales_end);
    requireValue(kick>at && end>at && end<=kick && kick<at+7*86400000,'invalid_sales_window');
    requireValue(prices(m.reported_sp) && Array.isArray(m.sources) && m.sources.length===2,'match_sources_and_prices_required');
    const x=m.sources.find((s:any)=>s.source==='500'), y=m.sources.find((s:any)=>s.source==='okooo');
    requireValue(x && y && [x,y].every(s=>s.available===true && ['sales_date','match_num','home','away','kickoff'].every(k=>s[k]===m[k]) && same(s.odds,m.reported_sp)) && x.sales_end===m.reported_sales_end,'cross_source_mismatch');
    requireValue([x,y].every(s=> /^\d{1,12}$/.test(String(s.provider_fixture_id||s.provider_event_id||''))),'provider_identity_required');
    requireValue(['500','okooo'].every(key=>Array.isArray(p.source_observations?.[key]) && p.source_observations[key].filter((s:any)=>s.sales_date===m.sales_date&&s.match_num===m.match_num).length===1 && same(p.source_observations[key].find((s:any)=>s.sales_date===m.sales_date&&s.match_num===m.match_num),key==='500'?x:y)),'source_observations_mismatch');
    if (m.hhad?.status==='cross_checked') requireValue(x.hhad_available===true && y.hhad_available===true && Number.isInteger(m.hhad.home_handicap) && x.handicap===m.hhad.home_handicap && y.handicap===x.handicap && prices(m.hhad.reported_sp) && same(x.hhad_odds,m.hhad.reported_sp) && same(y.hhad_odds,x.hhad_odds),'handicap_cross_source_mismatch');
    else requireValue(m.hhad?.status==='gap' && typeof m.hhad.reason==='string','handicap_gap_required');
  }
  // Inputs remain partial. No Elo/xG, lineup, injury, rule or backtest values are invented.
  const inputs=p.matches.map((m:any)=>({match_key:`observed:${m.sales_date}:${m.match_num}`,kickoff:m.kickoff,cutoff:p.observed_at,market:{jc:m.reported_sp,hhad:m.hhad},source_refs:p.sources.map((s:any)=>({source:s.source,url:s.url,sha256:s.capture.sha256,fetched_at:s.capture.fetched_at})),analysis_status:'PRE_ANALYSIS',formal_eligible:false,missing:INPUT_GAPS}));
  const envelope={observation:p,inputs}; const serialized=JSON.stringify(envelope); const hash=await digest(new TextEncoder().encode(serialized));
  return { p, captures, serialized, hash };
}

export async function ingestObservation(db:any, body:any, now=new Date()) {
  const {p,captures,serialized,hash}=await validateObservation(body,now);
  await db.batch([
    ...captures.map(c=>db.prepare('INSERT OR IGNORE INTO domestic_source_captures (sha256,source,url,first_seen_at,raw) VALUES (?,?,?,?,?)').bind(c.sha256,c.source,c.url,c.first_seen_at,c.bytes.buffer)),
    db.prepare('INSERT OR IGNORE INTO domestic_feed_snapshots (snapshot_hash,sales_date,observed_at,received_at,payload) VALUES (?,?,?,?,?)').bind(hash,p.sales_date,p.observed_at,now.toISOString(),serialized),
  ]);
  const saved=await db.prepare('SELECT payload FROM domestic_feed_snapshots WHERE snapshot_hash=?').bind(hash).first();
  requireValue(saved?.payload===serialized,'snapshot_readback_failed');
  for (const c of captures) {
    const stored=await db.prepare('SELECT raw FROM domestic_source_captures WHERE sha256=?').bind(c.sha256).first();
    requireValue(stored?.raw && await digest(new Uint8Array(stored.raw))===c.sha256,'capture_readback_failed');
  }
  return {status:'persisted',snapshot_hash:hash,sales_date:p.sales_date,observed_at:p.observed_at,matches:p.matches.length,analysis_status:'PRE_ANALYSIS',formal_eligible:false};
}

export async function readObservation(db:any, now=new Date()) {
  const row=await db.prepare('SELECT snapshot_hash,payload FROM domestic_feed_snapshots ORDER BY observed_at DESC,received_at DESC LIMIT 1').first();
  if(!row) return null;
  requireValue(await digest(new TextEncoder().encode(row.payload))===row.snapshot_hash,'snapshot_integrity_failed');
  const {observation:p,inputs}=JSON.parse(row.payload);
  const stale=p.sales_date!==salesDay(now)||now.getTime()-timestamp(p.observed_at)>1800000;
  const matches=p.matches.filter((m:any)=>timestamp(m.kickoff)>now.getTime()&&timestamp(m.reported_sales_end)>now.getTime());
  return {observation:{...p,matches},inputs,snapshot_hash:row.snapshot_hash,stale:stale||!matches.length};
}

export function observationMatches(p:any, classify:(name:string)=>string) {
  return p.matches.map((m:any)=>{
    const odds=m.reported_sp.map(Number), inv=odds.map((x:number)=>1/x), total=inv.reduce((a:number,b:number)=>a+b,0), fair=inv.map((x:number)=>x/total), index=fair.indexOf(Math.max(...fair));
    const line=m.hhad.status==='cross_checked'?m.hhad.home_handicap:null;
    const id=`observed:${m.sales_date}:${m.match_num}`;
    const league= m.sources.find((s:any)=>s.source==='500')?.league || '竞彩';
    return {league,group:classify(league),tier:'第三方交叉观察',state:'pre',time:m.kickoff.slice(5,16).replace('-','/').replace('T',' '),kickoff:m.kickoff,salesEnd:m.reported_sales_end,home:m.home,away:m.away,odds:m.reported_sp,handicap:line,hhadOdds:line===null?'未核验':m.hhad.reported_sp.join('/'),dq:'C',risk:'C',signal:['主队市场倾向','均衡 / 防平','客队市场倾向'][index],pdi:Number(Math.max(...fair).toFixed(3)),fairProbabilities:fair,edge:`${(100/total).toFixed(1)}%返还`,score:'—',topScores:[],homeXg:null,awayXg:null,marketHomeXg:null,marketAwayXg:null,matchNum:m.match_num,salesDate:m.sales_date,sourceEventId:id,officialEventId:null,sourceKind:'THIRD_PARTY_JINGCAI_OBSERVATIONS',sellStatus:1,status:`${m.match_num} · 第三方观察 · 官方未核验`,analysisStatus:'PRE_ANALYSIS',formalEligible:false,inputGaps:INPUT_GAPS};
  });
}
