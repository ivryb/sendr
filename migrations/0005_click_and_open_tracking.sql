CREATE TABLE `clicks` (
	`delivery_id` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`delivery_id`, `url`),
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `deliveries` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `clicked_at` integer;