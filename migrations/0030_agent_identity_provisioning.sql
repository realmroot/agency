ALTER TABLE `agents` ADD `username` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `runtime` text NOT NULL DEFAULT 'codex';
ALTER TABLE `agents` ADD `identity_issuer` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `identity_subject` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `identity_credential_ref` text;
ALTER TABLE `agents` ADD `retirement_state` text;
ALTER TABLE `agents` ADD `retired_at` text;

UPDATE `agents`
SET
  `username` = 'legacy-' || lower(replace(`id`, '_', '-')),
  `identity_issuer` = CASE
    WHEN json_valid(`realmroot`) AND nullif(json_extract(`realmroot`, '$.origin'), '') IS NOT NULL
      THEN rtrim(json_extract(`realmroot`, '$.origin'), '/') || '/api/auth'
    ELSE 'urn:ama:legacy:unbound'
  END,
  `identity_subject` = CASE
    WHEN json_valid(`realmroot`) AND nullif(json_extract(`realmroot`, '$.agentId'), '') IS NOT NULL
      THEN json_extract(`realmroot`, '$.agentId')
    ELSE `id`
  END,
  `identity_credential_ref` = CASE
    WHEN json_valid(`realmroot`) THEN nullif(json_extract(`realmroot`, '$.credentialRef'), '')
    ELSE NULL
  END;

ALTER TABLE `agents` DROP COLUMN `realmroot`;
ALTER TABLE `agent_versions` ADD `runtime` text NOT NULL DEFAULT 'codex';
ALTER TABLE `agent_versions` DROP COLUMN `realmroot`;

CREATE UNIQUE INDEX `idx_agents_identity` ON `agents` (`identity_issuer`,`identity_subject`);
CREATE UNIQUE INDEX `idx_agents_username_project` ON `agents` (`project_id`,`username`);
