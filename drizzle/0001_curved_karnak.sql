CREATE TABLE `player_dynamics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_name` text NOT NULL,
	`team_name` text NOT NULL,
	`position` text,
	`elite_level` text,
	`status` text NOT NULL,
	`injury` text,
	`suspension` text,
	`expected_return` text,
	`start_probability` real,
	`impact_level` text,
	`source` text,
	`source_updated_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_rankings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`league` text NOT NULL,
	`country` text,
	`official_rank` integer,
	`system_rank` integer,
	`points` real,
	`played` integer,
	`data_status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_rankings_name_unique` ON `team_rankings` (`name`);--> statement-breakpoint
CREATE TABLE `team_strength` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_name` text NOT NULL,
	`attack_rating` real,
	`defense_rating` real,
	`home_rating` real,
	`away_rating` real,
	`form_rating` real,
	`market_rating` real,
	`sample_size` integer DEFAULT 0,
	`data_status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_strength_team_name_unique` ON `team_strength` (`team_name`);