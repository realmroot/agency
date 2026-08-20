PRAGMA defer_foreign_keys=on;--> statement-breakpoint

-- SQLite cannot replace a referenced parent table in place. Preserve and
-- rebuild the three child tables around runners so production rows and foreign
-- keys remain valid when the old auth-mode constraint is removed.
CREATE TABLE `__backup_session_channels` AS SELECT * FROM `session_channels`;--> statement-breakpoint
CREATE TABLE `__backup_leases` AS SELECT * FROM `leases`;--> statement-breakpoint
CREATE TABLE `__backup_work_items` AS SELECT * FROM `work_items`;--> statement-breakpoint

DROP TABLE `session_channels`;--> statement-breakpoint
DROP TABLE `leases`;--> statement-breakpoint
DROP TABLE `work_items`;--> statement-breakpoint

CREATE TABLE `__new_runners` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `environment_id` text,
  `credential_id` text,
  `credential_version_id` text,
  `auth_mode` text DEFAULT 'realmroot' NOT NULL,
  `oidc_subject` text,
  `oidc_client_id` text,
  `state` text DEFAULT 'offline' NOT NULL,
  `current_load` integer DEFAULT 0 NOT NULL,
  `max_concurrent` integer DEFAULT 1 NOT NULL,
  `runtime_usage` text DEFAULT '[]' NOT NULL,
  `runtimes` text DEFAULT '[]' NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `last_heartbeat_at` text,
  `archived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "ck_runners_state" CHECK("__new_runners"."state" in ('active','draining','disabled','offline')),
  CONSTRAINT "ck_runners_auth_mode" CHECK("__new_runners"."auth_mode" = 'realmroot')
);--> statement-breakpoint

INSERT INTO `__new_runners` (
  `id`, `organization_id`, `project_id`, `name`, `environment_id`,
  `credential_id`, `credential_version_id`, `auth_mode`, `oidc_subject`,
  `oidc_client_id`, `state`, `current_load`, `max_concurrent`, `runtime_usage`,
  `runtimes`, `metadata`, `last_heartbeat_at`, `archived_at`, `created_at`, `updated_at`
)
SELECT
  `id`, `organization_id`, `project_id`, `name`, `environment_id`,
  `credential_id`, `credential_version_id`, 'realmroot', `oidc_subject`,
  `oidc_client_id`, `state`, `current_load`, `max_concurrent`, `runtime_usage`,
  `runtimes`, `metadata`, `last_heartbeat_at`, `archived_at`, `created_at`, `updated_at`
FROM `runners`;--> statement-breakpoint

DROP TABLE `runners`;--> statement-breakpoint
ALTER TABLE `__new_runners` RENAME TO `runners`;--> statement-breakpoint
CREATE INDEX `idx_runners_project_state_updated` ON `runners` (`project_id`,`state`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_runners_project_environment` ON `runners` (`project_id`,`environment_id`,`state`);--> statement-breakpoint

CREATE TABLE `work_items` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `session_id` text,
  `environment_id` text,
  `runner_id` text,
  `lease_id` text,
  `type` text NOT NULL,
  `state` text DEFAULT 'available' NOT NULL,
  `priority` integer DEFAULT 0 NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 3 NOT NULL,
  `payload` text NOT NULL,
  `result` text,
  `error` text,
  `available_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "ck_work_items_state" CHECK("work_items"."state" in ('available','leased','succeeded','failed','cancelled'))
);--> statement-breakpoint
INSERT INTO `work_items` SELECT * FROM `__backup_work_items`;--> statement-breakpoint
CREATE INDEX `idx_work_items_project_state_available` ON `work_items` (`project_id`,`state`,`available_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_work_items_session` ON `work_items` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_work_items_runner_state` ON `work_items` (`runner_id`,`state`);--> statement-breakpoint

CREATE TABLE `leases` (
  `id` text PRIMARY KEY NOT NULL,
  `work_item_id` text NOT NULL,
  `runner_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `state` text DEFAULT 'active' NOT NULL,
  `expires_at` text NOT NULL,
  `renewed_at` text,
  `resume_token` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "ck_leases_state" CHECK("leases"."state" in ('active','completed','failed','cancelled','expired','interrupted'))
);--> statement-breakpoint
INSERT INTO `leases` SELECT * FROM `__backup_leases`;--> statement-breakpoint
CREATE INDEX `idx_leases_project_state_expires` ON `leases` (`project_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_leases_runner_state` ON `leases` (`runner_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_leases_work_item` ON `leases` (`work_item_id`);--> statement-breakpoint

CREATE TABLE `session_channels` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `lease_id` text NOT NULL,
  `runner_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `state` text DEFAULT 'active' NOT NULL,
  `accepted_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `closed_at` text,
  `close_reason` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `session_channels` SELECT * FROM `__backup_session_channels`;--> statement-breakpoint
CREATE INDEX `idx_session_channels_session_state` ON `session_channels` (`session_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_session_channels_lease_state` ON `session_channels` (`lease_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_session_channels_runner_state` ON `session_channels` (`runner_id`,`state`);--> statement-breakpoint

DROP TABLE `__backup_session_channels`;--> statement-breakpoint
DROP TABLE `__backup_leases`;--> statement-breakpoint
DROP TABLE `__backup_work_items`;
