export type OutcomeProbabilities = { home: number; draw: number; away: number };

export type IndependentEvidence = {
  homeAttack: number;
  homeDefence: number;
  awayAttack: number;
  awayDefence: number;
  leagueHomeGoals: number;
  leagueAwayGoals: number;
  homeSample: number;
  awaySample: number;
  observedAt: string;
  lineupHomeDelta?: number;
  lineupAwayDelta?: number;
  scheduleHomeDelta?: number;
  scheduleAwayDelta?: number;
};

export type HybridInput = {
  marketOdds?: [number, number, number];
  marketObservedAt?: string;
  independent?: IndependentEvidence;
  calibration?: { temperature: number; sampleSize: number; version: string };
  now?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

export function fairProbabilities(odds: number[]): OutcomeProbabilities | null {
  if (odds.length !== 3 || !odds.every(value => Number.isFinite(value) && value > 1)) return null;
  const inverse = odds.map(value => 1 / value);
  const overround = inverse.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(overround) || overround <= 0) return null;
  return { home: inverse[0] / overround, draw: inverse[1] / overround, away: inverse[2] / overround };
}

const poisson = (goals: number, lambda: number) => {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
};

function dixonColesTau(homeGoals: number, awayGoals: number, homeLambda: number, awayLambda: number, rho: number) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeLambda * awayLambda * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeLambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayLambda * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

export function dixonColesMatrix(homeLambda: number, awayLambda: number, rho = -0.08, maxGoals = 7) {
  const cells: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      const probability = poisson(homeGoals, homeLambda) * poisson(awayGoals, awayLambda)
        * dixonColesTau(homeGoals, awayGoals, homeLambda, awayLambda, rho);
      cells.push({ homeGoals, awayGoals, probability: Math.max(0, probability) });
    }
  }
  const mass = cells.reduce((sum, cell) => sum + cell.probability, 0);
  const normalized = cells.map(cell => ({ ...cell, probability: cell.probability / mass }));
  const probabilities = normalized.reduce((result, cell) => {
    if (cell.homeGoals > cell.awayGoals) result.home += cell.probability;
    else if (cell.homeGoals === cell.awayGoals) result.draw += cell.probability;
    else result.away += cell.probability;
    if (cell.homeGoals + cell.awayGoals > 2) result.over25 += cell.probability;
    if (cell.homeGoals > 0 && cell.awayGoals > 0) result.btts += cell.probability;
    return result;
  }, { home: 0, draw: 0, away: 0, over25: 0, btts: 0 });
  const topScores = [...normalized]
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 3)
    .map(cell => ({ score: `${cell.homeGoals}–${cell.awayGoals}`, probability: round(cell.probability) }));
  return {
    homeLambda: round(homeLambda, 3),
    awayLambda: round(awayLambda, 3),
    rho,
    probabilities: {
      home: round(probabilities.home), draw: round(probabilities.draw), away: round(probabilities.away),
      over25: round(probabilities.over25), under25: round(1 - probabilities.over25),
      bttsYes: round(probabilities.btts), bttsNo: round(1 - probabilities.btts),
    },
    topScores,
  };
}

function fundamentalProjection(evidence: IndependentEvidence) {
  const lineupHome = clamp(evidence.lineupHomeDelta || 0, -0.18, 0.18);
  const lineupAway = clamp(evidence.lineupAwayDelta || 0, -0.18, 0.18);
  const scheduleHome = clamp(evidence.scheduleHomeDelta || 0, -0.10, 0.10);
  const scheduleAway = clamp(evidence.scheduleAwayDelta || 0, -0.10, 0.10);
  const homeLambda = clamp(
    evidence.leagueHomeGoals * Math.sqrt(evidence.homeAttack * evidence.awayDefence)
      * Math.exp(lineupHome + scheduleHome),
    0.15,
    4.5,
  );
  const awayLambda = clamp(
    evidence.leagueAwayGoals * Math.sqrt(evidence.awayAttack * evidence.homeDefence)
      * Math.exp(lineupAway + scheduleAway),
    0.15,
    4.5,
  );
  return dixonColesMatrix(homeLambda, awayLambda);
}

function normalize(probabilities: OutcomeProbabilities): OutcomeProbabilities {
  const total = probabilities.home + probabilities.draw + probabilities.away;
  return { home: probabilities.home / total, draw: probabilities.draw / total, away: probabilities.away / total };
}

function logOpinionPool(fundamental: OutcomeProbabilities, market: OutcomeProbabilities, fundamentalWeight = 0.45) {
  const marketWeight = 1 - fundamentalWeight;
  return normalize({
    home: Math.pow(fundamental.home, fundamentalWeight) * Math.pow(market.home, marketWeight),
    draw: Math.pow(fundamental.draw, fundamentalWeight) * Math.pow(market.draw, marketWeight),
    away: Math.pow(fundamental.away, fundamentalWeight) * Math.pow(market.away, marketWeight),
  });
}

function temperatureCalibrate(probabilities: OutcomeProbabilities, temperature: number) {
  const safeTemperature = clamp(temperature, 0.6, 1.8);
  return normalize({
    home: Math.pow(probabilities.home, 1 / safeTemperature),
    draw: Math.pow(probabilities.draw, 1 / safeTemperature),
    away: Math.pow(probabilities.away, 1 / safeTemperature),
  });
}

function ageMinutes(observedAt: string | undefined, now: string) {
  if (!observedAt) return null;
  const value = (Date.parse(now) - Date.parse(observedAt)) / 60000;
  return Number.isFinite(value) ? value : null;
}

export function evaluateHybrid(input: HybridInput) {
  const now = input.now || new Date().toISOString();
  const market = input.marketOdds ? fairProbabilities(input.marketOdds) : null;
  const blockers: string[] = [];
  const marketAge = ageMinutes(input.marketObservedAt, now);
  const independentAge = ageMinutes(input.independent?.observedAt, now);
  if (!market) blockers.push("HYB-001_MARKET_FAIR_PROBABILITY_MISSING");
  if (marketAge === null || marketAge > 30 || marketAge < -5) blockers.push("HYB-002_MARKET_SNAPSHOT_STALE_OR_INVALID");
  if (!input.independent) blockers.push("HYB-003_INDEPENDENT_TEAM_MODEL_MISSING");
  if (input.independent && (input.independent.homeSample < 6 || input.independent.awaySample < 6)) blockers.push("HYB-004_L6_SAMPLE_INSUFFICIENT");
  if (independentAge === null || independentAge > 24 * 60 || independentAge < -5) blockers.push("HYB-005_FUNDAMENTAL_SNAPSHOT_STALE_OR_INVALID");

  if (blockers.length || !market || !input.independent) {
    return {
      version: "18.0.0-shadow",
      status: "ABSTAIN",
      decisionAllowed: false,
      certification: "DQ-C",
      blockers,
      marketProbability: market,
      fundamentalProbability: null,
      blendedProbability: null,
      dvi: null,
      pdi: null,
      calibrationApplied: false,
      note: "市场隐含概率只作基线；缺少独立基本面证据时禁止融合、EV、凯利和正式推荐。",
    };
  }

  const fundamental = fundamentalProjection(input.independent);
  const fundamentalProbability: OutcomeProbabilities = {
    home: fundamental.probabilities.home,
    draw: fundamental.probabilities.draw,
    away: fundamental.probabilities.away,
  };
  let blended = logOpinionPool(fundamentalProbability, market);
  const calibrationApplied = Boolean(input.calibration && input.calibration.sampleSize >= 200);
  if (calibrationApplied && input.calibration) blended = temperatureCalibrate(blended, input.calibration.temperature);
  const dvi = blended.draw - market.draw;
  const pdi = Math.max(blended.home, blended.draw, blended.away);
  return {
    version: "18.0.0-shadow",
    status: "SHADOW_ONLY",
    decisionAllowed: false,
    certification: "DQ-B",
    blockers: calibrationApplied ? [] : ["HYB-006_CALIBRATION_SAMPLE_BELOW_200"],
    marketProbability: Object.fromEntries(Object.entries(market).map(([key, value]) => [key, round(value)])),
    fundamentalProbability: Object.fromEntries(Object.entries(fundamentalProbability).map(([key, value]) => [key, round(value)])),
    blendedProbability: Object.fromEntries(Object.entries(blended).map(([key, value]) => [key, round(value)])),
    dvi: round(dvi),
    pdi: round(pdi),
    scoreModel: fundamental,
    calibrationApplied,
    note: "挑战者输出仅进入影子回测；通过滚动样本、校准和分联赛稳健性门禁前不得影响冠军模型。",
  };
}

export const HYBRID_ENGINE_SPEC = {
  systemVersion: "18.0.0",
  releasedAt: "2026-08-24",
  champion: { version: "17.1.0", status: "ACTIVE", role: "市场隐含基线与既有审计链" },
  challenger: { version: "18.0.0-shadow", status: "SHADOW_ONLY", role: "独立动态Dixon–Coles基本面 + 市场公平概率融合" },
  antiCircularity: [
    "赔率反推xG只能标记为市场隐含xG，不得作为独立基本面证据",
    "DVI/PDI、EV和凯利必须位于融合输出下游，不得回灌训练标签",
    "同一赔率源不得同时作为模型输入和独立验证真值",
  ],
  fusion: {
    method: "logarithmic opinion pool",
    provisionalWeights: { fundamental: 0.45, market: 0.55 },
    weightStatus: "UNTRAINED_CHALLENGER_WEIGHTS",
    calibration: "temperature scaling；仅滚动样本>=200时允许启用",
  },
  promotionGates: [
    { code: "PG-001", requirement: "滚动、严格时间切分的赛外样本 >= 200" },
    { code: "PG-002", requirement: "Brier Score与Log Loss均不劣于冠军，至少一项显著改善" },
    { code: "PG-003", requirement: "ECE <= 0.05，且无主要联赛分层显著退化" },
    { code: "PG-004", requirement: "正式决策样本满足AC-008、时间冻结、首发/伤停和DQ门禁" },
    { code: "PG-005", requirement: "人工审批、版本固化、可一键回滚" },
  ],
  productionReadiness: {
    status: "BLOCKED",
    blockers: [
      "独立球队事件/xG数据源尚未完成生产绑定",
      "Odds-API.io目标博彩公司选择/套餐返回403，尚无四公司实时报价入库",
      "暂无>=200场挑战者滚动赛外校准样本",
    ],
  },
  metrics: ["Brier Score", "Log Loss", "ECE", "CLV", "ROI", "Max Drawdown", "分联赛覆盖率与拒绝率"],
  accuracyPolicy: "80%命中率只保留为特定分层治理告警，不作为全量1X2普适目标或晋级条件。",
};
