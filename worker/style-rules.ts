export type StyleKey = "控球压迫" | "高位逼抢" | "低位反击" | "快速转换" | "直接对抗" | "低节奏防守" | "均衡";

type LeagueStyle = { tempo: number; physical: number; press: number; transition: number; defaultStyle: StyleKey; note: string };
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
};

const RULES = [
  { id: "SC-01", attacker: "高位逼抢", defender: "控球压迫", home: .07, away: -.04, text: "高位逼抢克制后场控球出球" },
  { id: "SC-02", attacker: "低位反击", defender: "控球压迫", home: .05, away: .08, text: "控球压上会释放反击纵深" },
  { id: "SC-03", attacker: "直接对抗", defender: "高位逼抢", home: .06, away: -.03, text: "直接越过第一道压迫可削弱逼抢收益" },
  { id: "SC-04", attacker: "快速转换", defender: "低节奏防守", home: -.05, away: -.05, text: "低位密集防守压缩转换空间" },
  { id: "SC-05", attacker: "控球压迫", defender: "直接对抗", home: .04, away: -.04, text: "持续控球可降低直接冲击次数" },
] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function analyzeStyleMatchup(league: string, probabilities: number[], handicap: number) {
  const leagueStyle = LEAGUE_STYLE_LIBRARY[league] || BASE;
  const strengthGap = (probabilities[0] || 0) - (probabilities[2] || 0);
  let homeStyle: StyleKey = leagueStyle.defaultStyle, awayStyle: StyleKey = leagueStyle.defaultStyle;
  if (strengthGap > .16 || handicap <= -1) { homeStyle = leagueStyle.press >= 70 ? "高位逼抢" : "控球压迫"; awayStyle = "低位反击"; }
  else if (strengthGap < -.16 || handicap >= 1) { homeStyle = "低位反击"; awayStyle = leagueStyle.transition >= 72 ? "快速转换" : "控球压迫"; }
  else if (leagueStyle.physical >= 74) { homeStyle = "直接对抗"; awayStyle = "直接对抗"; }
  let homeDelta = 0, awayDelta = 0;
  const hits: Array<{ id: string; text: string }> = [];
  for (const rule of RULES) {
    if (homeStyle === rule.attacker && awayStyle === rule.defender) { homeDelta += rule.home; awayDelta += rule.away; hits.push({ id: rule.id, text: rule.text }); }
    if (awayStyle === rule.attacker && homeStyle === rule.defender) { awayDelta += rule.home; homeDelta += rule.away; hits.push({ id: rule.id, text: rule.text }); }
  }
  if (leagueStyle.tempo >= 78) { homeDelta += .025; awayDelta += .025; hits.push({ id: "LB-01", text: "高节奏联赛提高双方进球环境" }); }
  if (leagueStyle.tempo <= 45) { homeDelta -= .035; awayDelta -= .035; hits.push({ id: "LB-02", text: "低节奏联赛压低双方进球环境" }); }
  homeDelta = clamp(homeDelta, -.10, .10); awayDelta = clamp(awayDelta, -.10, .10);
  return { leagueStyle: { league, ...leagueStyle }, homeStyle, awayStyle, adjustment: { home: Number(homeDelta.toFixed(3)), away: Number(awayDelta.toFixed(3)) }, rules: hits.length ? hits : [{ id: "SC-00", text: "未触发显著相克，采用联赛中性基线" }], evidence: "B-（联赛基线 + 赔率强弱代理；待接入球队事件数据升级）" };
}
