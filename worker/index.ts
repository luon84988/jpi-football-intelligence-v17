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
      const leagues = [["英超", "eng.1"], ["西甲", "esp.1"], ["意甲", "ita.1"], ["德甲", "ger.1"], ["法甲", "fra.1"], ["欧冠", "uefa.champions"]] as const;
      try {
        const results = await Promise.all(leagues.map(async ([label, code]) => {
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
            return { league: label, time: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.date)), home: home?.team?.displayName || "TBD", away: away?.team?.displayName || "TBD", dq: "B", edge: "—", risk: inProgress ? "C" : "B", signal: completed ? "已完场" : inProgress ? "进行中" : "待分析", score: inProgress || completed ? `${home?.score ?? 0}–${away?.score ?? 0}` : "—", pdi: inProgress ? 0.62 : 0.5, draw: "待评估", odds: ["—", "—", "—"], status };
          });
        }));
        const matches = results.flat().sort((a, b) => a.time.localeCompare(b.time)).slice(0, 40);
        return Response.json({ matches, updatedAt: new Date().toISOString(), source: "ESPN public scoreboard" }, { headers: { "Cache-Control": "public, max-age=120, s-maxage=300" } });
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
