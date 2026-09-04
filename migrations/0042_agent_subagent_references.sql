-- Promote legacy embedded sub-agent definitions into ordinary identityless
-- Agent resources. Agent and Agent Version specs retain only named references;
-- existing Session snapshots remain self-contained for replay.
CREATE TABLE `__legacy_agent_subagents_0042` (
  `source_agent_id` text NOT NULL,
  `source_version_id` text NOT NULL,
  `project_id` text NOT NULL,
  `position` integer NOT NULL,
  `name` text NOT NULL,
  `definition` text NOT NULL,
  `agent_id` text PRIMARY KEY NOT NULL,
  `agent_version_id` text NOT NULL,
  `created_at` text NOT NULL
);--> statement-breakpoint

INSERT INTO `__legacy_agent_subagents_0042` (
  `source_agent_id`, `source_version_id`, `project_id`, `position`, `name`, `definition`,
  `agent_id`, `agent_version_id`, `created_at`
)
SELECT
  av.`agent_id`, av.`id`, av.`project_id`, CAST(entry.`key` AS integer),
  json_extract(entry.`value`, '$.name'), json(entry.`value`),
  'migrated-subagent-' || av.`id` || '-' || entry.`key`,
  'migrated-subagent-version-' || av.`id` || '-' || entry.`key`,
  av.`created_at`
FROM `agent_versions` av, json_each(av.`subagents`) entry
WHERE json_type(entry.`value`) = 'object'
  AND json_extract(entry.`value`, '$.agentId') IS NULL;--> statement-breakpoint

INSERT INTO `agents` (
  `id`, `project_id`, `name`, `description`, `system_prompt`, `provider_id`, `model`,
  `skills`, `subagents`, `allowed_tools`, `mcp_connectors`, `identity_id`, `identity_snapshot`,
  `deleted_at`, `current_version_id`, `created_at`, `updated_at`
)
SELECT
  legacy.`agent_id`, legacy.`project_id`, legacy.`name`,
  coalesce(json_extract(legacy.`definition`, '$.description'), json_extract(legacy.`definition`, '$.bio')),
  coalesce(json_extract(legacy.`definition`, '$.systemPrompt'), json_extract(legacy.`definition`, '$.instructions')),
  NULL, json_extract(legacy.`definition`, '$.model'),
  coalesce(json_extract(legacy.`definition`, '$.skills'), '[]'), '[]',
  coalesce(json_extract(legacy.`definition`, '$.allowedTools'), '[]'),
  coalesce(json_extract(legacy.`definition`, '$.mcpConnectors'), '[]'),
  NULL, NULL, NULL, legacy.`agent_version_id`, legacy.`created_at`, legacy.`created_at`
FROM `__legacy_agent_subagents_0042` legacy;--> statement-breakpoint

INSERT INTO `agent_versions` (
  `id`, `agent_id`, `project_id`, `version`, `system_prompt`, `provider_id`, `model`,
  `skills`, `subagents`, `allowed_tools`, `mcp_connectors`, `identity_id`, `identity_snapshot`, `created_at`
)
SELECT
  legacy.`agent_version_id`, legacy.`agent_id`, legacy.`project_id`, 1,
  coalesce(json_extract(legacy.`definition`, '$.systemPrompt'), json_extract(legacy.`definition`, '$.instructions')),
  NULL, json_extract(legacy.`definition`, '$.model'),
  coalesce(json_extract(legacy.`definition`, '$.skills'), '[]'), '[]',
  coalesce(json_extract(legacy.`definition`, '$.allowedTools'), '[]'),
  coalesce(json_extract(legacy.`definition`, '$.mcpConnectors'), '[]'),
  NULL, NULL, legacy.`created_at`
FROM `__legacy_agent_subagents_0042` legacy;--> statement-breakpoint

UPDATE `sessions`
SET `agent_snapshot` = json_set(
  `agent_snapshot`,
  '$.subagents',
  json(coalesce((
    SELECT json_group_array(json(patched.`snapshot`))
    FROM (
      SELECT json_set(
        entry.`value`,
        '$.agentId', legacy.`agent_id`,
        '$.agentVersionId', legacy.`agent_version_id`,
        '$.version', 1,
        '$.name', legacy.`name`,
        '$.provider', NULL
      ) AS `snapshot`
      FROM json_each(json_extract(`sessions`.`agent_snapshot`, '$.subagents')) entry
      JOIN `__legacy_agent_subagents_0042` legacy
        ON legacy.`source_version_id` = coalesce(`sessions`.`agent_version_id`, json_extract(`sessions`.`agent_snapshot`, '$.id'))
       AND legacy.`position` = CAST(entry.`key` AS integer)
      ORDER BY CAST(entry.`key` AS integer)
    ) patched
  ), '[]'))
)
WHERE `agent_snapshot` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM json_each(json_extract(`sessions`.`agent_snapshot`, '$.subagents')) entry
    JOIN `__legacy_agent_subagents_0042` legacy
      ON legacy.`source_version_id` = coalesce(`sessions`.`agent_version_id`, json_extract(`sessions`.`agent_snapshot`, '$.id'))
     AND legacy.`position` = CAST(entry.`key` AS integer)
    WHERE json_extract(entry.`value`, '$.agentId') IS NULL
  );--> statement-breakpoint

UPDATE `agent_versions`
SET `subagents` = coalesce((
  SELECT json_group_array(json(reference.`value`))
  FROM (
    SELECT json_object(
      'agentId', coalesce(json_extract(entry.`value`, '$.agentId'), legacy.`agent_id`),
      'name', coalesce(legacy.`name`, json_extract(entry.`value`, '$.name'))
    ) AS `value`
    FROM json_each(`agent_versions`.`subagents`) entry
    LEFT JOIN `__legacy_agent_subagents_0042` legacy
      ON legacy.`source_version_id` = `agent_versions`.`id`
     AND legacy.`position` = CAST(entry.`key` AS integer)
    ORDER BY CAST(entry.`key` AS integer)
  ) reference
), '[]')
WHERE json_array_length(`subagents`) > 0;--> statement-breakpoint

UPDATE `agents`
SET `subagents` = coalesce((
  SELECT version.`subagents`
  FROM `agent_versions` version
  WHERE version.`id` = `agents`.`current_version_id`
), '[]');--> statement-breakpoint

DROP TABLE `__legacy_agent_subagents_0042`;
