CREATE TABLE `betting_value_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`bookmaker` text NOT NULL,
	`odds` real NOT NULL,
	`model_probability` real NOT NULL,
	`market_probability` real NOT NULL,
	`break_even_probability` real NOT NULL,
	`expected_value` real NOT NULL,
	`edge` real NOT NULL,
	`grade` text NOT NULL,
	`status` text NOT NULL,
	`analysis_version` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `value_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`value_record_id` integer NOT NULL,
	`closing_odds` real,
	`clv` real,
	`result` text NOT NULL,
	`profit_units` real NOT NULL,
	`settled_at` text NOT NULL
);
