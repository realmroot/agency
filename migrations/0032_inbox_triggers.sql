-- Add Inbox-backed triggers, durable source-event deduplication, and the
-- authoritative correlated Session route binding.
PRAGMA defer_foreign_keys=on;--> statement-breakpoint
CREATE TABLE `__new_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`environment_id` text,
	`trigger_type` text DEFAULT 'scheduled' NOT NULL,
	`http_concurrency_mode` text DEFAULT 'parallel' NOT NULL,
	`runtime` text NOT NULL,
	`name` text NOT NULL,
	`prompt_template` text NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`env_from` text DEFAULT '[]' NOT NULL,
	`volumes` text DEFAULT '[]' NOT NULL,
	`volume_mounts` text DEFAULT '[]' NOT NULL,
	`interval_seconds` integer,
	`window_seconds` integer DEFAULT 0,
	`enabled` integer DEFAULT true NOT NULL,
	`next_due_at` text,
	`last_dispatched_at` text,
	`last_run_id` text,
	`inbox_subscription_id` text,
	`inbox_callback_token_hash` text,
	`inbox_subscription_etag` text,
	`inbox_provisioning_state` text,
	`inbox_provisioning_error` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `ck_triggers_runtime` CHECK (`runtime` in ('ama','claude-code','codex','copilot')),
	CONSTRAINT `ck_triggers_type` CHECK (`trigger_type` in ('scheduled','http','inbox')),
	CONSTRAINT `ck_triggers_http_concurrency` CHECK (`http_concurrency_mode` in ('parallel','serial')),
	CONSTRAINT `ck_triggers_schedule_shape` CHECK ((`trigger_type` = 'scheduled' and `interval_seconds` is not null and `next_due_at` is not null) or (`trigger_type` in ('http','inbox') and `interval_seconds` is null and `next_due_at` is null)),
	CONSTRAINT `ck_triggers_inbox_shape` CHECK ((`trigger_type` = 'inbox' and `inbox_subscription_id` is not null and `inbox_callback_token_hash` is not null and `inbox_provisioning_state` is not null) or (`trigger_type` != 'inbox' and `inbox_subscription_id` is null and `inbox_callback_token_hash` is null and `inbox_subscription_etag` is null and `inbox_provisioning_state` is null and `inbox_provisioning_error` is null))
);--> statement-breakpoint
INSERT INTO `__new_triggers` (
	`id`, `organization_id`, `project_id`, `agent_id`, `environment_id`,
	`trigger_type`, `http_concurrency_mode`, `runtime`, `name`, `prompt_template`,
	`env`, `env_from`, `volumes`, `volume_mounts`, `interval_seconds`,
	`window_seconds`, `enabled`, `next_due_at`, `last_dispatched_at`, `last_run_id`,
	`inbox_subscription_id`, `inbox_callback_token_hash`, `inbox_subscription_etag`, `inbox_provisioning_state`,
	`inbox_provisioning_error`, `metadata`, `created_by_user_id`, `archived_at`,
	`created_at`, `updated_at`
)
SELECT
	`id`, `organization_id`, `project_id`, `agent_id`, `environment_id`,
	`trigger_type`, `http_concurrency_mode`, `runtime`, `name`, `prompt_template`,
	`env`, `env_from`, `volumes`, `volume_mounts`, `interval_seconds`,
	`window_seconds`, `enabled`, `next_due_at`, `last_dispatched_at`, `last_run_id`,
	NULL, NULL, NULL, NULL, NULL, `metadata`, `created_by_user_id`, `archived_at`,
	`created_at`, `updated_at`
FROM `triggers`;--> statement-breakpoint
DROP TABLE `triggers`;--> statement-breakpoint
ALTER TABLE `__new_triggers` RENAME TO `triggers`;--> statement-breakpoint
CREATE INDEX `idx_triggers_project_next` ON `triggers` (`project_id`,`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_triggers_due` ON `triggers` (`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_triggers_inbox_subscription` ON `triggers` (`inbox_subscription_id`);--> statement-breakpoint

ALTER TABLE `trigger_runs` ADD `source_subscription_id` text;--> statement-breakpoint
ALTER TABLE `trigger_runs` ADD `source_event_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_source_event` ON `trigger_runs` (`source_subscription_id`,`source_event_id`);--> statement-breakpoint

CREATE TABLE `session_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`routing_key_hash` text NOT NULL,
	`session_id` text NOT NULL,
	`activation_run_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activation_run_id`) REFERENCES `trigger_runs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_routes_trigger_key` ON `session_routes` (`agent_id`,`trigger_id`,`routing_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_routes_session` ON `session_routes` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_routes_project` ON `session_routes` (`project_id`,`trigger_id`);
