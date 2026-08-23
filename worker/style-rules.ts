export type StyleKey = "控球压迫" | "高位逼抢" | "低位反击" | "快速转换" | "直接对抗" | "低节奏防守" | "均衡";

export type LeagueStyle = { tempo: number; physical: number; press: number; transition: number; defaultStyle: StyleKey; note: string };
export type TeamStrengthProfile = { attack_rating?: number | null; defense_rating?: number | null; home_rating?: number | null; away_rating?: number | null; form_rating?: number | null; market_rating?: number | null; sample_size?: number | null; data_status?: string | null };
type MatchupContext = { home?: TeamStrengthProfile | null; away?: TeamStrengthProfile | null; homeName?: string; awayName?: string };
const BASE: LeagueStyle = { tempo: 50, physical: 50, press: 50, transition: 50, defaultStyle: "均衡", note: "通用联赛中性基线" };

export const LEAGUE_STYLE_LIBRARY: Record<string, LeagueStyle> = {
  英超: { tempo: 82, physical: 78, press: 76, transition: 80, defaultStyle: "高位逼抢", note: "高节奏、高对抗、快速纵向转换" },
  英冠: { tempo: 76, physical: 84, press: 67, transition: 78, defaultStyle: "直接对抗", note: "直接进攻与二点球对抗占比高" },
  西甲: { tempo: 58, physical: 48, press: 62, transition: 56, defaultStyle: "控球压迫", note: "控球组织与阵地推进权重较高" },
  西乙: { tempo: 43, physical: 64, press: 48, transition: 44, defaultStyle: "低节奏防守", note: "低节奏、低比分与防守结构优先" },
  意甲: { tempo: 55, physical: 62, press: 58, transition: 62, defaultStyle: "低位反击", note: "战术针对性与攻防转换并重" },
  意乙: { tempo: 42, physical: 66, press: 45, transition: 48, defaultStyle: "低节奏防守", note: "谨慎推进、身体对抗与低比分倾向" },
  德甲: { tempo: 84, physical: 70, press: 82, transition: 85, defaultStyle: "快速转换", note: "高压迫、高转换与开放空间并存" },
  德乙: { tempo: 78, physical: 75, press: 70, transition: 82, defaultStyle: "快速转换", note: "纵向速度快，比赛波动通常较高" },
  法甲: { tempo: 66, physical: 77, press: 63, transition: 72, defaultStyle: "快速转换", note: "运动能力、对抗与转换速度突出" },
  法乙: { tempo: 45, physical: 76, press: 50, transition: 52, defaultStyle: "低节奏防守", note: "身体对抗强，整体进球环境偏谨慎" },
  荷甲: { tempo: 80, physical: 54, press: 75, transition: 76, defaultStyle: "控球压迫", note: "主动进攻、边路宽度与高位压迫" },
  葡超: { tempo: 57, physical: 62, press: 65, transition: 60, defaultStyle: "控球压迫", note: "强队控球压迫与弱队低位防守分化" },
  日职: { tempo: 70, physical: 48, press: 68, transition: 66, defaultStyle: "控球压迫", note: "技术流、整体移动与地面推进" },
  日乙: { tempo: 60, physical: 61, press: 58, transition: 62, defaultStyle: "均衡", note: "组织纪律与转换效率并重" },
  韩K职: { tempo: 65, physical: 80, press: 66, transition: 75, defaultStyle: "直接对抗", note: "高对抗、纵向冲击与快速转换" },
  欧冠: { tempo: 74, physical: 68, press: 74, transition: 72, defaultStyle: "控球压迫", note: "高质量控球与压迫，球队差异较大" },
  欧联: { tempo: 70, physical: 70, press: 68, transition: 74, defaultStyle: "快速转换", note: "跨联赛风格碰撞，转换波动较高" },
  欧协联: { tempo: 68, physical: 66, press: 65, transition: 72, defaultStyle: "快速转换", note: "跨联赛差异较大，转换与实力差放大波动" },
  英甲: { tempo: 74, physical: 82, press: 64, transition: 76, defaultStyle: "直接对抗", note: "直接打法、二点球和转换频率较高" },
  英乙: { tempo: 70, physical: 84, press: 60, transition: 72, defaultStyle: "直接对抗", note: "高对抗与直接进攻，比赛随机性较高" },
  苏超: { tempo: 72, physical: 80, press: 65, transition: 74, defaultStyle: "直接对抗", note: "纵向推进和身体对抗突出" },
  比甲: { tempo: 74, physical: 66, press: 70, transition: 76, defaultStyle: "快速转换", note: "开放度和转换速度偏高" },
  挪超: { tempo: 78, physical: 70, press: 68, transition: 80, defaultStyle: "快速转换", note: "纵向开放、转换快，进球环境偏积极" },
  瑞超: { tempo: 70, physical: 70, press: 64, transition: 72, defaultStyle: "快速转换", note: "攻防转换较快，整体开放度中高" },
  丹超: { tempo: 72, physical: 68, press: 70, transition: 74, defaultStyle: "高位逼抢", note: "主动压迫与快速转换并重" },
  奥甲: { tempo: 80, physical: 66, press: 78, transition: 82, defaultStyle: "高位逼抢", note: "高压迫和高转换使比赛更开放" },
  瑞士超: { tempo: 73, physical: 64, press: 68, transition: 76, defaultStyle: "快速转换", note: "节奏较快，攻防稳定性相对有限" },
  土超: { tempo: 62, physical: 72, press: 60, transition: 68, defaultStyle: "均衡", note: "对抗较强，强弱分层会影响比赛开放度" },
};

const RULES = [
  { id: "SC-01", attacker: "高位逼抢", defender: "控球压迫", attack: .065, concede: -.035, openness: .05, text: "高位逼抢可破坏后场组织，但身后空间会放大转换波动" },
  { id: "SC-02", attacker: "低位反击", defender: "控球压迫", attack: .075, concede: .025, openness: .07, text: "控球压上释放反击纵深，弱侧回防决定上限" },
  { id: "SC-03", attacker: "直接对抗", defender: "高位逼抢", attack: .055, concede: -.02, openness: .04, text: "直接越过第一道压迫，二点球质量决定收益" },
  { id: "SC-04", attacker: "快速转换", defender: "低节奏防守", attack: -.055, concede: -.025, openness: -.07, text: "低位密集防守压缩转换空间并降低比赛速度" },
  { id: "SC-05", attacker: "控球压迫", defender: "直接对抗", attack: .04, concede: -.035, openness: -.02, text: "持续控球可减少直接冲击次数，但需防定位球与二点球" },
  { id: "SC-06", attacker: "高位逼抢", defender: "低位反击", attack: -.025, concede: .055, openness: .06, text: "低位反击主动放弃出球，高压收益下降且身后风险上升" },
  { id: "SC-07", attacker: "控球压迫", defender: "低节奏防守", attack: -.035, concede: -.045, openness: -.08, text: "阵地控球面对低位密防，射门数量不等于高质量机会" },
  { id: "SC-08", attacker: "快速转换", defender: "高位逼抢", attack: .055, concede: .025, openness: .08, text: "双方争夺转换窗口，节奏与失误率同步上升" },
  { id: "SC-09", attacker: "直接对抗", defender: "低节奏防守", attack: -.035, concede: -.03, openness: -.05, text: "双方均压缩中场组织，进攻质量依赖定位球" },
] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const rating = (value: unknown, fallback = 50) => finite(value) ? clamp(value, 0, 100) : fallback;
const rounded = (value: number, digits = 0) => Number(value.toFixed(digits));
const inferStyle = (s: LeagueStyle, gap: number, handicap: number, side: "home" | "away") => {
  const favourite = side === "home" ? gap > .12 || handicap <= -.75 : gap < -.12 || handicap >= .75;
  const underdog = side === "home" ? gap < -.12 || handicap >= .75 : gap > .12 || handicap <= -.75;
  if (favourite) return s.press >= 72 ? "高位逼抢" : s.transition >= 76 ? "快速转换" : "控球压迫";
  if (underdog) return s.tempo <= 50 ? "低节奏防守" : "低位反击";
  return s.physical >= 76 ? "直接对抗" : s.defaultStyle;
};
const buildTeamVector = (profile: TeamStrengthProfile | null | undefined, marketFallback: number, venue: "home" | "away") => {
  const venueKey = venue === "home" ? "home_rating" : "away_rating";
  const present = ["attack_rating", "defense_rating", venueKey, "form_rating", "market_rating"].filter(key => finite(profile?.[key as keyof TeamStrengthProfile])).length;
  const sample = finite(profile?.sample_size) ? Math.max(0, profile.sample_size) : 0;
  const reliability = clamp((present / 5) * .72 + clamp(Math.log10(sample + 1) / 2, 0, 1) * .28, .12, 1);
  const attack = rating(profile?.attack_rating), defense = rating(profile?.defense_rating), venueRating = rating(profile?.[venueKey]);
  const form = rating(profile?.form_rating), market = rating(profile?.market_rating, marketFallback);
  const composite = attack * .27 + defense * .27 + venueRating * .16 + form * .16 + market * .14;
  return { attack, defense, venue: venueRating, form, market, composite: rounded(composite, 1), reliability: rounded(reliability, 2), present, sampleSize: sample, status: profile?.data_status || "market_proxy" };
};

export function analyzeStyleMatchup(league: string, probabilities: number[], handicap: number, storedProfile?: Partial<LeagueStyle>, matchup: MatchupContext = {}) {
  const leagueStyle = { ...(LEAGUE_STYLE_LIBRARY[league] || BASE), ...(storedProfile || {}) } as LeagueStyle;
  const marketGap = (probabilities[0] || 0) - (probabilities[2] || 0);
  const home = buildTeamVector(matchup.home, (probabilities[0] || .5) * 100, "home"), away = buildTeamVector(matchup.away, (probabilities[2] || .5) * 100, "away");
  const dataCoverage = rounded((home.present + away.present) / 10 * 100), evidenceReliability = clamp((home.reliability + away.reliability) / 2, .12, 1);
  const teamGap = (home.composite - away.composite) / 100;
  const strengthGap = clamp(marketGap * (1 - evidenceReliability * .55) + teamGap * evidenceReliability * .55, -.75, .75);
  const homeStyle = inferStyle(leagueStyle, strengthGap, handicap, "home") as StyleKey, awayStyle = inferStyle(leagueStyle, strengthGap, handicap, "away") as StyleKey;
  const homeAttackEdge = (home.attack - away.defense) / 100, awayAttackEdge = (away.attack - home.defense) / 100;
  const venueEdge = (home.venue - away.venue) / 100, formEdge = (home.form - away.form) / 100;
  let homeDelta = homeAttackEdge * .16 + venueEdge * .06 + formEdge * .04, awayDelta = awayAttackEdge * .16 - venueEdge * .035 - formEdge * .04, opennessDelta = 0;
  const hits: Array<{ id: string; text: string; impact: "主队" | "客队" | "双方" }> = [];
  for (const rule of RULES) {
    if (homeStyle === rule.attacker && awayStyle === rule.defender) { homeDelta += rule.attack; awayDelta += rule.concede; opennessDelta += rule.openness; hits.push({ id: rule.id, text: rule.text, impact: "主队" }); }
    if (awayStyle === rule.attacker && homeStyle === rule.defender) { awayDelta += rule.attack; homeDelta += rule.concede; opennessDelta += rule.openness; hits.push({ id: rule.id, text: rule.text, impact: "客队" }); }
  }
  if (leagueStyle.tempo >= 78) { homeDelta += .02; awayDelta += .02; opennessDelta += .06; hits.push({ id: "LB-01", text: "高节奏联赛基线提高攻防回合数", impact: "双方" }); }
  if (leagueStyle.tempo <= 45) { homeDelta -= .03; awayDelta -= .03; opennessDelta -= .07; hits.push({ id: "LB-02", text: "低节奏联赛基线压低有效进攻回合", impact: "双方" }); }
  const confidenceScale = .45 + evidenceReliability * .55;
  homeDelta = clamp(homeDelta * confidenceScale, -.11, .11); awayDelta = clamp(awayDelta * confidenceScale, -.11, .11);
  const attackBalance = Math.abs(homeAttackEdge - awayAttackEdge);
  const overIndex = clamp(leagueStyle.tempo * .29 + leagueStyle.transition * .25 + leagueStyle.press * .13 + (100 - leagueStyle.physical) * .06 + 13 + (homeAttackEdge + awayAttackEdge) * 18 + opennessDelta * 22, 18, 82);
  const underIndex = 100 - overIndex;
  const drawIndex = clamp(60 - Math.abs(strengthGap) * 58 - attackBalance * 18 - Math.abs(handicap) * 8 + (100 - leagueStyle.tempo) * .12 - opennessDelta * 22, 15, 78);
  const level = (value: number) => value >= 66 ? "高" : value >= 52 ? "中" : "低";
  const drawLevel = drawIndex >= 66 ? "强预警" : drawIndex >= 55 ? "中度" : drawIndex >= 44 ? "轻度" : "无";
  const gapPoints = rounded(home.composite - away.composite, 1), advantage = Math.abs(gapPoints) < 3 ? "实力接近" : gapPoints > 0 ? "主队基础面占优" : "客队基础面占优";
  const grade = dataCoverage >= 80 && evidenceReliability >= .7 ? "A" : dataCoverage >= 50 && evidenceReliability >= .45 ? "B" : "C";
  const counterEvidence: string[] = [];
  if (Math.sign(teamGap) && Math.sign(marketGap) && Math.sign(teamGap) !== Math.sign(marketGap)) counterEvidence.push("球队实力向量与去水市场方向相反");
  if (Math.sign(homeAttackEdge - awayAttackEdge) !== Math.sign(strengthGap) && Math.abs(homeAttackEdge - awayAttackEdge) > .05) counterEvidence.push("攻防交叉优势与综合强弱方向不一致");
  if (!counterEvidence.length) counterEvidence.push("暂未发现足以反转主方向的结构性反证");
  return {
    version: "CORE-STRENGTH-2.0", leagueStyle: { league, ...leagueStyle }, homeStyle, awayStyle,
    adjustment: { home: rounded(homeDelta, 3), away: rounded(awayDelta, 3) },
    rules: hits.length ? hits : [{ id: "SC-00", text: "未触发显著相克，采用攻防交叉与联赛中性基线", impact: "双方" as const }],
    strength: { home: { name: matchup.homeName || "主队", ...home }, away: { name: matchup.awayName || "客队", ...away }, gap: gapPoints, verdict: advantage, attackEdges: { home: rounded(homeAttackEdge * 100, 1), away: rounded(awayAttackEdge * 100, 1) }, dataCoverage, reliability: rounded(evidenceReliability * 100) },
    evidenceFusion: {
      primary: [`${advantage}（综合差 ${gapPoints > 0 ? "+" : ""}${gapPoints}）`, `主攻×客防 ${rounded(homeAttackEdge * 100, 1)} / 客攻×主防 ${rounded(awayAttackEdge * 100, 1)}`, `${homeStyle} VS ${awayStyle}`],
      counter: counterEvidence,
      risk: [dataCoverage < 50 ? `球队字段覆盖仅 ${dataCoverage}%，结论按预分析降级` : `球队字段覆盖 ${dataCoverage}%`, Math.abs(marketGap) < .08 ? "去水胜负差较窄，平局与临场漂移敏感" : "市场强弱差已形成，但仍需首发与战意复核", "本模块不替代首发、伤停、战意与赛程轮换引擎"],
    },
    tendency: { primary: overIndex >= 52 ? "大比分" : "小比分", over: { index: Math.round(overIndex), level: level(overIndex) }, under: { index: Math.round(underIndex), level: level(underIndex) }, draw: { index: Math.round(drawIndex), level: drawLevel }, basis: "大/小球为互补环境指数；平局为独立风险预警，不与大小球互斥" },
    evidence: `${grade}级（球队字段 ${dataCoverage}% · 证据可靠度 ${rounded(evidenceReliability * 100)}%）`, formal: grade !== "C",
  };
}