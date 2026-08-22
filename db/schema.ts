import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const leagueProfiles = sqliteTable("league_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  country: text("country").notNull(),
  level: text("level").notNull(),
  groupName: text("group_name").notNull(),
  style: text("style").notNull(),
  tempo: real("tempo").notNull(),
  physical: real("physical").notNull(),
  press: real("press").notNull(),
  transition: real("transition").notNull(),
  styleNote: text("style_note"),
  avgGoals: real("avg_goals"),
  overRate: real("over_rate"),
  underRate: real("under_rate"),
  drawRate: real("draw_rate"),
  homeWinRate: real("home_win_rate"),
  homeAwayDiff: real("home_away_diff"),
  seasonPhase: text("season_phase").notNull(),
  dataStatus: text("data_status").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const teamRankings=sqliteTable("team_rankings",{id:integer("id").primaryKey({autoIncrement:true}),name:text("name").notNull().unique(),league:text("league").notNull(),country:text("country"),officialRank:integer("official_rank"),systemRank:integer("system_rank"),points:real("points"),played:integer("played"),dataStatus:text("data_status").notNull(),updatedAt:text("updated_at").notNull()});
export const teamStrength=sqliteTable("team_strength",{id:integer("id").primaryKey({autoIncrement:true}),teamName:text("team_name").notNull().unique(),attackRating:real("attack_rating"),defenseRating:real("defense_rating"),homeRating:real("home_rating"),awayRating:real("away_rating"),formRating:real("form_rating"),marketRating:real("market_rating"),sampleSize:integer("sample_size").default(0),dataStatus:text("data_status").notNull(),updatedAt:text("updated_at").notNull()});
export const playerDynamics=sqliteTable("player_dynamics",{id:integer("id").primaryKey({autoIncrement:true}),playerName:text("player_name").notNull(),teamName:text("team_name").notNull(),position:text("position"),eliteLevel:text("elite_level"),status:text("status").notNull(),injury:text("injury"),suspension:text("suspension"),expectedReturn:text("expected_return"),startProbability:real("start_probability"),impactLevel:text("impact_level"),source:text("source"),sourceUpdatedAt:text("source_updated_at"),updatedAt:text("updated_at").notNull()});
export const bookmakers=sqliteTable("bookmakers",{code:text("code").primaryKey(),name:text("name").notNull(),region:text("region").notNull(),weight:real("weight").notNull(),active:integer("active").notNull().default(1)});
export const europeanOdds=sqliteTable("european_odds",{id:integer("id").primaryKey({autoIncrement:true}),matchId:text("match_id").notNull(),bookmaker:text("bookmaker").notNull(),snapshotType:text("snapshot_type").notNull(),homeOdds:real("home_odds").notNull(),drawOdds:real("draw_odds").notNull(),awayOdds:real("away_odds").notNull(),homeProb:real("home_prob"),drawProb:real("draw_prob"),awayProb:real("away_prob"),returnRate:real("return_rate"),observedAt:text("observed_at").notNull(),source:text("source").notNull()});
export const asianLines=sqliteTable("asian_lines",{id:integer("id").primaryKey({autoIncrement:true}),matchId:text("match_id").notNull(),bookmaker:text("bookmaker").notNull(),snapshotType:text("snapshot_type").notNull(),line:real("line").notNull(),homeWater:real("home_water").notNull(),awayWater:real("away_water").notNull(),observedAt:text("observed_at").notNull(),source:text("source").notNull()});
export const marketAttitudes=sqliteTable("market_attitudes",{id:integer("id").primaryKey({autoIncrement:true}),matchId:text("match_id").notNull(),bookmakerCount:integer("bookmaker_count").notNull(),direction:text("direction").notNull(),confidence:real("confidence").notNull(),status:text("status").notNull(),evidenceJson:text("evidence_json").notNull(),modelVersion:text("model_version").notNull(),createdAt:text("created_at").notNull()});
export const analysisPredictions=sqliteTable("analysis_predictions",{id:integer("id").primaryKey({autoIncrement:true}),matchId:text("match_id").notNull(),modelVersion:text("model_version").notNull(),predictionJson:text("prediction_json").notNull(),evidenceHash:text("evidence_hash").notNull(),analysisStatus:text("analysis_status").notNull(),createdAt:text("created_at").notNull()});
export const analysisOutcomes=sqliteTable("analysis_outcomes",{id:integer("id").primaryKey({autoIncrement:true}),matchId:text("match_id").notNull().unique(),homeGoals:integer("home_goals").notNull(),awayGoals:integer("away_goals").notNull(),result:text("result").notNull(),source:text("source").notNull(),settledAt:text("settled_at").notNull()});
export const modelCalibration=sqliteTable("model_calibration",{id:integer("id").primaryKey({autoIncrement:true}),modelVersion:text("model_version").notNull(),sampleSize:integer("sample_size").notNull(),brierScore:real("brier_score"),logLoss:real("log_loss"),scoreHitRate:real("score_hit_rate"),calibrationJson:text("calibration_json").notNull(),createdAt:text("created_at").notNull()});
export const bettingValueRecords=sqliteTable("betting_value_records",{id:integer("id").primaryKey({autoIncrement:true}),matchId:text("match_id").notNull(),market:text("market").notNull(),selection:text("selection").notNull(),bookmaker:text("bookmaker").notNull(),odds:real("odds").notNull(),modelProbability:real("model_probability").notNull(),marketProbability:real("market_probability").notNull(),breakEvenProbability:real("break_even_probability").notNull(),expectedValue:real("expected_value").notNull(),edge:real("edge").notNull(),grade:text("grade").notNull(),status:text("status").notNull(),analysisVersion:text("analysis_version").notNull(),evidenceHash:text("evidence_hash").notNull(),observedAt:text("observed_at").notNull()});
export const valueSettlements=sqliteTable("value_settlements",{id:integer("id").primaryKey({autoIncrement:true}),valueRecordId:integer("value_record_id").notNull(),closingOdds:real("closing_odds"),clv:real("clv"),result:text("result").notNull(),profitUnits:real("profit_units").notNull(),settledAt:text("settled_at").notNull()});
