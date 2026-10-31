CREATE TABLE `domestic_feed_snapshots` (
	`snapshot_hash` text PRIMARY KEY NOT NULL,
	`sales_date` text NOT NULL,
	`observed_at` text NOT NULL,
	`received_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domestic_source_captures` (
	`sha256` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`url` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`raw` blob NOT NULL
);
