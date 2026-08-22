CREATE TABLE `asian_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`bookmaker` text NOT NULL,
	`snapshot_type` text NOT NULL,
	`line` real NOT NULL,
	`home_water` real NOT NULL,
	`away_water` real NOT NULL,
	`observed_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookmakers` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`weight` real NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `european_odds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`bookmaker` text NOT NULL,
	`snapshot_type` text NOT NULL,
	`home_odds` real NOT NULL,
	`draw_odds` real NOT NULL,
	`away_odds` real NOT NULL,
	`home_prob` real,
	`draw_prob` real,
	`away_prob` real,
	`return_rate` real,
	`observed_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_attitudes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`bookmaker_count` integer NOT NULL,
	`direction` text NOT NULL,
	`confidence` real NOT NULL,
	`status` text NOT NULL,
	`evidence_json` text NOT NULL,
	`model_version` text NOT NULL,
	`created_at` text NOT NULL
);
