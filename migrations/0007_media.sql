CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`key` text NOT NULL,
	`poster_id` text,
	`duration_seconds` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`poster_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
