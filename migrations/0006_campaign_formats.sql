ALTER TABLE `campaigns` RENAME COLUMN `markdown` TO `body`;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `format` text DEFAULT 'editor' NOT NULL;--> statement-breakpoint
-- Campaigns written before formats are Markdown, which reads fine as plain text.
UPDATE `campaigns` SET `format` = 'text';
