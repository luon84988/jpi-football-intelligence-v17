/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { SPORTTERY_SNAPSHOT } from "./sporttery-snapshot";
import { analyzeStyleMatchup } from "./style-rules";
import { ensureLeagueDatabase, seedRows } from "./league-database";
import { ensureTeamDatabase, seedTeamData } from "./team-database";
import { PUBLIC_DATA_RULES } from "./public-data-rules";
import { BOOKMAKERS, ensureOddsDatabase, marketAttitude } from "./odds-database";
import { SYSTEM_AUDIT } from "./rule-audit";
import { VALUE_RULES } from "./value-library";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
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

const scoreModel = (had: number[], hhad: number[], handicap: number, league: string, storedProfile?: any) => {
  if (![...had, ...hhad].every(v => Number.isFinite(v) && v > 1)) return null;
  const normalize = (odds: number[]) => { const inv = odds.map(v => 1 / v); const sum = inv.reduce((a, b) => a + b, 0); return inv.map(v => v / sum); };
  const target = normalize(had), handicapTarget = normalize(hhad); let best = { error: Infinity, homeXg: 0, awayXg: 0 };
  for (let homeXg = .3; homeXg <= 3.8; homeXg += .1) for (let awayXg = .3; awayXg <= 3.8; awayXg += .1) {
    const outcome = [0, 0, 0], adjusted = [0, 0, 0];
    for (let h = 0; h <= 7; h++) for (let a = 0; a <= 7; a++) { const p = poisson(h, homeXg) * poisson(a, awayXg); outcome[h > a ? 0 : h === a ? 1 : 2] += p; const margin = h + handicap - a; adjusted[margin > 0 ? 0 : margin === 0 ? 1 : 2] += p; }
    const error = outcome.reduce((sum, value, i) => sum + Math.pow(value - target[i], 2), 0) + adjusted.reduce((sum, value, i) => sum + Math.pow(value - handicapTarget[i], 2), 0) * .8;
    if (error < best.error) best = { error, homeXg, awayXg };
  }
  const style = analyzeStyleMatchup(league, target, handicap, storedProfile);
  const adjustedHomeXg = Math.max(.2, best.homeXg * (1 + style.adjustment.home));
  const adjustedAwayXg = Math.max(.2, best.awayXg * (1 + style.adjustment.away));
  const scores: Array<{ score: string; probability: number }> = [];
  for (let h = 0; h <= 7; h++) for (let a = 0; a <= 7; a++) scores.push({ score: `${h}–${a}`, probability: poisson(h, adjustedHomeXg) * poisson(a, adjustedAwayXg) });
  scores.sort((a, b) => b.probability - a.probability);
  return { homeXg: Number(adjustedHomeXg.toFixed(2)), awayXg: Number(adjustedAwayXg.toFixed(2)), marketHomeXg: Number(best.homeXg.toFixed(2)), marketAwayXg: Number(best.awayXg.toFixed(2)), topScores: scores.slice(0, 3).map(x => ({ score: x.score, probability: Number(x.probability.toFixed(4)) })), confidence: Number(scores[0].probability.toFixed(4)), fitError: Number(best.error.toFixed(5)), style };
};

const classifyLeague = (league: string) => {
  if (/日职|日乙|韩K|韩职/.test(league)) return "日韩联赛";
  if (/欧冠|欧联|欧协/.test(league)) return "欧洲洲际";
  if (/英冠|英甲|英乙|西乙|意乙|德乙|法乙|荷乙|葡甲/.test(league)) return "欧洲次级";
  if (/英超|西甲|意甲|德甲|法甲|荷甲|葡超|比甲|苏超|瑞超|挪超|丹超|奥甲|瑞士超|土超/.test(league)) return "欧洲顶级";
  return "其他赛事";
};

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if(url.pathname==="/api/data-rules")return Response.json(PUBLIC_DATA_RULES,{headers:{"Cache-Control":"public, max-age=3600, s-maxage=86400"}});
    if(url.pathname==="/api/system/audit")return Response.json(SYSTEM_AUDIT,{headers:{"Cache-Control":"no-store"}});
    if(url.pathname==="/api/value-library")return Response.json({rules:VALUE_RULES,records:[],count:0,status:"WATCH_ONLY",warning:"模型尚未完成500场校准且缺少收盘赔率，当前不生成正式价值候选"},{headers:{"Cache-Control":"no-store"}});
    if(url.pathname==="/api/odds/market"){let data:any,storage="D1";try{data=await ensureOddsDatabase(env.DB)}catch{data={bookmakers:BOOKMAKERS,europeanOdds:[],asianLines:[]};storage="seed_fallback"}const matchId=url.searchParams.get("matchId"),bookmaker=url.searchParams.get("bookmaker"),eu=data.europeanOdds.filter((x:any)=>(!matchId||x.match_id===matchId)&&(!bookmaker||x.bookmaker===bookmaker)),asian=data.asianLines.filter((x:any)=>(!matchId||x.match_id===matchId)&&(!bookmaker||x.bookmaker===bookmaker));return Response.json({bookmakers:bookmaker?data.bookmakers.filter((x:any)=>x.code===bookmaker):data.bookmakers,europeanOdds:eu,asianLines:asian,attitude:marketAttitude([]),storage,definitions:{european:"去水胜平负概率、返还率与超额利润率",asian:"开盘/即时盘口和主客水位变化",regionalPreference:"博彩公司主要市场标签；无成交量时不推断真实地区资金流"}})}

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
      let leagueProfiles = new Map<string, any>();
      try { const rows = await ensureLeagueDatabase(env.DB); leagueProfiles = new Map(rows.map((x: any) => [x.name, { tempo:x.tempo, physical:x.physical, press:x.press, transition:x.transition, defaultStyle:x.style, note:x.style_note }])); } catch { /* Rule library remains available. */ }
      try {
        const officialUrl = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=had,hhad";
        const officialResponse = await fetch(officialUrl, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1", "Accept": "application/json, text/javascript, */*; q=0.01", "Referer": "https://m.sporttery.cn/mjc/jsq/zqspf/", "Origin": "https://m.sporttery.cn", "X-Requested-With": "XMLHttpRequest" } });
        if (officialResponse.ok) {
          const official = await officialResponse.json() as any;
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
              const model = validHad && hhadOdds.every((v: number) => Number.isFinite(v) && v > 1) ? scoreModel(hadOdds, hhadOdds, Number(handicap || 0), item.leagueAbbName, leagueProfiles.get(item.leagueAbbName)) : null;
              return { league: item.leagueAbbName, group: classifyLeague(item.leagueAbbName), tier: "竞彩", state: item.matchStatus === "Selling" ? "pre" : "pre", time: `${item.matchDate?.slice(5).replace("-", "/")} ${item.matchTime?.slice(0, 5)}`, home: item.homeTeamAbbName, away: item.awayTeamAbbName, dq: validHad ? "A" : "C", edge: total ? `${((1 / total) * 100).toFixed(1)}%返还` : "—", risk: model && model.fitError < .035 ? "B" : validHad ? "C" : "D", signal: validHad ? labels[maxIndex] : "赔率未开售", score: model?.topScores[0]?.score || "—", scoreConfidence: model?.confidence || 0, topScores: model?.topScores || [], homeXg: model?.homeXg ?? null, awayXg: model?.awayXg ?? null, marketHomeXg: model?.marketHomeXg ?? null, marketAwayXg: model?.marketAwayXg ?? null, style: model?.style ?? null, modelFitError: model?.fitError ?? null, pdi: Number(pdi.toFixed(2)), draw: `让${handicap || "0"} ${hhadText}`, odds: validHad ? hadOdds.map((v: number) => v.toFixed(2)) : ["—", "—", "—"], status: `${matchNum} · ${validHad ? hadOdds.map((v: number) => v.toFixed(2)).join("/") : "未开售"}`, sourceEventId: String(item.matchId), salesDate: item.businessDate || group.businessDate, matchNum, handicap, hhadOdds: hhadText, sellStatus: item.sellStatus };
            }));
            if (matches.length) return Response.json({ matches, updatedAt: new Date().toISOString(), source: "中国体育彩票官方竞彩", sourceHealth: { requested: 1, succeeded: 1, hasData: true, officialCount: matches.length } }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=180" } });
          }
        }
      } catch { /* Continue to public fixture fallbacks. */ }
      const requestedDate = url.searchParams.get("date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (requestedDate === "2026-08-22" && SPORTTERY_SNAPSHOT.length) {
        const matches = SPORTTERY_SNAPSHOT.map((item) => {
          const hadOdds = [item.hadH, item.hadD, item.hadA].map(Number);
          const validHad = hadOdds.every((v) => Number.isFinite(v) && v > 1); const inverse = validHad ? hadOdds.map((v) => 1 / v) : [0, 0, 0]; const total = inverse.reduce((a, b) => a + b, 0); const probabilities = total ? inverse.map((v) => v / total) : [0, 0, 0]; const maxIndex = probabilities.indexOf(Math.max(...probabilities));
          const labels = ["主队倾向", "均衡 / 防平", "客队倾向"]; const hhadText = [item.hhadH, item.hhadD, item.hhadA].filter(Boolean).join("/") || "未开售"; const hhad = [item.hhadH, item.hhadD, item.hhadA].map(Number); const model = validHad ? scoreModel(hadOdds, hhad, Number(item.handicap || 0), item.league, leagueProfiles.get(item.league)) : null;
          return { league: item.league, group: classifyLeague(item.league), tier: "竞彩", state: "pre", time: `${item.date.slice(5).replace("-", "/")} ${item.time}`, home: item.home, away: item.away, dq: validHad ? "A" : "C", edge: total ? `${((1 / total) * 100).toFixed(1)}%返还` : "—", risk: model && model.fitError < .035 ? "B" : "C", signal: validHad ? labels[maxIndex] : "赔率未开售", score: model?.topScores[0]?.score || "—", scoreConfidence: model?.confidence || 0, topScores: model?.topScores || [], homeXg: model?.homeXg ?? null, awayXg: model?.awayXg ?? null, marketHomeXg: model?.marketHomeXg ?? null, marketAwayXg: model?.marketAwayXg ?? null, style: model?.style ?? null, modelFitError: model?.fitError ?? null, pdi: total ? Number(Math.max(...probabilities).toFixed(2)) : .5, draw: `让${item.handicap || "0"} ${hhadText}`, odds: validHad ? hadOdds.map((v) => v.toFixed(2)) : ["—", "—", "—"], status: `${item.matchNum} · ${validHad ? hadOdds.map((v) => v.toFixed(2)).join("/") : "未开售"}`, sourceEventId: item.matchId, salesDate: item.businessDate, matchNum: item.matchNum, handicap: item.handicap, hhadOdds: hhadText, sellStatus: item.sellStatus };
        });
        return Response.json({ matches, updatedAt: new Date().toISOString(), source: "中国体育彩票官方快照", sourceHealth: { requested: 1, succeeded: 1, hasData: true, officialCount: matches.length, mode: "verified_snapshot" } }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=900" } });
      }
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
