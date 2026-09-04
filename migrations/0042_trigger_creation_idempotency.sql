ALTER TABLE `triggers` ADD `creation_key_hash` text;
--> statement-breakpoint
ALTER TABLE `triggers` ADD `creation_fingerprint` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_triggers_project_creation_idempotency` ON `triggers` (`project_id`,`creation_key_hash`);
