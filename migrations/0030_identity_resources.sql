-- One-way migration from embedded Agent Realmroot bindings to first-class
-- Identity resources. Application code only understands the post-migration
-- model; there is no dual-read window.

-- D1 does not authorize TEMP schema writes during migrations. Materialize the
-- distinct historical bindings in ordinary short-lived tables so Agent,
-- Agent Version, and Session snapshots can all retain the Identity they used.
CREATE TABLE `_identity_migration_sources` AS
WITH `candidates` AS (
  SELECT
    'agent_' || a.`id` AS `source_id`, 0 AS `priority`, a.`id` AS `agent_id`,
    a.`project_id`, a.`realmroot`, a.`created_at`, a.`updated_at`
  FROM `agents` a
  WHERE a.`realmroot` IS NOT NULL
  UNION ALL
  SELECT
    'version_' || v.`id`, 1, v.`agent_id`, v.`project_id`, v.`realmroot`,
    v.`created_at`, v.`created_at`
  FROM `agent_versions` v
  WHERE v.`realmroot` IS NOT NULL
  UNION ALL
  SELECT
    'session_' || s.`id`, 2, s.`agent_id`, s.`project_id`,
    json_extract(s.`agent_snapshot`, '$.realmroot'), s.`created_at`, s.`updated_at`
  FROM `sessions` s
  WHERE json_type(s.`agent_snapshot`, '$.realmroot') = 'object'
),
`ranked` AS (
  SELECT *, row_number() OVER (
    PARTITION BY `agent_id`, `realmroot`
    ORDER BY `priority`, `source_id`
  ) AS `binding_rank`
  FROM `candidates`
)
SELECT
  'identity_migrated_' || `source_id` AS `identity_id`, `agent_id`, `project_id`,
  `realmroot`, `created_at`, `updated_at`
FROM `ranked`
WHERE `binding_rank` = 1;

-- The guard gives conflict checks fail-fast CHECK semantics and is dropped
-- before any durable schema mutation begins.
CREATE TABLE `_identity_migration_guard` (
  `ok` integer NOT NULL,
  CONSTRAINT `identity_migration_conflict_run_preflight` CHECK (`ok` = 1)
);

-- One remote Realmroot identity must not be shared by multiple AMA Agents.
INSERT INTO `_identity_migration_guard` (`ok`)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM `_identity_migration_sources`
  GROUP BY json_extract(`realmroot`, '$.agentId'), json_extract(`realmroot`, '$.origin')
  HAVING count(DISTINCT `agent_id`) > 1
);

-- A Vault credential is installation-private and cannot back more than one
-- AMA Agent even if corrupt legacy descriptors disagree about the remote id.
INSERT INTO `_identity_migration_guard` (`ok`)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM `_identity_migration_sources`
  GROUP BY json_extract(`realmroot`, '$.credentialRef')
  HAVING count(DISTINCT `agent_id`) > 1
);

-- A single credential or Remote Agent cannot be moved into two dedicated
-- managed Vaults, even when corrupt descriptors belong to the same Agent.
INSERT INTO `_identity_migration_guard` (`ok`)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM `_identity_migration_sources`
  GROUP BY json_extract(`realmroot`, '$.credentialRef')
  HAVING count(*) > 1
);

INSERT INTO `_identity_migration_guard` (`ok`)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM `_identity_migration_sources`
  GROUP BY json_extract(`realmroot`, '$.agentId'), json_extract(`realmroot`, '$.origin')
  HAVING count(*) > 1
);

-- Malformed legacy descriptors cannot be migrated without inventing identity
-- or secret references, so fail instead of partially converting the data.
INSERT INTO `_identity_migration_guard` (`ok`)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM `_identity_migration_sources`
  WHERE nullif(json_extract(`realmroot`, '$.agentId'), '') IS NULL
    OR nullif(json_extract(`realmroot`, '$.origin'), '') IS NULL
    OR nullif(json_extract(`realmroot`, '$.credentialRef'), '') IS NULL
    OR instr(json_extract(`realmroot`, '$.credentialRef'), '/credentials/') = 0
);

-- A migrated Identity is runtime=ama; enabled triggers must already agree.
INSERT INTO `_identity_migration_guard` (`ok`)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM `triggers` t
  JOIN `agents` a ON a.`id` = t.`agent_id`
  WHERE a.`realmroot` IS NOT NULL
    AND t.`enabled` = 1
    AND t.`archived_at` IS NULL
    AND t.`runtime` <> 'ama'
);

DROP TABLE `_identity_migration_guard`;
--> statement-breakpoint
ALTER TABLE `vaults` ADD `managed_by` text CHECK (`managed_by` IS NULL OR `managed_by` = 'identity');
--> statement-breakpoint
CREATE TABLE `identities` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `username` text NOT NULL,
  `runtime` text NOT NULL CHECK (`runtime` in ('ama','claude-code','codex','copilot')),
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
  `archived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_identities_project_created` ON `identities` (`project_id`,`created_at`,`id`);
CREATE UNIQUE INDEX `idx_identities_project_idempotency` ON `identities` (`project_id`,`idempotency_key_hash`);
CREATE UNIQUE INDEX `idx_identities_remote_agent` ON `identities` (`remote_agent_id`);
CREATE INDEX `idx_identities_bound_agent` ON `identities` (`bound_agent_id`);
--> statement-breakpoint
ALTER TABLE `agents` ADD `identity_id` text REFERENCES `identities`(`id`);
ALTER TABLE `agents` ADD `identity_snapshot` text;
ALTER TABLE `agent_versions` ADD `identity_id` text REFERENCES `identities`(`id`);
ALTER TABLE `agent_versions` ADD `identity_snapshot` text;
--> statement-breakpoint
CREATE TRIGGER `agents_identity_bind_insert`
BEFORE INSERT ON `agents`
WHEN NEW.`identity_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `identities` i
    WHERE i.`id` = NEW.`identity_id`
      AND i.`project_id` = NEW.`project_id`
      AND i.`state` = 'active'
      AND i.`archived_at` IS NULL
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
      AND i.`archived_at` IS NULL
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
INSERT INTO `vaults` (
  `id`,`organization_id`,`project_id`,`name`,`description`,`scope`,`managed_by`,`archived_at`,`created_at`,`updated_at`
)
SELECT
  'vault_' || s.`identity_id`, p.`organization_id`, s.`project_id`,
  'Identity · ' || a.`name`, 'Managed Vault for migrated Identity ' || s.`identity_id`,
  'project', 'identity', NULL, s.`created_at`, s.`updated_at`
FROM `_identity_migration_sources` s
JOIN `agents` a ON a.`id` = s.`agent_id`
JOIN `projects` p ON p.`id` = a.`project_id`
;
--> statement-breakpoint
INSERT INTO `identities` (
  `id`,`project_id`,`organization_id`,`name`,`description`,`username`,`runtime`,`state`,
  `failure_code`,`vault_id`,`credential_id`,`remote_agent_id`,`issuer`,`subject`,`bound_agent_id`,
  `idempotency_key_hash`,`request_fingerprint`,`provisioning_owner`,`provisioning_lease_expires_at`,
  `archived_at`,`created_at`,`updated_at`
)
SELECT
  s.`identity_id`, s.`project_id`, p.`organization_id`, a.`name`, a.`description`,
  coalesce(json_extract(s.`realmroot`, '$.username'), 'migrated-' || substr(a.`id`, -12)),
  'ama', 'active', NULL, 'vault_' || s.`identity_id`,
  substr(
    json_extract(s.`realmroot`, '$.credentialRef'),
    instr(json_extract(s.`realmroot`, '$.credentialRef'), '/credentials/') + length('/credentials/')
  ),
  json_extract(s.`realmroot`, '$.agentId'),
  rtrim(json_extract(s.`realmroot`, '$.origin'), '/') || '/api/auth',
  json_extract(s.`realmroot`, '$.agentId'), a.`id`,
  'migration:' || s.`identity_id`, 'migration:' || s.`identity_id`, NULL, NULL,
  a.`archived_at`, s.`created_at`, s.`updated_at`
FROM `_identity_migration_sources` s
JOIN `agents` a ON a.`id` = s.`agent_id`
JOIN `projects` p ON p.`id` = a.`project_id`
;
--> statement-breakpoint
UPDATE `vault_credentials`
SET `vault_id` = (
      SELECT i.`vault_id` FROM `identities` i WHERE i.`credential_id` = `vault_credentials`.`id`
    ),
    `name` = 'Realmroot Agent state',
    `type` = 'ama.dev/realmroot-agent-state',
    `updated_at` = coalesce((SELECT i.`updated_at` FROM `identities` i WHERE i.`credential_id` = `vault_credentials`.`id`), `updated_at`)
WHERE `id` IN (SELECT `credential_id` FROM `identities` WHERE `credential_id` IS NOT NULL);

UPDATE `vault_credential_versions`
SET `vault_id` = (
  SELECT i.`vault_id` FROM `identities` i WHERE i.`credential_id` = `vault_credential_versions`.`credential_id`
)
WHERE `credential_id` IN (SELECT `credential_id` FROM `identities` WHERE `credential_id` IS NOT NULL);
--> statement-breakpoint
UPDATE `agents`
SET `identity_id` = (
      SELECT s.`identity_id` FROM `_identity_migration_sources` s
      WHERE s.`agent_id` = `agents`.`id` AND s.`realmroot` = `agents`.`realmroot`
    ),
    `identity_snapshot` = (
      SELECT json_object(
        'identityId', s.`identity_id`,
        'agentId', json_extract(s.`realmroot`, '$.agentId'),
        'issuer', rtrim(json_extract(s.`realmroot`, '$.origin'), '/') || '/api/auth',
        'subject', json_extract(s.`realmroot`, '$.agentId'),
        'username', coalesce(json_extract(s.`realmroot`, '$.username'), 'migrated-' || substr(`agents`.`id`, -12)),
        'runtime', 'ama',
        'credentialRef', 'ama://vaults/vault_' || s.`identity_id` || '/credentials/' || substr(
          json_extract(s.`realmroot`, '$.credentialRef'),
          instr(json_extract(s.`realmroot`, '$.credentialRef'), '/credentials/') + length('/credentials/')
        )
      )
      FROM `_identity_migration_sources` s
      WHERE s.`agent_id` = `agents`.`id` AND s.`realmroot` = `agents`.`realmroot`
    )
WHERE `realmroot` IS NOT NULL;

UPDATE `agent_versions`
SET `identity_id` = (
      SELECT s.`identity_id` FROM `_identity_migration_sources` s
      WHERE s.`agent_id` = `agent_versions`.`agent_id` AND s.`realmroot` = `agent_versions`.`realmroot`
    ),
    `identity_snapshot` = (
      SELECT json_object(
        'identityId', s.`identity_id`,
        'agentId', json_extract(s.`realmroot`, '$.agentId'),
        'issuer', rtrim(json_extract(s.`realmroot`, '$.origin'), '/') || '/api/auth',
        'subject', json_extract(s.`realmroot`, '$.agentId'),
        'username', coalesce(json_extract(s.`realmroot`, '$.username'), 'migrated-' || substr(`agent_versions`.`agent_id`, -12)),
        'runtime', 'ama',
        'credentialRef', 'ama://vaults/vault_' || s.`identity_id` || '/credentials/' || substr(
          json_extract(s.`realmroot`, '$.credentialRef'),
          instr(json_extract(s.`realmroot`, '$.credentialRef'), '/credentials/') + length('/credentials/')
        )
      )
      FROM `_identity_migration_sources` s
      WHERE s.`agent_id` = `agent_versions`.`agent_id` AND s.`realmroot` = `agent_versions`.`realmroot`
    )
WHERE `realmroot` IS NOT NULL;

UPDATE `sessions`
SET `agent_snapshot` = json_set(
  json_remove(`agent_snapshot`, '$.realmroot'),
  '$.identity',
  json((
    SELECT json_object(
      'identityId', s.`identity_id`,
      'agentId', json_extract(s.`realmroot`, '$.agentId'),
      'issuer', rtrim(json_extract(s.`realmroot`, '$.origin'), '/') || '/api/auth',
      'subject', json_extract(s.`realmroot`, '$.agentId'),
      'username', coalesce(json_extract(s.`realmroot`, '$.username'), 'migrated-' || substr(`sessions`.`agent_id`, -12)),
      'runtime', 'ama',
      'credentialRef', 'ama://vaults/vault_' || s.`identity_id` || '/credentials/' || substr(
        json_extract(s.`realmroot`, '$.credentialRef'),
        instr(json_extract(s.`realmroot`, '$.credentialRef'), '/credentials/') + length('/credentials/')
      )
    )
    FROM `_identity_migration_sources` s
    WHERE s.`agent_id` = `sessions`.`agent_id`
      AND s.`realmroot` = json_extract(`sessions`.`agent_snapshot`, '$.realmroot')
  ))
)
WHERE json_type(`agent_snapshot`, '$.realmroot') = 'object';

DROP TABLE `_identity_migration_sources`;
--> statement-breakpoint
ALTER TABLE `agents` DROP COLUMN `realmroot`;
ALTER TABLE `agent_versions` DROP COLUMN `realmroot`;
