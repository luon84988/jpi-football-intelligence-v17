CREATE TABLE `league_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`level` text NOT NULL,
	`group_name` text NOT NULL,
	`style` text NOT NULL,
	`tempo` real NOT NULL,
	`physical` real NOT NULL,
	`press` real NOT NULL,
	`transition` real NOT NULL,
	`style_note` text,
	`avg_goals` real,
	`over_rate` real,
	`under_rate` real,
	`draw_rate` real,
	`home_win_rate` real,
	`home_away_diff` real,
	`season_phase` text NOT NULL,
	`data_status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `league_profiles_name_unique` ON `league_profiles` (`name`);