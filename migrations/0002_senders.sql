CREATE TABLE `senders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`reply_to` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'ses' NOT NULL,
	`region` text NOT NULL,
	`access_key_id` text NOT NULL,
	`secret_access_key` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`production` integer DEFAULT false NOT NULL,
	`max_send_rate` real DEFAULT 1 NOT NULL,
	`events_topic_arn` text,
	`events_connected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `sender_id` text REFERENCES senders(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `from_name`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `from_email`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `reply_to`;