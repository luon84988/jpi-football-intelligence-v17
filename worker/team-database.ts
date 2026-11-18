import { SPORTTERY_SNAPSHOT } from "./sporttery-snapshot";
const teams = new Map<string, { name: string; league: string }>();
for (const fixture of SPORTTERY_SNAPSHOT) {
  for (const name of [fixture.home, fixture.away]) {
    if (!teams.has(name)) teams.set(name, { name, league: fixture.league });
  }
}

const SEED_UPDATED_AT = "2026-08-22T00:00:00+08:00";
export async function ensureTeamDatabase(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS team_rankings (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,league TEXT NOT NULL,country TEXT,official_rank INTEGER,system_rank INTEGER,points REAL,played INTEGER,data_status TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();await db.prepare(`CREATE TABLE IF NOT EXISTS team_strength (id INTEGER PRIMARY KEY AUTOINCREMENT,team_name TEXT NOT NULL UNIQUE,attack_rating REAL,defense_rating REAL,home_rating REAL,away_rating REAL,form_rating REAL,market_rating REAL,sample_size INTEGER DEFAULT 0,data_status TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();await db.prepare(`CREATE TABLE IF NOT EXISTS player_dynamics (id INTEGER PRIMARY KEY AUTOINCREMENT,player_name TEXT NOT NULL,team_name TEXT NOT NULL,position TEXT,elite_level TEXT,status TEXT NOT NULL,injury TEXT,suspension TEXT,expected_return TEXT,start_probability REAL,impact_level TEXT,source TEXT,source_updated_at TEXT,updated_at TEXT NOT NULL,UNIQUE(player_name,team_name))`).run();await db.batch([...teams.values()].map(({name, league}) => db.prepare(
  "INSERT OR IGNORE INTO team_rankings (name,league,data_status,updated_at) VALUES (?,?,?,?)"
).bind(name,league,"identity_only",SEED_UPDATED_AT)));
return {
  rankings: (await db.prepare(`SELECT id,name,league,country,official_rank,
    CASE WHEN data_status='market_proxy' THEN NULL ELSE system_rank END AS system_rank,
    points,played,CASE WHEN data_status='market_proxy' THEN 'identity_only' ELSE data_status END AS data_status,
    updated_at FROM team_rankings ORDER BY system_rank NULLS LAST,name`).all()).results || [],
  strengths: (await db.prepare(`SELECT team_name,attack_rating,defense_rating,home_rating,away_rating,
    form_rating,sample_size,data_status,updated_at FROM team_strength WHERE data_status != 'market_proxy'
    ORDER BY team_name`).all()).results || [],
  players: (await db.prepare("SELECT * FROM player_dynamics ORDER BY impact_level DESC,player_name").all()).results || [],
};
}
export const seedTeamData = () => ({
  rankings: [...teams.values()].map((team, index) => ({
    ...team, id: index + 1, country: null, official_rank: null, system_rank: null,
    points: null, played: null, data_status: "identity_only", updated_at: SEED_UPDATED_AT,
  })),
  strengths: [],
  players: [],
});
