// Display freshness uses the original source clock, never the publication clock.
export function assessSnapshot(data, now = Date.now()) {
    if (data?.stale === true || (data?.status && data.status !== 'ok')) {
        return { fresh: false, label: '数据不可用，仅显示历史参考' };
    }
    const source = data?.source_updated_at;
    const stamp = typeof source === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(source)
        ? Date.parse(source) : NaN;
    const age = (now - stamp) / 1000;
    if (!Number.isFinite(age) || age < -300) {
        return { fresh: false, label: '来源时间无法核验，仅显示历史参考' };
    }
    if (age > 1800) {
        return { fresh: false, label: '数据已过期，仅显示历史参考' };
    }
    return { fresh: true, label: '近期来源观察，不代表正式认证' };
}
