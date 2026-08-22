/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/football/live") {
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
