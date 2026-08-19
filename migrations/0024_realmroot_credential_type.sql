PRAGMA defer_foreign_keys=on;--> statement-breakpoint

CREATE TABLE `__new_vault_credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `vault_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `state` text DEFAULT 'active' NOT NULL,
  `active_version_id` text,
  `revoked_at` text,
  `revoked_by_user_id` text,
  `revoke_reason` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "ck_vault_credentials_state" CHECK("__new_vault_credentials"."state" in ('active','revoked')),
  CONSTRAINT "ck_vault_credentials_type" CHECK("__new_vault_credentials"."type" in ('opaque','ama.dev/basic-auth','ama.dev/ssh-auth','ama.dev/tls','ama.dev/private-key-jwk','ama.dev/oauth-token','ama.dev/realmroot-agent-state'))
);--> statement-breakpoint

CREATE TABLE `__old_vault_credential_versions` AS
SELECT * FROM `vault_credential_versions`;--> statement-breakpoint

INSERT INTO `__new_vault_credentials` (
  `id`, `vault_id`, `organization_id`, `project_id`, `name`, `type`, `metadata`,
  `state`, `active_version_id`, `revoked_at`, `revoked_by_user_id`,
  `revoke_reason`, `created_at`, `updated_at`
)
SELECT
  `id`, `vault_id`, `organization_id`, `project_id`, `name`, `type`, `metadata`,
  `state`, `active_version_id`, `revoked_at`, `revoked_by_user_id`,
  `revoke_reason`, `created_at`, `updated_at`
FROM `vault_credentials`;--> statement-breakpoint

DROP TABLE `vault_credential_versions`;--> statement-breakpoint
DROP TABLE `vault_credentials`;--> statement-breakpoint
ALTER TABLE `__new_vault_credentials` RENAME TO `vault_credentials`;--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_vault_created` ON `vault_credentials` (`vault_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_project_created` ON `vault_credentials` (`project_id`,`created_at`,`id`);--> statement-breakpoint

CREATE TABLE `vault_credential_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `credential_id` text NOT NULL,
  `vault_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `version` integer NOT NULL,
  `provider` text NOT NULL,
  `secret_ref` text NOT NULL,
  `reference_name` text NOT NULL,
  `state` text DEFAULT 'active' NOT NULL,
  `has_secret` integer DEFAULT true NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  `superseded_at` text,
  `revoked_at` text,
  FOREIGN KEY (`credential_id`) REFERENCES `vault_credentials`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "ck_vault_credential_versions_state" CHECK("vault_credential_versions"."state" in ('active','superseded','revoked')),
  CONSTRAINT "ck_vault_credential_versions_provider" CHECK("vault_credential_versions"."provider" in ('ama'))
);--> statement-breakpoint

INSERT INTO `vault_credential_versions` (
  `id`, `credential_id`, `vault_id`, `organization_id`, `project_id`, `version`,
  `provider`, `secret_ref`, `reference_name`, `state`, `has_secret`, `metadata`,
  `created_at`, `superseded_at`, `revoked_at`
)
SELECT
  `id`, `credential_id`, `vault_id`, `organization_id`, `project_id`, `version`,
  `provider`, `secret_ref`, `reference_name`, `state`, `has_secret`, `metadata`,
  `created_at`, `superseded_at`, `revoked_at`
FROM `__old_vault_credential_versions`;--> statement-breakpoint

DROP TABLE `__old_vault_credential_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_credential_versions_unique_credential_version` ON `vault_credential_versions` (`credential_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_vault_credential_versions_vault_created` ON `vault_credential_versions` (`vault_id`,`created_at`,`id`);
