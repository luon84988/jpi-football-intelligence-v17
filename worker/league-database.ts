import { LEAGUE_STYLE_LIBRARY } from "./style-rules";

const META: Record<string, [string, string, string]> = {
  英超:["英格兰","一级","欧洲顶级"], 英冠:["英格兰","二级","欧洲次级"], 英甲:["英格兰","三级","欧洲次级"], 英乙:["英格兰","四级","欧洲次级"],
  西甲:["西班牙","一级","欧洲顶级"], 西乙:["西班牙","二级","欧洲次级"], 意甲:["意大利","一级","欧洲顶级"], 意乙:["意大利","二级","欧洲次级"],
  德甲:["德国","一级","欧洲顶级"], 德乙:["德国","二级","欧洲次级"], 法甲:["法国","一级","欧洲顶级"], 法乙:["法国","二级","欧洲次级"],
  荷甲:["荷兰","一级","欧洲顶级"], 葡超:["葡萄牙","一级","欧洲顶级"], 比甲:["比利时","一级","欧洲顶级"], 苏超:["苏格兰","一级","欧洲顶级"],
  挪超:["挪威","一级","欧洲顶级"], 瑞超:["瑞典","一级","欧洲顶级"], 丹超:["丹麦","一级","欧洲顶级"], 奥甲:["奥地利","一级","欧洲顶级"],
  瑞士超:["瑞士","一级","欧洲顶级"], 土超:["土耳其","一级","欧洲顶级"], 日职:["日本","一级","日韩联赛"], 日乙:["日本","二级","日韩联赛"],
  韩K职:["韩国","一级","日韩联赛"], 欧冠:["欧洲足联","洲际","欧洲洲际"], 欧联:["欧洲足联","洲际","欧洲洲际"], 欧协联:["欧洲足联","洲际","欧洲洲际"],
};

export const LEAGUE_SEEDS = Object.entries(LEAGUE_STYLE_LIBRARY).map(([name, style]) => {
  const [country="待补充", level="待分级", groupName="其他赛事"] = META[name] || [];
  return { name, country, level, groupName, style: style.defaultStyle, tempo: style.tempo, physical: style.physical, press: style.press, transition: style.transition, styleNote: style.note, avgGoals: null, overRate: null, underRate: null, drawRate: null, homeWinRate: null, homeAwayDiff: null, seasonPhase: "赛季进行中", dataStatus: "rule_prior", updatedAt: "2026-08-22T00:00:00+08:00" };
});

export async function ensureLeagueDatabase(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS league_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, country TEXT NOT NULL, level TEXT NOT NULL, group_name TEXT NOT NULL,
    style TEXT NOT NULL, tempo REAL NOT NULL, physical REAL NOT NULL, press REAL NOT NULL, transition REAL NOT NULL, style_note TEXT,
    avg_goals REAL, over_rate REAL, under_rate REAL, draw_rate REAL, home_win_rate REAL, home_away_diff REAL,
    season_phase TEXT NOT NULL, data_status TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await db.batch(LEAGUE_SEEDS.map(x => db.prepare(`INSERT OR IGNORE INTO league_profiles
    (name,country,level,group_name,style,tempo,physical,press,transition,style_note,avg_goals,over_rate,under_rate,draw_rate,home_win_rate,home_away_diff,season_phase,data_status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(x.name,x.country,x.level,x.groupName,x.style,x.tempo,x.physical,x.press,x.transition,x.styleNote,x.avgGoals,x.overRate,x.underRate,x.drawRate,x.homeWinRate,x.homeAwayDiff,x.seasonPhase,x.dataStatus,x.updatedAt)));
  const result = await db.prepare("SELECT * FROM league_profiles ORDER BY country, level, name").all();
  return result.results || [];
}

export function seedRows() {
  return LEAGUE_SEEDS.map((x, i) => ({ id:i+1, name:x.name, country:x.country, level:x.level, group_name:x.groupName, style:x.style, tempo:x.tempo, physical:x.physical, press:x.press, transition:x.transition, style_note:x.styleNote, avg_goals:x.avgGoals, over_rate:x.overRate, under_rate:x.underRate, draw_rate:x.drawRate, home_win_rate:x.homeWinRate, home_away_diff:x.homeAwayDiff, season_phase:x.seasonPhase, data_status:x.dataStatus, updated_at:x.updatedAt }));
}
