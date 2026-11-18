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
