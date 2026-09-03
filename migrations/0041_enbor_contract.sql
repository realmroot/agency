-- One-way Enbor contract cutover. No AMA aliases remain after this migration.
PRAGMA defer_foreign_keys=on;--> statement-breakpoint

CREATE TABLE `__backup_0041_session_routes` AS SELECT * FROM `session_routes`;--> statement-breakpoint
CREATE TABLE `__backup_0041_http_trigger_pending_runs` AS SELECT * FROM `http_trigger_pending_runs`;--> statement-breakpoint
CREATE TABLE `__backup_0041_trigger_runs` AS SELECT * FROM `trigger_runs`;--> statement-breakpoint
DROP TABLE `session_routes`;--> statement-breakpoint
DROP TABLE `http_trigger_pending_runs`;--> statement-breakpoint
DROP TABLE `trigger_runs`;--> statement-breakpoint

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
  `inbox_callback_token_ciphertext` text,
  `inbox_subscription_etag` text,
  `inbox_registered_agent_subject` text,
  `inbox_transition_target_subject` text,
  `inbox_provisioning_state` text,
  `inbox_provisioning_error` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_by_user_id` text,
  `deleted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `ck_triggers_runtime` CHECK (`runtime` in ('enbor','claude-code','codex','copilot')),
  CONSTRAINT `ck_triggers_type` CHECK (`trigger_type` in ('scheduled','http','inbox')),
  CONSTRAINT `ck_triggers_http_concurrency` CHECK (`http_concurrency_mode` in ('parallel','serial')),
  CONSTRAINT `ck_triggers_schedule_shape` CHECK ((`trigger_type` = 'scheduled' and `interval_seconds` is not null and `next_due_at` is not null) or (`trigger_type` in ('http','inbox') and `interval_seconds` is null and `next_due_at` is null)),
  CONSTRAINT `ck_triggers_inbox_shape` CHECK ((`trigger_type` = 'inbox' and `inbox_subscription_id` is not null and `inbox_callback_token_hash` is not null and `inbox_callback_token_ciphertext` is not null and `inbox_provisioning_state` is not null) or (`trigger_type` != 'inbox' and `inbox_subscription_id` is null and `inbox_callback_token_hash` is null and `inbox_callback_token_ciphertext` is null and `inbox_subscription_etag` is null and `inbox_registered_agent_subject` is null and `inbox_transition_target_subject` is null and `inbox_provisioning_state` is null and `inbox_provisioning_error` is null))
);--> statement-breakpoint
INSERT INTO `__new_triggers` SELECT
  `id`, `organization_id`, `project_id`, `agent_id`, `environment_id`,
  `trigger_type`, `http_concurrency_mode`, CASE `runtime` WHEN 'ama' THEN 'enbor' ELSE `runtime` END,
  `name`, `prompt_template`,
  replace(replace(replace(`env`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), '"ama"', '"enbor"'),
  replace(replace(replace(`env_from`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), '"ama"', '"enbor"'),
  replace(replace(replace(replace(`volumes`, '"ama://', '"enbor://'), '/.ama/', '/.enbor/'), '"ama"', '"enbor"'), '"ama.dev/', '"enbor.dev/'),
  replace(replace(replace(replace(`volume_mounts`, '"ama://', '"enbor://'), '/.ama/', '/.enbor/'), '"ama"', '"enbor"'), '"ama.dev/', '"enbor.dev/'),
  `interval_seconds`, `window_seconds`, `enabled`, `next_due_at`, `last_dispatched_at`, `last_run_id`,
  `inbox_subscription_id`, `inbox_callback_token_hash`, `inbox_callback_token_ciphertext`,
  `inbox_subscription_etag`, `inbox_registered_agent_subject`, `inbox_transition_target_subject`,
  `inbox_provisioning_state`, `inbox_provisioning_error`,
  replace(replace(replace(replace(`metadata`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), '"ama"', '"enbor"'), '"ama.dev/', '"enbor.dev/'),
  `created_by_user_id`, `deleted_at`, `created_at`, `updated_at`
FROM `triggers`;--> statement-breakpoint
DROP TABLE `triggers`;--> statement-breakpoint
ALTER TABLE `__new_triggers` RENAME TO `triggers`;--> statement-breakpoint
CREATE INDEX `idx_triggers_project_next` ON `triggers` (`project_id`,`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_triggers_due` ON `triggers` (`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_triggers_inbox_subscription` ON `triggers` (`inbox_subscription_id`);--> statement-breakpoint
CREATE TRIGGER `trg_triggers_reject_live_insert_on_deleted_project`
BEFORE INSERT ON `triggers`
WHEN NEW.`deleted_at` IS NULL
  AND NEW.`project_id` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_id` AND `deleted_at` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;--> statement-breakpoint
CREATE TRIGGER `trg_triggers_reject_live_update_on_deleted_project`
BEFORE UPDATE ON `triggers`
WHEN NEW.`deleted_at` IS NULL
  AND NEW.`project_id` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_id` AND `deleted_at` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;--> statement-breakpoint
CREATE TRIGGER `trg_triggers_reject_restore`
BEFORE UPDATE OF `deleted_at` ON `triggers`
WHEN OLD.`deleted_at` IS NOT NULL AND NEW.`deleted_at` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;--> statement-breakpoint

CREATE TABLE `trigger_runs` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL, `project_id` text NOT NULL,
  `trigger_id` text NOT NULL, `scheduled_for` text, `heartbeat_at` text, `triggered_at` text NOT NULL,
  `state` text NOT NULL, `idempotency_key` text NOT NULL, `session_id` text, `correlation_id` text NOT NULL,
  `error_message` text, `source_subscription_id` text, `source_event_id` text,
  `metadata` text DEFAULT '{}' NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `ck_trigger_runs_state` CHECK (`state` in ('claimed','queued','dispatching','dispatched','failed'))
);--> statement-breakpoint
INSERT INTO `trigger_runs` SELECT * FROM `__backup_0041_trigger_runs`;--> statement-breakpoint
DROP TABLE `__backup_0041_trigger_runs`;--> statement-breakpoint
UPDATE `trigger_runs` SET `metadata` = replace(replace(replace(replace(`metadata`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), '"ama"', '"enbor"'), '"ama.dev/', '"enbor.dev/') WHERE instr(lower(`metadata`), 'ama') > 0;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_unique_occurrence` ON `trigger_runs` (`trigger_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_idempotency_key` ON `trigger_runs` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_source_event` ON `trigger_runs` (`source_subscription_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_trigger_created` ON `trigger_runs` (`trigger_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_project_created` ON `trigger_runs` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `trg_trigger_runs_reject_insert_on_deleted_trigger`
BEFORE INSERT ON `trigger_runs`
WHEN EXISTS (SELECT 1 FROM `triggers` WHERE `id` = NEW.`trigger_id` AND `deleted_at` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot dispatch a deleted trigger');
END;--> statement-breakpoint

CREATE TABLE `http_trigger_pending_runs` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `run_id` text NOT NULL UNIQUE,
  `trigger_id` text NOT NULL, `organization_id` text NOT NULL, `organization_name` text NOT NULL,
  `project_id` text NOT NULL, `project_name` text NOT NULL, `requested_by_user_id` text NOT NULL,
  `routing_key_hash` text, `rendered_prompt` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `trigger_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `http_trigger_pending_runs` SELECT * FROM `__backup_0041_http_trigger_pending_runs`;--> statement-breakpoint
DROP TABLE `__backup_0041_http_trigger_pending_runs`;--> statement-breakpoint
CREATE INDEX `idx_http_trigger_pending_fifo` ON `http_trigger_pending_runs` (`trigger_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_http_trigger_pending_project` ON `http_trigger_pending_runs` (`project_id`,`sequence`);--> statement-breakpoint

CREATE TABLE `session_routes` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL, `project_id` text NOT NULL,
  `agent_id` text NOT NULL, `trigger_id` text NOT NULL, `routing_key_hash` text NOT NULL,
  `session_id` text NOT NULL, `activation_run_id` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`activation_run_id`) REFERENCES `trigger_runs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `session_routes` SELECT * FROM `__backup_0041_session_routes`;--> statement-breakpoint
DROP TABLE `__backup_0041_session_routes`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_routes_trigger_key` ON `session_routes` (`agent_id`,`trigger_id`,`routing_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_routes_session` ON `session_routes` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_routes_project` ON `session_routes` (`project_id`,`trigger_id`);--> statement-breakpoint

CREATE TABLE `__backup_0041_vault_credential_versions` AS SELECT * FROM `vault_credential_versions`;--> statement-breakpoint
CREATE TABLE `__new_vault_credentials` (
  `id` text PRIMARY KEY NOT NULL, `vault_id` text NOT NULL, `organization_id` text NOT NULL,
  `project_id` text, `name` text NOT NULL, `type` text NOT NULL, `metadata` text DEFAULT '{}' NOT NULL,
  `state` text DEFAULT 'active' NOT NULL, `active_version_id` text, `revoked_at` text,
  `revoked_by_user_id` text, `revoke_reason` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `ck_vault_credentials_state` CHECK (`state` in ('active','revoked')),
  CONSTRAINT `ck_vault_credentials_type` CHECK (`type` in ('opaque','enbor.dev/basic-auth','enbor.dev/ssh-auth','enbor.dev/tls','enbor.dev/private-key-jwk','enbor.dev/oauth-token','enbor.dev/realmroot-agent-state'))
);--> statement-breakpoint
INSERT INTO `__new_vault_credentials` SELECT
  `id`, `vault_id`, `organization_id`, `project_id`, `name`, replace(`type`, 'ama.dev/', 'enbor.dev/'),
  replace(replace(replace(`metadata`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/'), `state`, `active_version_id`,
  `revoked_at`, `revoked_by_user_id`, `revoke_reason`, `created_at`, `updated_at`
FROM `vault_credentials`;--> statement-breakpoint
DROP TABLE `vault_credential_versions`;--> statement-breakpoint
DROP TABLE `vault_credentials`;--> statement-breakpoint
ALTER TABLE `__new_vault_credentials` RENAME TO `vault_credentials`;--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_vault_created` ON `vault_credentials` (`vault_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_project_created` ON `vault_credentials` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_credentials_identity_purpose` ON `vault_credentials` (`vault_id`,json_extract(`metadata`, '$.managedBy'),json_extract(`metadata`, '$.identityId'),coalesce(json_extract(`metadata`, '$.purpose'), case when `type` = 'enbor.dev/realmroot-agent-state' then 'agent-state' end)) WHERE json_extract(`metadata`, '$.managedBy') = 'identity';--> statement-breakpoint

CREATE TABLE `vault_credential_versions` (
  `id` text PRIMARY KEY NOT NULL, `credential_id` text NOT NULL, `vault_id` text NOT NULL,
  `organization_id` text NOT NULL, `project_id` text, `version` integer NOT NULL,
  `provider` text NOT NULL, `secret_ref` text NOT NULL, `reference_name` text NOT NULL,
  `state` text DEFAULT 'active' NOT NULL, `has_secret` integer DEFAULT true NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL, `created_at` text NOT NULL, `superseded_at` text, `revoked_at` text,
  FOREIGN KEY (`credential_id`) REFERENCES `vault_credentials`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `ck_vault_credential_versions_state` CHECK (`state` in ('active','superseded','revoked')),
  CONSTRAINT `ck_vault_credential_versions_provider` CHECK (`provider` in ('enbor'))
);--> statement-breakpoint
INSERT INTO `vault_credential_versions` SELECT
  `id`, `credential_id`, `vault_id`, `organization_id`, `project_id`, `version`,
  CASE `provider` WHEN 'ama' THEN 'enbor' ELSE `provider` END,
  replace(`secret_ref`, 'ama://', 'enbor://'), `reference_name`, `state`, `has_secret`,
  replace(replace(replace(`metadata`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/'), `created_at`, `superseded_at`, `revoked_at`
FROM `__backup_0041_vault_credential_versions`;--> statement-breakpoint
DROP TABLE `__backup_0041_vault_credential_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_credential_versions_unique_credential_version` ON `vault_credential_versions` (`credential_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_vault_credential_versions_vault_created` ON `vault_credential_versions` (`vault_id`,`created_at`,`id`);--> statement-breakpoint

UPDATE `identities` SET `runtime` = 'enbor' WHERE `runtime` = 'ama';--> statement-breakpoint
UPDATE `agents` SET `skills` = replace(`skills`, '"ama@', '"enbor@'), `subagents` = replace(`subagents`, '"ama@', '"enbor@'), `identity_snapshot` = replace(replace(replace(`identity_snapshot`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/') WHERE instr(lower(coalesce(`skills`, '') || coalesce(`subagents`, '') || coalesce(`identity_snapshot`, '')), 'ama') > 0;--> statement-breakpoint
UPDATE `agent_versions` SET `skills` = replace(`skills`, '"ama@', '"enbor@'), `subagents` = replace(`subagents`, '"ama@', '"enbor@'), `identity_snapshot` = replace(replace(replace(`identity_snapshot`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/') WHERE instr(lower(coalesce(`skills`, '') || coalesce(`subagents`, '') || coalesce(`identity_snapshot`, '')), 'ama') > 0;--> statement-breakpoint
UPDATE `environments` SET `variables` = replace(`variables`, '"AMA_', '"ENBOR_'), `runtime_config` = replace(replace(`runtime_config`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama-', '"enbor-'), `metadata` = replace(replace(`metadata`, '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/') WHERE instr(lower(`variables` || `runtime_config` || `metadata`), 'ama') > 0;--> statement-breakpoint
UPDATE `environment_versions` SET `variables` = replace(`variables`, '"AMA_', '"ENBOR_'), `runtime_config` = replace(replace(`runtime_config`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama-', '"enbor-'), `metadata` = replace(replace(`metadata`, '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/') WHERE instr(lower(`variables` || `runtime_config` || `metadata`), 'ama') > 0;--> statement-breakpoint
UPDATE `sessions` SET `agent_snapshot` = replace(replace(replace(`agent_snapshot`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama@', '"enbor@'), '"ama://', '"enbor://'), `environment_snapshot` = replace(replace(replace(`environment_snapshot`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama://', '"enbor://'), '/.ama/', '/.enbor/'), `env` = replace(replace(`env`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), `env_from` = replace(replace(`env_from`, '"AMA_', '"ENBOR_'), '"ama://', '"enbor://'), `volumes` = replace(replace(replace(`volumes`, '"ama://', '"enbor://'), '/.ama/', '/.enbor/'), '"ama.dev/', '"enbor.dev/'), `volume_mounts` = replace(replace(replace(`volume_mounts`, '"ama://', '"enbor://'), '/.ama/', '/.enbor/'), '"ama.dev/', '"enbor.dev/'), `metadata` = replace(replace(replace(`metadata`, '"AMA_', '"ENBOR_'), '"ama.dev/', '"enbor.dev/'), '"runtime":"ama"', '"runtime":"enbor"') WHERE instr(lower(coalesce(`agent_snapshot`, '') || coalesce(`environment_snapshot`, '') || `env` || `env_from` || `volumes` || `volume_mounts` || `metadata`), 'ama') > 0;--> statement-breakpoint
UPDATE `runners` SET `runtimes` = replace(replace(`runtimes`, '"runtime":"ama"', '"runtime":"enbor"'), '"ama-', '"enbor-'), `metadata` = replace(replace(`metadata`, '"ama://', '"enbor://'), '"ama.dev/', '"enbor.dev/') WHERE instr(lower(`runtimes` || `metadata`), 'ama') > 0;
