CREATE TABLE `login_code_requests` (
	`email` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
