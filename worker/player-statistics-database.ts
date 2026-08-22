export async function getPlayerStatistics(db: D1Database, url: URL) {
  const conditions: string[] = []
  const bindings: unknown[] = []
  const filters: Array<[string, string]> = [
    ['playerId', 'player_id'], ['teamId', 'team_id'], ['leagueId', 'league_id'], ['season', 'league_season'],
  ]
  for (const [parameter, column] of filters) {
    const value = url.searchParams.get(parameter)
    if (value) { conditions.push(`${column}=?`); bindings.push(Number(value)) }
  }
  const search = url.searchParams.get('search')?.trim()
  if (search) { conditions.push(`(player_name LIKE ? OR team_name LIKE ? OR league_name LIKE ?)`); bindings.push(`%${search}%`, `%${search}%`, `%${search}%`) }
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)))
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await db.prepare(`SELECT * FROM player_statistics ${where} ORDER BY league_season DESC,COALESCE(rating,0) DESC,minutes DESC LIMIT ?`).bind(...bindings, limit).all()
  const summary = await db.prepare(`SELECT COUNT(*) records,COUNT(DISTINCT player_id) players,COUNT(DISTINCT team_id) teams,COUNT(DISTINCT league_id) leagues,MIN(league_season) first_season,MAX(league_season) last_season FROM player_statistics ${where}`).bind(...bindings).first()
  return { statistics: rows.results || [], summary: summary || {}, limit, source: 'imported_csv' }
}
