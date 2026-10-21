"""JPi dashboard data exporter (Pre-Analysis, football-data.org).

Free tier has no odds, so output is strength-based Poisson only:
no EV, no formal recommendation. If the API fails, the last valid
dashboard_data.json is kept and only a status field is updated.
"""
import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

BASE = os.environ.get("JPI_API_URL", "").rstrip("/") or "https://api.football-data.org/v4"
TOKEN = os.environ.get("API_KEY", "").strip()
OUT = "dashboard_data.json"
DAYS_AHEAD = 3
MAX_STANDINGS = 8
HOME_ADV = 1.10
LEAGUE_AVG = 1.35
CST = timezone(timedelta(hours=8))


def get(path, params=None):
    r = requests.get(BASE + path, headers={"X-Auth-Token": TOKEN},
                     params=params, timeout=30)
    if r.status_code == 429:
        time.sleep(65)
        r = requests.get(BASE + path, headers={"X-Auth-Token": TOKEN},
                         params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def poisson(k, lam):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def score_grid(lh, la, n=7):
    grid = {(i, j): poisson(i, lh) * poisson(j, la) for i in range(n) for j in range(n)}
    ph = sum(p for (i, j), p in grid.items() if i > j)
    pd = sum(p for (i, j), p in grid.items() if i == j)
    pa = sum(p for (i, j), p in grid.items() if i < j)
    s = ph + pd + pa
    top = sorted(grid.items(), key=lambda x: -x[1])[:3]
    over25 = sum(p for (i, j), p in grid.items() if i + j >= 3) / sum(grid.values())
    return ph / s, pd / s, pa / s, [f"{i}-{j}" for (i, j), _ in top], over25


def build_strength(table):
    out = {}
    for row in table:
        g = row.get("playedGames") or 0
        if g < 3:
            continue
        out[row["team"]["id"]] = (row["goalsFor"] / g, row["goalsAgainst"] / g, g)
    return out


def lean(ph, pd, pa):
    best = max(("主胜", ph), ("平局", pd), ("客胜", pa), key=lambda x: x[1])
    if best[1] < 0.42:
        return "方向不明（预分析）"
    return f"{best[0]}倾向（预分析）"


def main():
    if not TOKEN:
        print("API_KEY 未设置，保留旧数据")
        return mark_status("no_api_key")
    now = datetime.now(CST)
    d1 = now.strftime("%Y-%m-%d")
    d2 = (now + timedelta(days=DAYS_AHEAD)).strftime("%Y-%m-%d")
    try:
        ms = get("/matches", {"dateFrom": d1, "dateTo": d2}).get("matches", [])
    except Exception as e:
        print("拉取赛程失败:", e)
        return mark_status(f"fetch_error: {e}")

    ms = [m for m in ms if m.get("status") in ("SCHEDULED", "TIMED")]
    comps = []
    for m in ms:
        c = m["competition"]["code"]
        if c not in comps:
            comps.append(c)
    strength = {}
    for c in comps[:MAX_STANDINGS]:
        try:
            st = get(f"/competitions/{c}/standings")
            tables = [t for t in st.get("standings", []) if t.get("type") == "TOTAL"]
            for t in tables:
                strength.update(build_strength(t["table"]))
        except Exception as e:
            print("积分榜失败", c, e)
        time.sleep(6.5)

    matches = []
    for m in ms:
        h, a = m["homeTeam"]["id"], m["awayTeam"]["id"]
        item = {
            "league": m["competition"]["name"],
            "kickoff": m["utcDate"],
            "home": m["homeTeam"].get("shortName") or m["homeTeam"]["name"],
            "away": m["awayTeam"].get("shortName") or m["awayTeam"]["name"],
        }
        if h in strength and a in strength:
            hf, ha, _ = strength[h]
            af, aa, _ = strength[a]
            lh = max(0.2, (hf / LEAGUE_AVG) * (aa / LEAGUE_AVG) * LEAGUE_AVG * HOME_ADV)
            la = max(0.2, (af / LEAGUE_AVG) * (ha / LEAGUE_AVG) * LEAGUE_AVG / HOME_ADV)
            ph, pd, pa, scores, o25 = score_grid(lh, la)
            item.update(prob_home=round(ph, 3), prob_draw=round(pd, 3), prob_away=round(pa, 3),
                        xg_home=round(lh, 2), xg_away=round(la, 2), over25=round(o25, 3),
                        scores=scores, ev_value=None, recommendation=lean(ph, pd, pa),
                        risk="C")
        else:
            item.update(ev_value=None, recommendation="数据不足，不分析", risk="D")
        matches.append(item)

    data = {
        "update_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "status": "ok",
        "summary": {
            "total_matches": len(matches),
            "ev_positive_count": 0,
            "model_version": "V17.3 Pre-Analysis (无赔率，仅实力+泊松)",
        },
        "matches": matches,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"完成：{len(matches)} 场")


def mark_status(status):
    try:
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {"update_time": "-", "summary": {}, "matches": []}
    data["status"] = status
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
