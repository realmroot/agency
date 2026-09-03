ALTER TABLE `agents` ADD `creation_key_hash` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `creation_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `creation_name` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `creation_description` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agents_project_creation_idempotency` ON `agents` (`project_id`,`creation_key_hash`);
--> statement-breakpoint
ALTER TABLE `environments` ADD `creation_key_hash` text;
--> statement-breakpoint
ALTER TABLE `environments` ADD `creation_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `environments` ADD `creation_name` text;
--> statement-breakpoint
ALTER TABLE `environments` ADD `creation_description` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_environments_project_creation_idempotency` ON `environments` (`project_id`,`creation_key_hash`);
