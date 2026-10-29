CREATE TABLE `login_code_requests` (
	`email` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_code_requests_window_idx` ON `login_code_requests` (`window_start`);
