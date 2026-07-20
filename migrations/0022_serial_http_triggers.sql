ALTER TABLE `triggers` ADD `http_concurrency_mode` text DEFAULT 'parallel' NOT NULL CHECK (`http_concurrency_mode` in ('parallel','serial'));--> statement-breakpoint

PRAGMA defer_foreign_keys=on;--> statement-breakpoint
CREATE TABLE `__new_trigger_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`scheduled_for` text,
	`heartbeat_at` text,
	`triggered_at` text NOT NULL,
	`state` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`session_id` text,
	`correlation_id` text NOT NULL,
	`error_message` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_trigger_runs_state" CHECK(`state` in ('claimed','queued','dispatching','dispatched','failed'))
);--> statement-breakpoint
INSERT INTO `__new_trigger_runs` SELECT * FROM `trigger_runs`;--> statement-breakpoint
DROP TABLE `trigger_runs`;--> statement-breakpoint
ALTER TABLE `__new_trigger_runs` RENAME TO `trigger_runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_unique_occurrence` ON `trigger_runs` (`trigger_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_idempotency_key` ON `trigger_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_trigger_created` ON `trigger_runs` (`trigger_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_project_created` ON `trigger_runs` (`project_id`,`created_at`,`id`);--> statement-breakpoint

CREATE TABLE `http_trigger_pending_runs` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL UNIQUE,
	`trigger_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`organization_name` text NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`routing_key_hash` text,
	`rendered_prompt` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `trigger_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_http_trigger_pending_fifo` ON `http_trigger_pending_runs` (`trigger_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_http_trigger_pending_project` ON `http_trigger_pending_runs` (`project_id`,`sequence`);
