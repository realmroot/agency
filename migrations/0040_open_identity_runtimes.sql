DROP TRIGGER `agents_identity_bind_insert`;
DROP TRIGGER `agents_identity_bind_insert_commit`;
DROP TRIGGER `agents_identity_bind_update`;
DROP TRIGGER `agents_identity_bind_update_commit`;
--> statement-breakpoint
CREATE TABLE `__identity_agent_bindings` AS
SELECT `id` AS `agent_id`, `identity_id`
FROM `agents`
WHERE `identity_id` IS NOT NULL;
CREATE TABLE `__identity_agent_version_bindings` AS
SELECT `id` AS `agent_version_id`, `identity_id`
FROM `agent_versions`
WHERE `identity_id` IS NOT NULL;
UPDATE `agents` SET `identity_id` = NULL WHERE `identity_id` IS NOT NULL;
UPDATE `agent_versions` SET `identity_id` = NULL WHERE `identity_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_identities` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `username` text NOT NULL,
  `runtime` text NOT NULL CHECK (
    length(`runtime`) BETWEEN 1 AND 64
    AND substr(`runtime`, 1, 1) GLOB '[a-z0-9]'
    AND `runtime` NOT GLOB '*[^a-z0-9._-]*'
  ),
  `state` text NOT NULL DEFAULT 'provisioning' CHECK (`state` in ('provisioning','active','error')),
  `failure_code` text,
  `vault_id` text NOT NULL,
  `credential_id` text,
  `remote_agent_id` text,
  `issuer` text,
  `subject` text,
  `bound_agent_id` text,
  `idempotency_key_hash` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `provisioning_owner` text,
  `provisioning_lease_expires_at` text,
  `deleted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_identities` (
  `id`, `project_id`, `organization_id`, `name`, `description`, `username`, `runtime`, `state`,
  `failure_code`, `vault_id`, `credential_id`, `remote_agent_id`, `issuer`, `subject`, `bound_agent_id`,
  `idempotency_key_hash`, `request_fingerprint`, `provisioning_owner`, `provisioning_lease_expires_at`,
  `deleted_at`, `created_at`, `updated_at`
)
SELECT
  `id`, `project_id`, `organization_id`, `name`, `description`, `username`, `runtime`, `state`,
  `failure_code`, `vault_id`, `credential_id`, `remote_agent_id`, `issuer`, `subject`, `bound_agent_id`,
  `idempotency_key_hash`, `request_fingerprint`, `provisioning_owner`, `provisioning_lease_expires_at`,
  `deleted_at`, `created_at`, `updated_at`
FROM `identities`;
--> statement-breakpoint
DROP TABLE `identities`;
--> statement-breakpoint
ALTER TABLE `__new_identities` RENAME TO `identities`;
--> statement-breakpoint
UPDATE `agents`
SET `identity_id` = (
  SELECT `identity_id` FROM `__identity_agent_bindings` WHERE `agent_id` = `agents`.`id`
)
WHERE `id` IN (SELECT `agent_id` FROM `__identity_agent_bindings`);
UPDATE `agent_versions`
SET `identity_id` = (
  SELECT `identity_id` FROM `__identity_agent_version_bindings` WHERE `agent_version_id` = `agent_versions`.`id`
)
WHERE `id` IN (SELECT `agent_version_id` FROM `__identity_agent_version_bindings`);
DROP TABLE `__identity_agent_bindings`;
DROP TABLE `__identity_agent_version_bindings`;
--> statement-breakpoint
CREATE INDEX `idx_identities_project_created` ON `identities` (`project_id`,`created_at`,`id`);
CREATE UNIQUE INDEX `idx_identities_project_idempotency` ON `identities` (`project_id`,`idempotency_key_hash`);
CREATE UNIQUE INDEX `idx_identities_remote_agent` ON `identities` (`remote_agent_id`);
CREATE INDEX `idx_identities_bound_agent` ON `identities` (`bound_agent_id`);
--> statement-breakpoint
CREATE TRIGGER `agents_identity_bind_insert`
BEFORE INSERT ON `agents`
WHEN NEW.`identity_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `identities` i
    WHERE i.`id` = NEW.`identity_id`
      AND i.`project_id` = NEW.`project_id`
      AND i.`state` = 'active'
      AND i.`deleted_at` IS NULL
      AND (i.`bound_agent_id` IS NULL OR i.`bound_agent_id` = NEW.`id`)
  )
BEGIN
  SELECT RAISE(ABORT, 'identity_already_bound');
END;

CREATE TRIGGER `agents_identity_bind_insert_commit`
AFTER INSERT ON `agents`
WHEN NEW.`identity_id` IS NOT NULL
BEGIN
  UPDATE `identities`
  SET `bound_agent_id` = NEW.`id`, `updated_at` = NEW.`updated_at`
  WHERE `id` = NEW.`identity_id`;
END;

CREATE TRIGGER `agents_identity_bind_update`
BEFORE UPDATE OF `identity_id` ON `agents`
WHEN NEW.`identity_id` IS NOT NULL
  AND NEW.`identity_id` IS NOT OLD.`identity_id`
  AND NOT EXISTS (
    SELECT 1 FROM `identities` i
    WHERE i.`id` = NEW.`identity_id`
      AND i.`project_id` = NEW.`project_id`
      AND i.`state` = 'active'
      AND i.`deleted_at` IS NULL
      AND (i.`bound_agent_id` IS NULL OR i.`bound_agent_id` = NEW.`id`)
  )
BEGIN
  SELECT RAISE(ABORT, 'identity_already_bound');
END;

CREATE TRIGGER `agents_identity_bind_update_commit`
AFTER UPDATE OF `identity_id` ON `agents`
WHEN NEW.`identity_id` IS NOT NULL
  AND NEW.`identity_id` IS NOT OLD.`identity_id`
BEGIN
  UPDATE `identities`
  SET `bound_agent_id` = NEW.`id`, `updated_at` = NEW.`updated_at`
  WHERE `id` = NEW.`identity_id`;
END;
--> statement-breakpoint
CREATE TRIGGER trg_identities_reject_live_insert_on_deleted_project
BEFORE INSERT ON identities
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;
--> statement-breakpoint
CREATE TRIGGER trg_identities_reject_live_update_on_deleted_project
BEFORE UPDATE ON identities
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;
--> statement-breakpoint
CREATE TRIGGER trg_identities_reject_restore
BEFORE UPDATE OF deleted_at ON identities
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;
