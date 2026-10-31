CREATE TABLE `email_recipients` (
	`email_id` text NOT NULL,
	`email` text NOT NULL,
	`field` text NOT NULL,
	`report` text,
	PRIMARY KEY(`email_id`, `email`),
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_recipients_email_idx` ON `email_recipients` (`email`);--> statement-breakpoint
-- Emails so far went to one address each: it becomes their one recipient, with its report.
INSERT INTO `email_recipients` (`email_id`, `email`, `field`, `report`)
SELECT `id`, `to`, 'to', CASE WHEN `status` IN ('delivered', 'bounced', 'complained') THEN `status` END FROM `emails`;--> statement-breakpoint
UPDATE `emails` SET `status` = 'sent' WHERE `status` <> 'failed';--> statement-breakpoint
DROP INDEX `emails_to_idx`;--> statement-breakpoint
ALTER TABLE `emails` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `emails_idempotency_key_unique` ON `emails` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `emails` DROP COLUMN `to`;