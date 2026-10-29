DROP INDEX `deliveries_campaign_status_idx`;--> statement-breakpoint
DROP INDEX `deliveries_provider_message_idx`;--> statement-breakpoint
CREATE INDEX `deliveries_queued_idx` ON `deliveries` (`campaign_id`,`batch`) WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX `deliveries_provider_message_idx` ON `deliveries` (`provider_message_id`) WHERE provider_message_id IS NOT NULL;