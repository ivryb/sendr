ALTER TABLE `api_keys` ADD `permissions` text DEFAULT '["contacts"]' NOT NULL;--> statement-breakpoint
-- Carry each key's single access level over as its one permission.
UPDATE `api_keys` SET `permissions` = json_array(`access`);--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `access`;
