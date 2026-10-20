CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sender_id`) REFERENCES `senders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `emails_provider_message_idx` ON `emails` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `emails_to_idx` ON `emails` (`to`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `access` text DEFAULT 'contacts' NOT NULL;