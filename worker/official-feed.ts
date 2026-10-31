/** Public upstream only. Never return request headers or response bodies in diagnostics. */
export const OFFICIAL_FOOTBALL_URL = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=had,hhad";

export async function fetchOfficialFootball(fetcher: typeof fetch = fetch) {
  const attempt: { attemptedAt: string; status: number | null; outcome: string; receivedMatches?: number } = {
    attemptedAt: new Date().toISOString(), status: null, outcome: "request_failed",
  };
  try {
    const response = await fetcher(OFFICIAL_FOOTBALL_URL, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": "https://m.sporttery.cn/mjc/jsq/zqspf/",
        "Origin": "https://m.sporttery.cn", "X-Requested-With": "XMLHttpRequest",
      },
    });
    attempt.status = response.status;
    if (!response.ok) {
      attempt.outcome = "http_error";
      return { official: null, attempt };
    }
    let official: any;
    try { official = await response.json(); }
    catch { attempt.outcome = "invalid_json"; return { official: null, attempt }; }
    const groups = official?.value?.matchInfoList;
    if (!Array.isArray(groups) || groups.some((group: any) => !Array.isArray(group?.subMatchList))) {
      attempt.outcome = "invalid_match_groups";
      return { official: null, attempt };
    }
    attempt.receivedMatches = groups.reduce((n: number, group: any) => n + group.subMatchList.length, 0);
    attempt.outcome = attempt.receivedMatches ? "received" : "empty_slate";
    return { official, attempt };
  } catch (error) {
    attempt.outcome = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "timeout" : "request_failed";
    return { official: null, attempt };
  }
}
