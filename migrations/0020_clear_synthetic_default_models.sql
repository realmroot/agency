UPDATE `agents`
SET `model` = NULL
WHERE `model` = 'default';
--> statement-breakpoint
UPDATE `agent_versions`
SET `model` = NULL
WHERE `model` = 'default';
