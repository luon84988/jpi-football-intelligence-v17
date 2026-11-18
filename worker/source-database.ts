export const SOURCE_REGISTRY=[
 {code:"sporttery",name:"中国竞彩网（中国体育彩票）",role:"T0官方主源：竞彩场次与销售状态",priority:100,free:true,keyEnv:null,refreshMinutes:5},
 {code:"lottery_gov",name:"国家体育总局彩票管理中心",role:"T0治理源：彩票政策、公告与官方口径核验",priority:98,free:true,keyEnv:null,refreshMinutes:60},
 {code:"500",name:"500彩票网",role:"T1国内交叉源：场次与销售状态；不得证明官方停售",priority:85,free:true,keyEnv:null,refreshMinutes:5},
 {code:"okooo",name:"澳客",role:"T1国内交叉源：赛程与赛果复核；不得覆盖官方源",priority:85,free:true,keyEnv:null,refreshMinutes:5},
 {code:"zgzcw",name:"中国足彩网",role:"T2国内观察源：平台销售页；平台截止不等于官方停售",priority:70,free:true,keyEnv:null,refreshMinutes:10},
 {code:"espn",name:"ESPN Public Scoreboard",role:"国际赛程降级源",priority:40,free:true,keyEnv:null,refreshMinutes:15},
 {code:"thesportsdb",name:"TheSportsDB",role:"国际赛程二级降级源",priority:30,free:true,keyEnv:null,refreshMinutes:60},
] as const;

export async function ensureSourceDatabase(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS data_sources (code TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,priority INTEGER NOT NULL,free_tier INTEGER NOT NULL,key_env TEXT,refresh_minutes INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS source_health (source_code TEXT PRIMARY KEY,status TEXT NOT NULL,last_attempt_at TEXT,last_success_at TEXT,last_error TEXT,records_received INTEGER NOT NULL DEFAULT 0,quota_remaining INTEGER,FOREIGN KEY(source_code) REFERENCES data_sources(code))`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS source_events (source_code TEXT NOT NULL,source_event_id TEXT NOT NULL,start_time TEXT,league TEXT,home_team TEXT,away_team TEXT,canonical_match_id TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(source_code,source_event_id))`).run();
 await db.batch(SOURCE_REGISTRY.map(x=>db.prepare(`INSERT INTO data_sources(code,name,role,priority,free_tier,key_env,refresh_minutes,enabled) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(code) DO UPDATE SET name=excluded.name,role=excluded.role,priority=excluded.priority,free_tier=excluded.free_tier,key_env=excluded.key_env,refresh_minutes=excluded.refresh_minutes`).bind(x.code,x.name,x.role,x.priority,x.free?1:0,x.keyEnv,x.refreshMinutes)));
 return (await db.prepare(`SELECT s.*,h.status,h.last_attempt_at,h.last_success_at,h.last_error,h.records_received,h.quota_remaining FROM data_sources s LEFT JOIN source_health h ON h.source_code=s.code WHERE s.code IN (${SOURCE_REGISTRY.map(() => "?").join(",")}) ORDER BY s.priority DESC`).bind(...SOURCE_REGISTRY.map(source => source.code)).all()).results||[];
}
