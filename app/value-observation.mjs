/**
 * Market-only observations are not model predictions.
 *
 * Do not compute expected value or edge from PDI, a de-vigged market
 * probability, or an unverified score-model fit. Formal EV calculations
 * require a separately calibrated, independently sourced model contract.
 */
export function makeValueObservation(match) {
  const odds = Array.isArray(match.odds) && match.odds.length === 3
    ? match.odds.map(Number) : [];
  const validOdds = odds.length === 3 && odds.every(o => Number.isFinite(o) && o > 1);
  const inverse = validOdds ? odds.map(o => 1 / o) : [];
  const total = inverse.reduce((sum, v) => sum + v, 0);
  const market = total > 0 ? inverse.map(v => v / total) : [null, null, null];
  const index = match.signal?.includes('客') ? 2 : match.signal?.includes('平') ? 1 : 0;
  const price = validOdds ? odds[index] : null;
  return {
    ...match,
    marketName: ['主胜', '平局', '客胜'][index],
    price,
    model: null,
    marketP: market[index],
    breakEven: price == null ? null : 1 / price,
    ev: null,
    edge: null,
    status: 'WATCH',
    grade: 'WATCH',
    gaps: [
      '独立且已校准的模型概率缺失',
      ...(!validOdds ? ['三项有效赔率缺失'] : []),
      '博彩公司不足3家',
      '校准样本不足500场',
      '缺少收盘价/CLV'
    ]
  };
}
