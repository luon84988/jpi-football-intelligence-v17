import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const [inputArg, outputArg = 'drizzle/0002_player_statistics.sql'] = process.argv.slice(2)
if (!inputArg) throw new Error('Usage: node scripts/import-player-statistics.mjs <input.csv> [output.sql]')

function parseDelimited(text, delimiter = ';') {
  const rows = []; let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted }
    else if (ch === delimiter && !quoted) { row.push(field); field = '' }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(v => v !== '')) rows.push(row); row = [] }
    else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const expected = ['Id','Name','Firstname','Lastname','Age','Birth date','Birth place','Birth country','Nationality','Height','Weight','Injured','Photo','Team id','Team name','Team logo','League id','League name','League country','League logo','League flag','League season','Games appearences','Games lineups','Games minutes','Games number','Games position','Games rating','Games captain','Substitutes in','Substitutes out','Substitutes bench','Shots total','Shots on','Goals total','Goals conceded','Goals assists','Goals saves','Passes total','Passes key','Passes accuracy','Tackles total','Tackles blocks','Tackles interceptions','Duels total','Duels won','Dribbles attempts','Dribbles success','Dribbles past','Fouls drawn','Fouls committed','Cards yellow','Cards yellowred','Cards red','Penalty won','Penalty commited','Penalty scored','Penalty missed','Penalty saved']
const matrix = parseDelimited((await readFile(resolve(inputArg), 'utf8')).replace(/^\uFEFF/, ''))
const headers = matrix.shift()
if (headers.length !== expected.length || expected.some((name, i) => headers[i] !== name)) throw new Error(`Unexpected CSV schema: expected ${expected.length} exact columns, received ${headers.length}`)
const objects = matrix.map((values, rowIndex) => ({ ...Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])), __sourceRow: rowIndex + 2 }))
const unique = new Map()
for (const row of objects) {
  const key = [row.Id, row['Team id'], row['League id'], row['League season']].join('|')
  if (!unique.has(key)) unique.set(key, row)
  else if (JSON.stringify({ ...unique.get(key), __sourceRow: 0 }) !== JSON.stringify({ ...row, __sourceRow: 0 })) throw new Error(`Conflicting duplicate key at row ${row.__sourceRow}: ${key}`)
}

const columns = [
 ['player_id','Id','int'],['player_name','Name','text'],['first_name','Firstname','text'],['last_name','Lastname','text'],['age','Age','int'],['birth_date','Birth date','text'],['birth_place','Birth place','text'],['birth_country','Birth country','text'],['nationality','Nationality','text'],['height_cm','Height','measure'],['weight_kg','Weight','measure'],['injured','Injured','bool'],['photo_url','Photo','text'],['team_id','Team id','int'],['team_name','Team name','text'],['team_logo_url','Team logo','text'],['league_id','League id','int'],['league_name','League name','text'],['league_country','League country','text'],['league_logo_url','League logo','text'],['league_flag_url','League flag','text'],['league_season','League season','int'],['appearances','Games appearences','int'],['lineups','Games lineups','int'],['minutes','Games minutes','int'],['shirt_number','Games number','int'],['position','Games position','text'],['rating','Games rating','real'],['captain','Games captain','bool'],['substitutes_in','Substitutes in','int'],['substitutes_out','Substitutes out','int'],['substitutes_bench','Substitutes bench','int'],['shots_total','Shots total','int'],['shots_on','Shots on','int'],['goals_total','Goals total','int'],['goals_conceded','Goals conceded','int'],['goals_assists','Goals assists','int'],['goals_saves','Goals saves','int'],['passes_total','Passes total','int'],['passes_key','Passes key','int'],['passes_accuracy','Passes accuracy','real'],['tackles_total','Tackles total','int'],['tackles_blocks','Tackles blocks','int'],['tackles_interceptions','Tackles interceptions','int'],['duels_total','Duels total','int'],['duels_won','Duels won','int'],['dribbles_attempts','Dribbles attempts','int'],['dribbles_success','Dribbles success','int'],['dribbles_past','Dribbles past','int'],['fouls_drawn','Fouls drawn','int'],['fouls_committed','Fouls committed','int'],['cards_yellow','Cards yellow','int'],['cards_yellow_red','Cards yellowred','int'],['cards_red','Cards red','int'],['penalty_won','Penalty won','int'],['penalty_committed','Penalty commited','int'],['penalty_scored','Penalty scored','int'],['penalty_missed','Penalty missed','int'],['penalty_saved','Penalty saved','int']
]
const sqlText = value => value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
const sqlValue = (value, kind) => {
  if (kind === 'text') return sqlText(value)
  if (kind === 'bool') return value === '' ? 'NULL' : /^(true|1|yes)$/i.test(value) ? '1' : '0'
  if (value === '') return 'NULL'
  const number = Number(kind === 'measure' ? String(value).replace(/[^0-9.+-]/g, '') : value)
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric value: ${value}`)
  return String(number)
}
const ddl = `CREATE TABLE IF NOT EXISTS player_statistics (\n  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,\n${columns.map(([name,,kind]) => `  ${name} ${kind === 'text' ? 'TEXT' : kind === 'real' ? 'REAL' : 'INTEGER'}`).join(',\n')},\n  source_file TEXT NOT NULL,\n  source_row INTEGER NOT NULL,\n  imported_at TEXT NOT NULL,\n  UNIQUE(player_id, team_id, league_id, league_season)\n);\nCREATE INDEX IF NOT EXISTS player_statistics_player_idx ON player_statistics(player_id);\nCREATE INDEX IF NOT EXISTS player_statistics_team_idx ON player_statistics(team_id, league_season);\nCREATE INDEX IF NOT EXISTS player_statistics_league_idx ON player_statistics(league_id, league_season);\n`
const sourceFile = basename(inputArg), importedAt = new Date().toISOString()
const inserts = [...unique.values()].map(row => {
  const names = [...columns.map(([name]) => name), 'source_file', 'source_row', 'imported_at']
  const values = [...columns.map(([,source,kind]) => sqlValue(row[source], kind)), sqlText(sourceFile), String(row.__sourceRow), sqlText(importedAt)]
  return `INSERT INTO player_statistics (${names.join(',')}) VALUES (${values.join(',')}) ON CONFLICT(player_id,team_id,league_id,league_season) DO UPDATE SET ${names.slice(1).map(name => `${name}=excluded.${name}`).join(',')};`
}).join('\n')
await writeFile(resolve(outputArg), `${ddl}\n${inserts}\n`, 'utf8')
console.log(JSON.stringify({ inputRows: objects.length, importedRows: unique.size, duplicatesRemoved: objects.length - unique.size, columns: columns.length, output: resolve(outputArg) }))
