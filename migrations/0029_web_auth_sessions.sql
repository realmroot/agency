CREATE TABLE `web_authorization_attempts` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`encrypted_payload` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_web_authorization_attempts_expires_at` ON `web_authorization_attempts` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `web_auth_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_web_auth_sessions_subject` ON `web_auth_sessions` (`subject`);
--> statement-breakpoint
CREATE INDEX `idx_web_auth_sessions_expires_at` ON `web_auth_sessions` (`expires_at`);
