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
