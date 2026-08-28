ALTER TABLE `agents` ADD `username` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `runtime` text NOT NULL DEFAULT 'codex';
ALTER TABLE `agents` ADD `identity_issuer` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `identity_subject` text NOT NULL DEFAULT '';
ALTER TABLE `agents` ADD `identity_credential_ref` text;
ALTER TABLE `agents` ADD `retirement_state` text;
ALTER TABLE `agents` ADD `retired_at` text;

ALTER TABLE `agent_versions` ADD `runtime` text NOT NULL DEFAULT 'codex';

-- Legacy bindings deliberately remain in place. Their protocol agentId is not
-- Realmroot's stable identity.subject, so a later application-level backfill
-- must decrypt state.json before these columns can be contracted safely.
CREATE UNIQUE INDEX `idx_agents_identity` ON `agents` (`identity_issuer`,`identity_subject`)
  WHERE `identity_issuer` <> '' AND `identity_subject` <> '';
CREATE UNIQUE INDEX `idx_agents_username_project` ON `agents` (`project_id`,`username`)
  WHERE `username` <> '';
