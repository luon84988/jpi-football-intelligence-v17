/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { ingestObservation, readObservation, observationMatches, INPUT_GAPS } from "./domestic-observations";
import { fetchOfficialFootball } from "./official-feed";
import { SPORTTERY_SNAPSHOT } from "./sporttery-snapshot";
import { analyzeStyleMatchup } from "./style-rules";
import { ensureLeagueDatabase, seedRows } from "./league-database";
import { ensureTeamDatabase, seedTeamData } from "./team-database";
import { PUBLIC_DATA_RULES } from "./public-data-rules";
import { BOOKMAKERS, auditMarketCoverage, buildMarketRows, ensureOddsDatabase, marketAttitude } from "./odds-database";
import { INTERNATIONAL_ODDS_POLICY, refreshOddsApiIo } from "./odds-api-io";
import { SYSTEM_AUDIT } from "./rule-audit";
import { VALUE_RULES } from "./value-library";
import { ensureSourceDatabase, refreshApiFootball } from "./source-database";
import { getBacktestOverview } from "./backtest-database";
import { getPlayerStatistics } from "./player-statistics-database";
import { readLiveFootballCache, saveLiveFootballCache } from "./live-football-cache";
import { HYBRID_ENGINE_SPEC } from "./hybrid-fusion-engine";
import { deleteAnalysis, getAnalysis, listAnalyses, resultOverview, saveAnalysis, saveReview } from "./result-store";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  API_FOOTBALL_KEY?: string;
  SPORTSGAMEODDS_KEY?: string;
  /** Server-only provider credentials. Never expose these values to the client. */
  ODDS_API_IO_KEY?: string;
  FOOTBALL_DATA_API_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const poisson = (goals: number, lambda: number) => {
  let factorial = 1; for (let i = 2; i <= goals; i++) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
};

const marketImpliedScoreModel = (had: number[], hhad: number[], handicap: number, league: string, storedProfile?: any, matchup?: any) => {
  if (![...had, ...hhad].every(v => Number.isFinite(v) && v > 1)) return null;
  const normalize = (odds: number[]) => { const inv = odds.map(v => 1 / v); const sum = inv.reduce((a, b) => a + b, 0); return inv.map(v => v / sum); };
  const target = normalize(had), handicapTarget = normalize(hhad); let best = { error: Infinity, homeXg: 0, awayXg: 0 };
  for (let homeXg = .3; homeXg <= 3.8; homeXg += .1) for (let awayXg = .3; awayXg <= 3.8; awayXg += .1) {
    const outcome = [0, 0, 0], adjusted = [0, 0, 0];
    for (let h = 0; h <= 7; h++) for (let a = 0; a <= 7; a++) { const p = poisson(h, homeXg) * poisson(a, awayXg); outcome[h > a ? 0 : h === a ? 1 : 2] += p; const margin = h + handicap - a; adjusted[margin > 0 ? 0 : margin === 0 ? 1 : 2] += p; }
    const error = outcome.reduce((sum, value, i) => sum + Math.pow(value - target[i], 2), 0) + adjusted.reduce((sum, value, i) => sum + Math.pow(value - handicapTarget[i], 2), 0) * .8;
    if (error < best.error) best = { error, homeXg, awayXg };
  }
  const style = analyzeStyleMatchup(league, target, handicap, storedProfile, matchup);
  const scores: Array<{ score: string; probability: number }> = [];
  for (let h = 0; h <= 7; h++) for (let a = 0; a <= 7; a++) scores.push({ score: `${h}–${a}`, probability: poisson(h, best.homeXg) * poisson(a, best.awayXg) });
  scores.sort((a, b) => b.probability - a.probability);
  return { homeXg: Number(best.homeXg.toFixed(2)), awayXg: Number(best.awayXg.toFixed(2)), marketHomeXg: Number(best.homeXg.toFixed(2)), marketAwayXg: Number(best.awayXg.toFixed(2)), topScores: scores.slice(0, 3).map(x => ({ score: x.score, probability: Number(x.probability.toFixed(4)) })), confidence: Number(scores[0].probability.toFixed(4)), fitError: Number(best.error.toFixed(5)), style, modelKind:"MARKET_IMPLIED_BASELINE", independentEvidence:false };
};

const classifyLeague = (league: string) => {
  if (/日职|日乙|韩K|韩职/.test(league)) return "日韩联赛";
  if (/欧冠|欧联|欧协/.test(league)) return "欧洲洲际";
  if (/英冠|英甲|英乙|西乙|意乙|德乙|法乙|荷乙|葡甲/.test(league)) return "欧洲次级";
  if (/英超|西甲|意甲|德甲|法甲|荷甲|葡超|比甲|苏超|瑞超|挪超|丹超|奥甲|瑞士超|土超/.test(league)) return "欧洲顶级";
  return "其他赛事";
};
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const DOMESTIC_SOURCE_POLICY = {
  timezone: "Asia/Shanghai",
  matchAuthority: "sporttery",
  stopTimeAuthority: "sporttery_only",
  conflictRule: "官方源优先；500与澳客互证；冲突保留原值、来源与采集时间并降级",
  closureRule: "赛前分析与赛后回测使用同源字段、同口径和同一快照",
  sources: [
    { code: "sporttery", label: "中国竞彩网", tier: "T0", role: "官方竞彩场次 / SP / 销售状态", mode: "live_api", official: true },
    { code: "lottery_gov", label: "国家体育总局彩票管理中心", tier: "T0", role: "政策、公告与官方口径", mode: "governance", official: true },
    { code: "500", label: "500彩票网", tier: "T1", role: "场次、SP与赔率快照交叉核验", mode: "audit_only", official: false },
    { code: "okooo", label: "澳客", tier: "T1", role: "赛程、赔率与赛果交叉核验", mode: "audit_only", official: false },
    { code: "zgzcw", label: "中国足彩网", tier: "T2", role: "第三方平台销售页观察", mode: "audit_only", official: false },
  ],
};

function cachedOddsTargets(cached:any){const year=new Date().getUTCFullYear();return (cached?.matches||[]).map((x:any)=>{const value=String(x.time||"");const matched=value.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);let startTime:null|string=null;if(matched){const [,month,day,hour,minute]=matched;startTime=new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`).toISOString()}return{id:String(x.sourceEventId||""),home:String(x.home||""),away:String(x.away||""),startTime}}).filter((x:any)=>x.id)}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

async function fetchProviderJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  return response.json();
}

async function handleJpiData(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const requestedDate = requestUrl.searchParams.get("date");
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : new Date().toISOString().slice(0, 10);
  const footballDataToken = env.FOOTBALL_DATA_API_TOKEN && env.FOOTBALL_DATA_API_TOKEN !== env.ODDS_API_IO_KEY
    ? env.FOOTBALL_DATA_API_TOKEN
    : undefined;

  const footballData = {
    id: "football-data.org",
    label: "Football-Data",
    configured: Boolean(footballDataToken),
    status: footballDataToken ? "checking" : "awaiting_key",
    fixtures: 0,
    error: null as string | null,
  };
  const oddsApi = {
    id: "odds-api.io",
    label: "Odds-API.io",
    configured: Boolean(env.ODDS_API_IO_KEY),
    status: env.ODDS_API_IO_KEY ? "checking" : "awaiting_verification",
    events: 0,
    error: null as string | null,
  };

  await Promise.all([
    footballDataToken
      ? fetchProviderJson(
          "https://api.football-data.org/v4/matches",
          { headers: { "X-Auth-Token": footballDataToken } },
        )
          .then((payload: any) => {
            footballData.status = "ready";
            footballData.fixtures = Array.isArray(payload?.matches) ? payload.matches.length : 0;
          })
          .catch((error: Error) => {
            footballData.status = "error";
            footballData.error = error.message;
          })
      : Promise.resolve(),
    env.ODDS_API_IO_KEY
      ? fetchProviderJson(
          `https://api.odds-api.io/v3/events?apiKey=${encodeURIComponent(env.ODDS_API_IO_KEY)}&sport=football`,
        )
          .then((payload: any) => {
            oddsApi.status = "ready";
            oddsApi.events = Array.isArray(payload)
              ? payload.length
              : Array.isArray(payload?.data)
                ? payload.data.length
                : Array.isArray(payload?.events)
                  ? payload.events.length
                  : 0;
          })
          .catch((error: Error) => {
            oddsApi.status = "error";
            oddsApi.error = error.message;
          })
      : Promise.resolve(),
  ]);

  return json({
    generatedAt: new Date().toISOString(),
    date,
    mode: "server_gateway",
    sources: [footballData, oddsApi],
    governance: {
      authority: "中国体育彩票官方 > 500彩票网+澳客 > API补缺",
      certification: "缺同步双锚或正式首发时自动降级",
    },
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/football/observations") {
      try {
        if (request.method === "POST") {
          // The hosted Site is owner-private; Dispatch authorizes the owner/service caller.
          const declared = Number(request.headers.get("content-length") || 0);
          if (declared > 4500000) return json({error:"PAYLOAD_TOO_LARGE"},413);
          const reader=request.body?.getReader(); if(!reader) return json({error:"BODY_REQUIRED"},400);
          const chunks:Uint8Array[]=[]; let size=0;
          while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4500000){await reader.cancel();return json({error:"PAYLOAD_TOO_LARGE"},413)} chunks.push(value);}
          const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
          return json(await ingestObservation(env.DB,JSON.parse(new TextDecoder().decode(bytes))),201);
        }
        if (request.method !== "GET") return json({error:"METHOD_NOT_ALLOWED"},405);
        const saved=await readObservation(env.DB);
        if(!saved) return json({error:"NO_OBSERVATION_SNAPSHOT",formal_eligible:false},503);
        return json({status:saved.stale?"STALE":"CURRENT",snapshot_hash:saved.snapshot_hash,sales_date:saved.observation.sales_date,observed_at:saved.observation.observed_at,matches:saved.observation.matches.length,inputs:saved.inputs,formal_eligible:false,missing:INPUT_GAPS},saved.stale?503:200);
      } catch(error) {return json({error:"OBSERVATION_INTAKE_FAILED",message:error instanceof Error?error.message:"unknown",formal_eligible:false},400);}
    }

    if(url.pathname==="/api/analyses"&&request.method==="GET"){try{return Response.json(await listAnalyses(env.DB,url),{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({error:"ANALYSIS_DATABASE_UNAVAILABLE",message:error instanceof Error?error.message:"Unknown error"},{status:503})}}
    if(url.pathname==="/api/analyses"&&request.method==="POST"){try{if(Number(request.headers.get("content-length")||0)>262144)throw new Error("PAYLOAD_TOO_LARGE");return Response.json(await saveAnalysis(env.DB,await request.json() as any),{status:201,headers:{"Cache-Control":"no-store"}})}catch(error){const message=error instanceof Error?error.message:"Unknown error";return Response.json({error:"ANALYSIS_SAVE_FAILED",message},{status:/REQUIRED|TOO_LARGE/.test(message)?400:503})}}
    if(url.pathname.startsWith("/api/analyses/")&&request.method==="GET"){const id=decodeURIComponent(url.pathname.slice(14));try{const record=await getAnalysis(env.DB,id);return record?Response.json(record,{headers:{"Cache-Control":"no-store"}}):Response.json({error:"ANALYSIS_NOT_FOUND"},{status:404})}catch(error){return Response.json({error:"ANALYSIS_READ_FAILED",message:error instanceof Error?error.message:"Unknown error"},{status:503})}}
    if(url.pathname.startsWith("/api/analyses/")&&request.method==="DELETE"){const id=decodeURIComponent(url.pathname.slice(14));try{return await deleteAnalysis(env.DB,id)?Response.json({deleted:true,id},{headers:{"Cache-Control":"no-store"}}):Response.json({error:"ANALYSIS_NOT_FOUND"},{status:404})}catch(error){return Response.json({error:"ANALYSIS_DELETE_FAILED",message:error instanceof Error?error.message:"Unknown error"},{status:503})}}
    if(url.pathname==="/api/results/overview"&&request.method==="GET"){try{return Response.json(await resultOverview(env.DB),{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({error:"RESULT_DATABASE_UNAVAILABLE",message:error instanceof Error?error.message:"Unknown error"},{status:503})}}
    if(url.pathname==="/api/backtest/reviews"&&request.method==="POST"){try{if(Number(request.headers.get("content-length")||0)>65536)throw new Error("PAYLOAD_TOO_LARGE");return Response.json(await saveReview(env.DB,await request.json() as any),{status:201,headers:{"Cache-Control":"no-store"}})}catch(error){const message=error instanceof Error?error.message:"Unknown error";return Response.json({error:"BACKTEST_REVIEW_SAVE_FAILED",message},{status:/NOT_FOUND/.test(message)?404:/ALREADY/.test(message)?409:/INVALID|TOO_LARGE/.test(message)?400:503})}}
    if(url.pathname==="/api/domestic-sources"){
      let cached:any=null;
      try{cached=await readLiveFootballCache(env.DB)}catch{/* No cache yet. */}
      const sources=DOMESTIC_SOURCE_POLICY.sources.map(source=>source.code==="sporttery"?{...source,status:cached?.matches?.length?"ready":"bound",records:cached?.matches?.length||0,lastSuccessAt:cached?.updatedAt||null,stopTimeVerified:false}:{...source,status:"bound",records:null,lastSuccessAt:null,stopTimeVerified:source.official?null:false});
      return Response.json({...DOMESTIC_SOURCE_POLICY,sources,warning:"第三方平台截止时间不得作为中国体育彩票官方实际停售证明；官方停售未取得可审计字段时必须标注未核验并降级。"},{headers:{"Cache-Control":"no-store"}})
    }
    if(url.pathname==="/api/data-rules")return Response.json(PUBLIC_DATA_RULES,{headers:{"Cache-Control":"public, max-age=3600, s-maxage=86400"}});
    if(url.pathname==="/api/system/audit")return Response.json(SYSTEM_AUDIT,{headers:{"Cache-Control":"no-store"}});
    if(url.pathname==="/api/hybrid-engine/spec")return Response.json(HYBRID_ENGINE_SPEC,{headers:{"Cache-Control":"no-store"}});
    if(url.pathname==="/api/value-library")return Response.json({rules:VALUE_RULES,records:[],count:0,status:"WATCH_ONLY",warning:"模型尚未完成500场校准且缺少收盘赔率，当前不生成正式价值候选"},{headers:{"Cache-Control":"no-store"}});
    if(url.pathname==="/api/backtest/overview"){try{return Response.json(await getBacktestOverview(env.DB),{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({error:"BACKTEST_DATABASE_UNAVAILABLE",message:error instanceof Error?error.message:"Unknown error"},{status:503,headers:{"Cache-Control":"no-store"}})}}
    if(url.pathname==="/api/players/statistics"){try{return Response.json(await getPlayerStatistics(env.DB,url),{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({error:"PLAYER_STATISTICS_UNAVAILABLE",message:error instanceof Error?error.message:"Unknown error"},{status:503,headers:{"Cache-Control":"no-store"}})}}
    if(url.pathname==="/api/data-sources"){const sources=env.DB?await ensureSourceDatabase(env.DB):[];return Response.json({sources,count:sources.length,storage:env.DB?"D1":"unavailable",policy:{priority:"官方/授权API优先",failure:"失败不得清空或覆盖最后有效快照",secrets:"仅服务端环境变量",refresh:"按各源refresh_minutes缓存"}},{headers:{"Cache-Control":"no-store"}})}
    if(url.pathname==="/api/odds/market"){let data:any,storage="D1",refresh:any=null;try{await ensureOddsDatabase(env.DB);let cached:any=null;try{cached=await readLiveFootballCache(env.DB)}catch{/* International odds may still be stored without a domestic match mapping. */}const targets=cachedOddsTargets(cached);const international=await refreshOddsApiIo(env.DB,env.ODDS_API_IO_KEY,targets);const fallback=["failed","unconfigured","blocked"].includes(international.status)?await refreshApiFootball(env.DB,env.API_FOOTBALL_KEY,url.searchParams.get("date")||undefined):{status:"not_needed",records:0};refresh={international,fallback};data=await ensureOddsDatabase(env.DB)}catch(error){data={bookmakers:BOOKMAKERS,europeanOdds:[],asianLines:[]};storage="seed_fallback";refresh={international:{status:"failed",records:0,error:error instanceof Error?error.message:"unknown"}}}const matchId=url.searchParams.get("matchId"),bookmaker=url.searchParams.get("bookmaker"),eu=data.europeanOdds.filter((x:any)=>(!matchId||x.match_id===matchId)&&(!bookmaker||x.bookmaker===bookmaker)),asian=data.asianLines.filter((x:any)=>(!matchId||x.match_id===matchId)&&(!bookmaker||x.bookmaker===bookmaker)),rows=matchId?buildMarketRows(eu,asian):[];const sourceCoverage=BOOKMAKERS.map(book=>({bookmaker:book.code,name:book.name,europeanRecords:eu.filter((x:any)=>x.bookmaker===book.code).length,asianRecords:asian.filter((x:any)=>x.bookmaker===book.code).length,bound:true}));return Response.json({bookmakers:bookmaker?data.bookmakers.filter((x:any)=>x.code===bookmaker):data.bookmakers,europeanOdds:eu,asianLines:asian,attitude:rows.length?marketAttitude(rows):{status:"NOT_EVALUATED",reason:"选择具体比赛后计算"},audit:rows.length?auditMarketCoverage(rows):{rule:"AC-008",status:"NOT_EVALUATED",certification:"DQ-C",reason:"未指定比赛，不跨场拼接同步双锚"},sourceCoverage,binding:INTERNATIONAL_ODDS_POLICY,storage,refresh,definitions:{european:"初始/即时胜平负报价；概率比较前强制去水",asian:"初始/即时让球线及主客十进制赔付",initial:"系统首次成功观测；不得冒充博彩公司官方开盘",regionalPreference:"博彩公司主要市场标签；无成交量时不推断真实地区资金流"}},{headers:{"Cache-Control":"no-store"}})}

    if (url.pathname === "/api/leagues") {
      try {
        const rows = await ensureLeagueDatabase(env.DB);
        const name = url.searchParams.get("name");
        const leagues = name ? rows.filter((x: any) => x.name === name) : rows;
        return Response.json({ leagues, count: leagues.length, storage: "D1", metricDefinition: { avg_goals: "每场总进球", over_rate: "全场大于2.5球占比", under_rate: "全场小于2.5球占比", draw_rate: "90分钟平局占比", home_win_rate: "90分钟主胜占比", home_away_diff: "主场每场积分减客场每场积分" } }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=900" } });
      } catch {
        const rows = seedRows(); const name = url.searchParams.get("name"); const leagues = name ? rows.filter((x: any) => x.name === name) : rows;
        return Response.json({ leagues, count: leagues.length, storage: "seed_fallback", warning: "数据库暂不可用；统计字段保持空值" }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    if(url.pathname==="/api/teams"||url.pathname==="/api/players/dynamics"){let data:any,storage="D1";try{data=await ensureTeamDatabase(env.DB)}catch{data=seedTeamData();storage="seed_fallback"}if(url.pathname==="/api/players/dynamics")return Response.json({players:data.players,count:data.players.length,storage,warning:data.players.length?null:"尚未接入权威球员动态源，不生成虚假伤停记录"});const league=url.searchParams.get("league"),rankings=league?data.rankings.filter((x:any)=>x.league===league):data.rankings,strengthMap=new Map(data.strengths.map((x:any)=>[x.team_name,x]));return Response.json({teams:rankings.map((x:any)=>({...x,strength:strengthMap.get(x.name)||null})),count:rankings.length,storage,rankingDefinition:{official_rank:"官方联赛排名",system_rank:"综合排名",market_rating:"当期竞彩去水概率代理，仅用于冷启动"}})}

    if (url.pathname === "/api/football/live") {
      let leagueProfiles = new Map<string, any>(), teamStrengths = new Map<string, any>();
      try { const rows = await ensureLeagueDatabase(env.DB); leagueProfiles = new Map(rows.map((x: any) => [x.name, { tempo:x.tempo, physical:x.physical, press:x.press, transition:x.transition, defaultStyle:x.style, note:x.style_note }])); } catch { /* Rule library remains available. */ }
      try { const data = await ensureTeamDatabase(env.DB); teamStrengths = new Map(data.strengths.map((x: any) => [String(x.team_name), x])); } catch { const data = seedTeamData(); teamStrengths = new Map(data.strengths.map((x: any) => [String(x.team_name), x])); }
      const { official, attempt: sourceAttempt } = await fetchOfficialFootball();
      try {
        if (official) {
          const groups = official?.value?.matchInfoList;
          if (Array.isArray(groups)) {
            const matches = groups.flatMap((group: any) => (group.subMatchList || []).map((item: any) => {
              const hadOdds = [item.had?.h, item.had?.d, item.had?.a].map((v: any) => Number(v));
              const hhadOdds = [item.hhad?.h, item.hhad?.d, item.hhad?.a].map((v: any) => Number(v));
              const validHad = hadOdds.every((v: number) => Number.isFinite(v) && v > 1);
              const inverse = validHad ? hadOdds.map((v: number) => 1 / v) : [0, 0, 0];
              const total = inverse.reduce((a: number, b: number) => a + b, 0);
              const probabilities = total ? inverse.map((v: number) => v / total) : [0, 0, 0];
              const labels = ["主队倾向", "均衡 / 防平", "客队倾向"];
              const maxIndex = probabilities.indexOf(Math.max(...probabilities));
              const pdi = total ? Math.max(...probabilities) : .5;
              const handicap = item.hhad?.goalLine || "";
              const hhadText = hhadOdds.every((v: number) => Number.isFinite(v) && v > 1) ? hhadOdds.map((v: number) => v.toFixed(2)).join("/") : "未开售";
              const matchNum = item.matchNumStr || `${item.matchWeek || ""}${String(item.matchNum || "").slice(-3)}`;
              const model = validHad && hhadOdds.every((v: number) => Number.isFinite(v) && v > 1) ? marketImpliedScoreModel(hadOdds, hhadOdds, Number(handicap || 0), item.leagueAbbName, leagueProfiles.get(item.leagueAbbName), { home: teamStrengths.get(item.homeTeamAbbName), away: teamStrengths.get(item.awayTeamAbbName), homeName: item.homeTeamAbbName, awayName: item.awayTeamAbbName }) : null;
              return { league: item.leagueAbbName, group: classifyLeague(item.leagueAbbName), tier: "竞彩", state: item.matchStatus === "Selling" ? "pre" : "pre", time: `${item.matchDate?.slice(5).replace("-", "/")} ${item.matchTime?.slice(0, 5)}`, home: item.homeTeamAbbName, away: item.awayTeamAbbName, dq: "C", edge: total ? `${((1 / total) * 100).toFixed(1)}%返还` : "—", risk: validHad ? "C" : "D", signal: validHad ? labels[maxIndex] : "赔率未开售", score: model?.topScores[0]?.score || "—", scoreConfidence: model?.confidence || 0, topScores: model?.topScores || [], homeXg: model?.homeXg ?? null, awayXg: model?.awayXg ?? null, marketHomeXg: model?.marketHomeXg ?? null, marketAwayXg: model?.marketAwayXg ?? null, style: model?.style ?? null, modelFitError: model?.fitError ?? null, modelKind:model?.modelKind||null, pdi: Number(pdi.toFixed(2)), draw: `让${handicap || "0"} ${hhadText}`, odds: validHad ? hadOdds.map((v: number) => v.toFixed(2)) : ["—", "—", "—"], status: `${matchNum} · ${validHad ? hadOdds.map((v: number) => v.toFixed(2)).join("/") : "未开售"}`, sourceEventId: String(item.matchId), salesDate: item.businessDate || group.businessDate, matchNum, handicap, hhadOdds: hhadText, sellStatus: item.sellStatus };
            }));
            const completeMatches = matches.filter((match: any) => /^\d+$/.test(match.sourceEventId) && [match.home,match.away,match.league].every(x=>typeof x==='string' && x.trim()) && Array.isArray(match.odds) && match.odds.length===3 && match.odds.every((value: any) => Number.isFinite(Number(value)) && Number(value) > 1));
            const officialComplete = completeMatches.length > 0 && new Set(completeMatches.map((m:any)=>m.sourceEventId)).size===completeMatches.length;
            if (officialComplete) {
              const payload = { matches: completeMatches, updatedAt: new Date().toISOString(), source: "中国体育彩票官方竞彩", stale: false, sourceHealth: { requested: 1, succeeded: 1, hasData: true, complete: true, officialCount: matches.length } };
              await saveLiveFootballCache(env.DB, payload);
              return Response.json(payload, { headers: { "Cache-Control": "public, max-age=60, s-maxage=180", "X-Football-Data": "sporttery-live" } });
            }

          }
        }
      } catch { sourceAttempt.outcome = "processing_failed"; }
      try {
        const saved=await readObservation(env.DB);
        if(saved && !saved.stale) return json({matches:observationMatches(saved.observation,classifyLeague),updatedAt:saved.observation.observed_at,source:"500彩票网＋澳客交叉观察",sourceKind:"THIRD_PARTY_JINGCAI_OBSERVATIONS",stale:false,sourceAttempt,analysisStatus:"PRE_ANALYSIS",formalEligible:false,officialVerification:"NOT_VERIFIED",snapshotHash:saved.snapshot_hash,persistence:{status:"verified",snapshotHash:saved.snapshot_hash},sourceHealth:{requested:2,succeeded:2,hasData:true,officialVerified:false,mode:"cross_checked_observation"},warning:"第三方页面交叉观察，官方未核验；市场概率不等于独立预测，正式分析输入与回测尚缺。"});
      } catch { /* Preserve official failure and last valid cache; never manufacture a snapshot. */ }
      try {
        const cached = await readLiveFootballCache(env.DB);
        const cachedMatches = Array.isArray(cached?.matches) ? cached.matches : [];
        const cachedComplete = cachedMatches.length > 0 && cachedMatches.every((match: any) => Array.isArray(match.odds) && match.odds.every((value: any) => Number(value) > 1) && match.hhadOdds !== "未开售");
        if (cachedComplete) return Response.json({ ...cached, stale: true, sourceAttempt }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300", "X-Football-Data": "sporttery-last-success" } });
      } catch { /* A missing cache is handled as a controlled unavailable state. */ }
      const requestedDate = url.searchParams.get("date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (url.searchParams.get("allowFallback") === "1" && url.searchParams.get("date") && SPORTTERY_SNAPSHOT.some(x=>x.businessDate===requestedDate)) {
        const matches = SPORTTERY_SNAPSHOT.filter(x=>x.businessDate===requestedDate).map((item) => {
          const hadOdds = [item.hadH, item.hadD, item.hadA].map(Number);
          const validHad = hadOdds.every((v) => Number.isFinite(v) && v > 1); const inverse = validHad ? hadOdds.map((v) => 1 / v) : [0, 0, 0]; const total = inverse.reduce((a, b) => a + b, 0); const probabilities = total ? inverse.map((v) => v / total) : [0, 0, 0]; const maxIndex = probabilities.indexOf(Math.max(...probabilities));
          const labels = ["主队倾向", "均衡 / 防平", "客队倾向"]; const hhadText = [item.hhadH, item.hhadD, item.hhadA].filter(Boolean).join("/") || "未开售"; const hhad = [item.hhadH, item.hhadD, item.hhadA].map(Number); const model = validHad ? marketImpliedScoreModel(hadOdds, hhad, Number(item.handicap || 0), item.league, leagueProfiles.get(item.league), { home: teamStrengths.get(item.home), away: teamStrengths.get(item.away), homeName: item.home, awayName: item.away }) : null;
          return { league: item.league, group: classifyLeague(item.league), tier: "竞彩", state: "pre", time: `${item.date.slice(5).replace("-", "/")} ${item.time}`, home: item.home, away: item.away, dq: "C", edge: total ? `${((1 / total) * 100).toFixed(1)}%返还` : "—", risk: validHad ? "C" : "D", signal: validHad ? labels[maxIndex] : "赔率未开售", score: model?.topScores[0]?.score || "—", scoreConfidence: model?.confidence || 0, topScores: model?.topScores || [], homeXg: model?.homeXg ?? null, awayXg: model?.awayXg ?? null, marketHomeXg: model?.marketHomeXg ?? null, marketAwayXg: model?.marketAwayXg ?? null, style: model?.style ?? null, modelFitError: model?.fitError ?? null, modelKind:model?.modelKind||null, pdi: total ? Number(Math.max(...probabilities).toFixed(2)) : .5, draw: `让${item.handicap || "0"} ${hhadText}`, odds: validHad ? hadOdds.map((v) => v.toFixed(2)) : ["—", "—", "—"], status: `${item.matchNum} · ${validHad ? hadOdds.map((v) => v.toFixed(2)).join("/") : "未开售"}`, sourceEventId: item.matchId, salesDate: item.businessDate, matchNum: item.matchNum, handicap: item.handicap, hhadOdds: hhadText, sellStatus: item.sellStatus };
        });
        const snapshotDates = [...new Set(SPORTTERY_SNAPSHOT.map((item) => item.businessDate))];
        return Response.json({ matches, updatedAt: null, source: "历史示例快照", stale: true, sourceAttempt, snapshotDates, requestedDate, warning: `官方当前数据不完整；显示最近已验证快照（${snapshotDates.join("、")}）`, sourceHealth: { requested: 1, succeeded: 0, hasData: true, complete: true, officialCount: matches.length, mode: "verified_snapshot_fallback" } }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=900", "X-Football-Data": "sporttery-verified-snapshot" } });
      }
      if (url.searchParams.get("allowFallback") !== "1") return Response.json({ matches: [], source: "中国体育彩票官方竞彩", stale: true, sourceAttempt, error: "OFFICIAL_SOURCE_TEMPORARILY_UNAVAILABLE", message: "官方数据暂不可用，且当前销售日没有已验证快照" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      const leagues = [
        ["日职", "jpn.1", "日韩联赛", "一级"], ["韩K职", "kor.1", "日韩联赛", "一级"],
        ["英超", "eng.1", "欧洲顶级", "一级"], ["西甲", "esp.1", "欧洲顶级", "一级"], ["意甲", "ita.1", "欧洲顶级", "一级"], ["德甲", "ger.1", "欧洲顶级", "一级"], ["法甲", "fra.1", "欧洲顶级", "一级"], ["荷甲", "ned.1", "欧洲顶级", "一级"], ["葡超", "por.1", "欧洲顶级", "一级"], ["比甲", "bel.1", "欧洲顶级", "一级"], ["苏超", "sco.1", "欧洲顶级", "一级"], ["土超", "tur.1", "欧洲顶级", "一级"],
        ["英冠", "eng.2", "欧洲次级", "二级"], ["英甲", "eng.3", "欧洲次级", "三级"], ["英乙", "eng.4", "欧洲次级", "四级"], ["西乙", "esp.2", "欧洲次级", "二级"], ["意乙", "ita.2", "欧洲次级", "二级"], ["德乙", "ger.2", "欧洲次级", "二级"], ["法乙", "fra.2", "欧洲次级", "二级"],
        ["欧冠", "uefa.champions", "欧洲洲际", "洲际"], ["欧联", "uefa.europa", "欧洲洲际", "洲际"], ["欧协联", "uefa.europa.conf", "欧洲洲际", "洲际"]
      ] as const;
      try {
        const settled = await Promise.allSettled(leagues.map(async ([label, code, group, tier]) => {
          const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard`, { headers: { "Accept": "application/json" } });
          if (!response.ok) return [];
          const payload = await response.json() as any;
          return (payload.events || []).map((event: any) => {
            const competition = event.competitions?.[0];
            const home = competition?.competitors?.find((x: any) => x.homeAway === "home");
            const away = competition?.competitors?.find((x: any) => x.homeAway === "away");
            const completed = event.status?.type?.completed;
            const inProgress = event.status?.type?.state === "in";
            const status = inProgress || completed ? `${home?.score ?? 0}–${away?.score ?? 0} · ${event.status?.type?.shortDetail || ''}` : event.status?.type?.shortDetail || "未开赛";
            const homeRecord = home?.records?.[0]?.summary || "";
            const awayRecord = away?.records?.[0]?.summary || "";
            const recordScore = (value: string) => { const n = value.split(/[-–]/).map(Number); return n.length >= 3 && n.every(Number.isFinite) ? (n[0] * 3 + n[1]) / Math.max(1, (n[0] + n[1] + n[2]) * 3) : .5; };
            const delta = recordScore(homeRecord) - recordScore(awayRecord);
            const pdi = Math.min(.88, Math.max(.42, .55 + Math.abs(delta) * .55));
            const signal = completed ? "已完场" : inProgress ? "进行中" : delta > .12 ? "主队倾向" : delta < -.12 ? "客队倾向" : "均衡 / 防平";
            const risk = !homeRecord || !awayRecord ? "C" : Math.abs(delta) < .06 ? "C" : "B";
            return { league: label, group, tier, state: completed ? "post" : inProgress ? "live" : "pre", time: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.date)), home: home?.team?.displayName || "TBD", away: away?.team?.displayName || "TBD", dq: homeRecord && awayRecord ? "B" : "C", edge: delta ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%` : "—", risk, signal, score: inProgress || completed ? `${home?.score ?? 0}–${away?.score ?? 0}` : "—", pdi: Number(pdi.toFixed(2)), draw: Math.abs(delta) < .06 ? "中度" : "轻度", odds: ["—", "—", "—"], status };
          });
        }));
        let matches = settled.flatMap(result => result.status === "fulfilled" ? result.value : []).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 160);
        let source = "ESPN public scoreboard";
        if (!matches.length) {
          const sportsDbLeagues = [["英超", "4328", "欧洲顶级", "一级"], ["英冠", "4329", "欧洲次级", "二级"], ["苏超", "4330", "欧洲顶级", "一级"], ["德甲", "4331", "欧洲顶级", "一级"], ["意甲", "4332", "欧洲顶级", "一级"], ["法甲", "4334", "欧洲顶级", "一级"], ["西甲", "4335", "欧洲顶级", "一级"], ["荷甲", "4337", "欧洲顶级", "一级"], ["比甲", "4338", "欧洲顶级", "一级"], ["土超", "4339", "欧洲顶级", "一级"], ["葡超", "4344", "欧洲顶级", "一级"], ["美职足", "4346", "其他联赛", "一级"], ["瑞超", "4347", "欧洲顶级", "一级"]] as const;
          const salesDate = url.searchParams.get("date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
          const nextDate = new Date(`${salesDate}T00:00:00+08:00`); nextDate.setDate(nextDate.getDate() + 1);
          const allowedDates = new Set([salesDate, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(nextDate)]);
          const fallback = await Promise.allSettled(sportsDbLeagues.map(async ([label, id, group, tier]) => {
            const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${id}`, { headers: { "Accept": "application/json" } });
            if (!response.ok) return [];
            const payload = await response.json() as any;
            return (payload.events || []).filter((event: any) => allowedDates.has(event.dateEvent)).map((event: any) => ({ league: label, group, tier, state: event.strStatus === "NS" ? "pre" : "live", time: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(`${event.strTimestamp}Z`)), home: event.strHomeTeam, away: event.strAwayTeam, dq: "B", edge: "—", risk: "C", signal: "待赔率分析", score: event.intHomeScore == null ? "—" : `${event.intHomeScore}–${event.intAwayScore}`, pdi: .5, draw: "待评估", odds: ["—", "—", "—"], status: event.strStatus === "NS" ? "未开赛" : event.strStatus, sourceEventId: event.idEvent, venue: event.strVenue, salesDate }));
          }));
          matches = fallback.flatMap(result => result.status === "fulfilled" ? result.value : []).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 160);
          source = "TheSportsDB V1 fallback";
        }
        return Response.json({ matches, updatedAt: new Date().toISOString(), source, sourceHealth: { requested: leagues.length, succeeded: settled.filter(x => x.status === "fulfilled").length, hasData: matches.length > 0 } }, { headers: { "Cache-Control": "public, max-age=120, s-maxage=300" } });
      } catch {
        return Response.json({ error: "Football data source unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (url.pathname === "/api/jpi-data" && request.method === "GET") {
      return handleJpiData(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
