/** Honest source-state labels; never infer model accuracy from feed availability. */
export function describeFeedStatus({ count, live, timestamp }) {
  const validTimestamp = timestamp instanceof Date && Number.isFinite(timestamp.getTime());
  if (!Number.isInteger(count) || count < 1 || !validTimestamp) {
    return { headline: 'SOURCE UNAVAILABLE', source: '暂无可用竞彩数据', feed: '未连接' };
  }
  if (live) {
    return { headline: 'SOURCE CONNECTED', source: '已获取竞彩网数据（上游更新时间未验证）', feed: '已获取' };
  }
  return { headline: 'SOURCE CACHED', source: '历史缓存（非实时）', feed: '缓存' };
}
