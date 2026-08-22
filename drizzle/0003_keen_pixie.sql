CREATE TABLE `analysis_outcomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`home_goals` integer NOT NULL,
	`away_goals` integer NOT NULL,
	`result` text NOT NULL,
	`source` text NOT NULL,
	`settled_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_outcomes_match_id_unique` ON `analysis_outcomes` (`match_id`);--> statement-breakpoint
CREATE TABLE `analysis_predictions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`model_version` text NOT NULL,
	`prediction_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`analysis_status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_calibration` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_version` text NOT NULL,
	`sample_size` integer NOT NULL,
	`brier_score` real,
	`log_loss` real,
	`score_hit_rate` real,
	`calibration_json` text NOT NULL,
	`created_at` text NOT NULL
);
