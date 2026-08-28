ALTER TABLE `agents` ADD `username` text;
ALTER TABLE `agents` ADD `runtime` text;
ALTER TABLE `agents` ADD `identity_issuer` text;
ALTER TABLE `agents` ADD `identity_subject` text;
ALTER TABLE `agents` ADD `identity_credential_ref` text;

ALTER TABLE `agent_versions` ADD `runtime` text;

CREATE INDEX `idx_sessions_agent_created` ON `sessions` (`agent_id`,`created_at`,`id`);

-- Runtime becomes an immutable Agent attribute. Prefer the most recent
-- historical Session runtime that is compatible with the Agent's current
-- provider and model. Otherwise map the provider to its native runtime; AMA is
-- the provider-agnostic fallback.
UPDATE `agents`
SET `runtime` = (
  SELECT json_extract(`sessions`.`metadata`, '$.runtime')
  FROM `sessions`
  WHERE `sessions`.`agent_id` = `agents`.`id`
    AND json_extract(`sessions`.`metadata`, '$.runtime') IN ('ama', 'claude-code', 'codex', 'copilot')
    AND (
      json_extract(`sessions`.`metadata`, '$.runtime') = 'ama'
      OR (
        json_extract(`sessions`.`metadata`, '$.runtime') = 'claude-code'
        AND `agents`.`provider_id` = 'anthropic'
        AND (`agents`.`model` IS NULL OR instr(`agents`.`model`, '/') = 0 OR `agents`.`model` LIKE 'anthropic/%')
      )
      OR (
        json_extract(`sessions`.`metadata`, '$.runtime') = 'codex'
        AND `agents`.`provider_id` = 'openai'
        AND (`agents`.`model` IS NULL OR instr(`agents`.`model`, '/') = 0 OR `agents`.`model` LIKE 'openai/%')
      )
      OR (
        json_extract(`sessions`.`metadata`, '$.runtime') = 'copilot'
        AND `agents`.`provider_id` = 'github-copilot'
        AND (`agents`.`model` IS NULL OR instr(`agents`.`model`, '/') = 0 OR `agents`.`model` LIKE 'github-copilot/%')
      )
    )
  ORDER BY `sessions`.`created_at` DESC, `sessions`.`id` DESC
  LIMIT 1
);

UPDATE `agents`
SET `runtime` = CASE `provider_id`
  WHEN 'anthropic' THEN 'claude-code'
  WHEN 'openai' THEN 'codex'
  WHEN 'github-copilot' THEN 'copilot'
  ELSE 'ama'
END
WHERE `runtime` IS NULL;

UPDATE `agent_versions`
SET `runtime` = (
  SELECT `agents`.`runtime`
  FROM `agents`
  WHERE `agents`.`id` = `agent_versions`.`agent_id`
);

-- Trigger runtime is a derived execution snapshot, never caller input. Align
-- existing rows with the newly authoritative Agent runtime.
UPDATE `triggers`
SET `runtime` = (
  SELECT `agents`.`runtime`
  FROM `agents`
  WHERE `agents`.`id` = `triggers`.`agent_id`
);

CREATE TRIGGER `agents_runtime_required_insert`
BEFORE INSERT ON `agents`
WHEN NEW.`runtime` IS NULL OR NEW.`runtime` NOT IN ('ama', 'claude-code', 'codex', 'copilot')
BEGIN
  SELECT RAISE(ABORT, 'agents.runtime is required and must be supported');
END;

CREATE TRIGGER `agents_runtime_immutable_update`
BEFORE UPDATE OF `runtime` ON `agents`
WHEN NEW.`runtime` IS NULL
  OR NEW.`runtime` NOT IN ('ama', 'claude-code', 'codex', 'copilot')
  OR NEW.`runtime` <> OLD.`runtime`
BEGIN
  SELECT RAISE(ABORT, 'agents.runtime is immutable');
END;

CREATE TRIGGER `agents_identity_complete_insert`
BEFORE INSERT ON `agents`
WHEN ((NEW.`username` IS NOT NULL) + (NEW.`identity_issuer` IS NOT NULL) +
      (NEW.`identity_subject` IS NOT NULL) + (NEW.`identity_credential_ref` IS NOT NULL)) NOT IN (0, 4)
BEGIN
  SELECT RAISE(ABORT, 'agents identity must be entirely absent or complete');
END;

CREATE TRIGGER `agents_identity_complete_update`
BEFORE UPDATE OF `username`, `identity_issuer`, `identity_subject`, `identity_credential_ref` ON `agents`
WHEN ((NEW.`username` IS NOT NULL) + (NEW.`identity_issuer` IS NOT NULL) +
      (NEW.`identity_subject` IS NOT NULL) + (NEW.`identity_credential_ref` IS NOT NULL)) NOT IN (0, 4)
BEGIN
  SELECT RAISE(ABORT, 'agents identity must be entirely absent or complete');
END;

CREATE TRIGGER `agent_versions_runtime_required_insert`
BEFORE INSERT ON `agent_versions`
WHEN NEW.`runtime` IS NULL OR NEW.`runtime` NOT IN ('ama', 'claude-code', 'codex', 'copilot')
BEGIN
  SELECT RAISE(ABORT, 'agent_versions.runtime is required and must be supported');
END;

CREATE TRIGGER `agent_versions_runtime_immutable_update`
BEFORE UPDATE OF `runtime` ON `agent_versions`
WHEN NEW.`runtime` IS NULL
  OR NEW.`runtime` NOT IN ('ama', 'claude-code', 'codex', 'copilot')
  OR NEW.`runtime` <> OLD.`runtime`
BEGIN
  SELECT RAISE(ABORT, 'agent_versions.runtime is immutable');
END;

CREATE UNIQUE INDEX `idx_agents_identity` ON `agents` (`identity_issuer`,`identity_subject`)
  WHERE `identity_issuer` IS NOT NULL AND `identity_subject` IS NOT NULL;
CREATE UNIQUE INDEX `idx_agents_username_project` ON `agents` (`project_id`,`username`)
  WHERE `username` IS NOT NULL;
