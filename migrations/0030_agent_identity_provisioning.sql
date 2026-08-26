ALTER TABLE `agents` ADD `username` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `runtime` text NOT NULL DEFAULT 'codex';
ALTER TABLE `agents` ADD `identity_issuer` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `identity_subject` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `identity_credential_ref` text;
ALTER TABLE `agents` ADD `retirement_state` text;
ALTER TABLE `agents` ADD `retired_at` text;
ALTER TABLE `agents` DROP COLUMN `realmroot`;
ALTER TABLE `agent_versions` ADD `runtime` text NOT NULL DEFAULT 'codex';
ALTER TABLE `agent_versions` DROP COLUMN `realmroot`;

CREATE UNIQUE INDEX `idx_agents_identity` ON `agents` (`identity_issuer`,`identity_subject`);
CREATE UNIQUE INDEX `idx_agents_username_project` ON `agents` (`project_id`,`username`);
