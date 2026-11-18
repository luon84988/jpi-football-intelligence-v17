/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { ingestObservation, readObservation, observationMatches, INPUT_GAPS } from "./domestic-observations";
import { fetchOfficialFootball } from "./official-feed";
import { SPORTTERY_SNAPSHOT } from "./sporttery-snapshot";
import { ensureLeagueDatabase, seedRows } from "./league-database";
import { ensureTeamDatabase, seedTeamData } from "./team-database";
import { PUBLIC_DATA_RULES } from "./public-data-rules";
import { ensureSourceDatabase } from "./source-database";
import { getBacktestOverview } from "./backtest-database";
import { getPlayerStatistics } from "./player-statistics-database";
import { readLiveFootballCache, saveLiveFootballCache } from "./live-football-cache";
import { deleteAnalysis, getAnalysis, listAnalyses, resultOverview, saveAnalysis, saveReview } from "./result-store";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
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

function validOfficialFixture(match: any) {
  return /^\d+$/.test(match?.sourceEventId)
    && [match.home, match.away, match.league].every(value => typeof value === "string" && value.trim())
    && match.home.trim() !== match.away.trim();
}

function fixtureFromCache(match: any) {
  const { league, group, tier, state, time, kickoff, home, away, dq, matchNum, sourceEventId, sellStatus, salesDate } = match;
  return { league, group, tier, state, time, kickoff, home, away, dq, matchNum, sourceEventId, sellStatus, salesDate, status: matchNum,
    analysisStatus: "PRE_ANALYSIS", formalEligible: false };
}

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
    { code: "sporttery", label: "中国竞彩网", tier: "T0", role: "官方竞彩场次 / 销售状态", mode: "live_api", official: true },
    { code: "lottery_gov", label: "国家体育总局彩票管理中心", tier: "T0", role: "政策、公告与官方口径", mode: "governance", official: true },
    { code: "500", label: "500彩票网", tier: "T1", role: "场次与销售状态交叉核验", mode: "audit_only", official: false },
    { code: "okooo", label: "澳客", tier: "T1", role: "赛程与赛果交叉核验", mode: "audit_only", official: false },
    { code: "zgzcw", label: "中国足彩网", tier: "T2", role: "第三方平台销售页观察", mode: "audit_only", official: false },
  ],
};

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
  const footballDataToken = env.FOOTBALL_DATA_API_TOKEN;

  const footballData = {
    id: "football-data.org",
    label: "Football-Data",
    configured: Boolean(footballDataToken),
    status: footballDataToken ? "checking" : "awaiting_key",
    fixtures: 0,
    error: null as string | null,
  };
  if (footballDataToken) {
    try {
      const payload = await fetchProviderJson("https://api.football-data.org/v4/matches", {
        headers: { "X-Auth-Token": footballDataToken },
      }) as { matches?: unknown[] };
      footballData.status = "ready";
      footballData.fixtures = Array.isArray(payload?.matches) ? payload.matches.length : 0;
    } catch (error) {
      footballData.status = "error";
      footballData.error = error instanceof Error ? error.message : "provider_unavailable";
    }
  }

  return json({
    generatedAt: new Date().toISOString(),
    date,
    mode: "server_gateway",
    sources: [footballData],
    governance: {
      authority: "中国体育彩票官方 > 500彩票网+澳客 > API补缺",
      certification: "证据不足时自动降级",
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
    if(url.pathname==="/api/backtest/overview"){try{return Response.json(await getBacktestOverview(env.DB),{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({error:"BACKTEST_DATABASE_UNAVAILABLE",message:error instanceof Error?error.message:"Unknown error"},{status:503,headers:{"Cache-Control":"no-store"}})}}
    if(url.pathname==="/api/players/statistics"){try{return Response.json(await getPlayerStatistics(env.DB,url),{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({error:"PLAYER_STATISTICS_UNAVAILABLE",message:error instanceof Error?error.message:"Unknown error"},{status:503,headers:{"Cache-Control":"no-store"}})}}
    if(url.pathname==="/api/data-sources"){const sources=env.DB?await ensureSourceDatabase(env.DB):[];return Response.json({sources,count:sources.length,storage:env.DB?"D1":"unavailable",policy:{priority:"官方/授权API优先",failure:"失败不得清空或覆盖最后有效快照",secrets:"仅服务端环境变量",refresh:"按各源refresh_minutes缓存"}},{headers:{"Cache-Control":"no-store"}})}

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
    if(url.pathname==="/api/teams"||url.pathname==="/api/players/dynamics"){let data:any,storage="D1";try{data=await ensureTeamDatabase(env.DB)}catch{data=seedTeamData();storage="seed_fallback"}if(url.pathname==="/api/players/dynamics")return Response.json({players:data.players,count:data.players.length,storage,warning:data.players.length?null:"尚未接入权威球员动态源，不生成虚假伤停记录"});const league=url.searchParams.get("league"),rankings=league?data.rankings.filter((x:any)=>x.league===league):data.rankings,strengthMap=new Map(data.strengths.map((x:any)=>[x.team_name,x]));return Response.json({teams:rankings.map((x:any)=>({...x,strength:strengthMap.get(x.name)||null})),count:rankings.length,storage,rankingDefinition:{official_rank:"官方联赛排名",system_rank:"综合排名"}})}

    if (url.pathname === "/api/football/live") {
      const { official, attempt: sourceAttempt } = await fetchOfficialFootball();
      try {
        if (official) {
          const groups = official?.value?.matchInfoList;
          if (Array.isArray(groups)) {
            const matches = groups.flatMap((group: any) => group.subMatchList.map((item: any) => {
              const matchNum = item.matchNumStr || `${item.matchWeek || ""}${String(item.matchNum || "").slice(-3)}`;
              const kickoff = /^\d{4}-\d{2}-\d{2}$/.test(item.matchDate) && /^\d{2}:\d{2}/.test(item.matchTime)
                ? `${item.matchDate}T${item.matchTime.slice(0, 5)}:00+08:00` : null;
              return {
                league: item.leagueAbbName, group: classifyLeague(String(item.leagueAbbName || "")),
                tier: "竞彩", state: "pre", time: kickoff ? kickoff.slice(5, 16).replace("-", "/").replace("T", " ") : null,
                kickoff, home: item.homeTeamAbbName, away: item.awayTeamAbbName,
                dq: "C", matchNum, sourceEventId: String(item.matchId ?? ""),
                sellStatus: item.sellStatus ?? (item.matchStatus === "Selling" ? 1 : null),
                salesDate: item.businessDate || group.businessDate,
                status: matchNum, analysisStatus: "PRE_ANALYSIS", formalEligible: false,
              };
            }));
            const completeMatches = matches.filter(validOfficialFixture);
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
        const fixtures = cachedMatches.filter(validOfficialFixture).map(fixtureFromCache);
        if (fixtures.length && new Set(fixtures.map((m: any) => m.sourceEventId)).size === fixtures.length) {
          return Response.json({ ...cached, matches: fixtures, stale: true, sourceAttempt }, {
            headers: { "Cache-Control": "public, max-age=60, s-maxage=300", "X-Football-Data": "sporttery-last-success" },
          });
        }
      } catch { /* A missing cache is handled as a controlled unavailable state. */ }
      const requestedDate = url.searchParams.get("date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (url.searchParams.get("allowFallback") === "1" && url.searchParams.get("date") && SPORTTERY_SNAPSHOT.some(x=>x.businessDate===requestedDate)) {
        const matches = SPORTTERY_SNAPSHOT.filter(item => item.businessDate === requestedDate).map(item => ({
          league: item.league, group: classifyLeague(item.league), tier: "竞彩", state: "pre",
          time: `${item.date.slice(5)} ${item.time}`, kickoff: `${item.date}T${item.time}:00+08:00`,
          home: item.home, away: item.away, dq: "C", matchNum: item.matchNum,
          sourceEventId: item.matchId, sellStatus: item.sellStatus, salesDate: item.businessDate, status: "历史赛程",
          analysisStatus: "PRE_ANALYSIS", formalEligible: false,
        }));
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
            const formConfidence = Math.min(.88, Math.max(.42, .55 + Math.abs(delta) * .55));
            const signal = completed ? "已完场" : inProgress ? "进行中" : delta > .12 ? "主队倾向" : delta < -.12 ? "客队倾向" : "均衡 / 防平";
            const risk = !homeRecord || !awayRecord ? "C" : Math.abs(delta) < .06 ? "C" : "B";
            return { league: label, group, tier, state: completed ? "post" : inProgress ? "live" : "pre", time: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.date)), home: home?.team?.displayName || "TBD", away: away?.team?.displayName || "TBD", dq: homeRecord && awayRecord ? "B" : "C", edge: delta ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%` : "—", risk, signal, score: inProgress || completed ? `${home?.score ?? 0}–${away?.score ?? 0}` : "—", formConfidence: Number(formConfidence.toFixed(2)), draw: Math.abs(delta) < .06 ? "中度" : "轻度", status };
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
            return (payload.events || []).filter((event: any) => allowedDates.has(event.dateEvent)).map((event: any) => ({ league: label, group, tier, state: event.strStatus === "NS" ? "pre" : "live", time: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(`${event.strTimestamp}Z`)), home: event.strHomeTeam, away: event.strAwayTeam, dq: "B", edge: "—", risk: "C", signal: "待独立模型分析", score: event.intHomeScore == null ? "—" : `${event.intHomeScore}–${event.intAwayScore}`, formConfidence: .5, draw: "待评估", status: event.strStatus === "NS" ? "未开赛" : event.strStatus, sourceEventId: event.idEvent, venue: event.strVenue, salesDate }));
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
