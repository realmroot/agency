-- Preserve the subject Inbox last confirmed for callback admission while
-- reconciling the current Realmroot Identity subject across a non-atomic
-- service boundary. Existing active Subscriptions were provisioned with the
-- legacy internal Identity resource id, so backfill exactly that value.
ALTER TABLE `triggers` ADD COLUMN `inbox_registered_agent_subject` text;--> statement-breakpoint
UPDATE `triggers`
SET `inbox_registered_agent_subject` = (
	SELECT json_extract(`agents`.`identity_snapshot`, '$.agentId')
	FROM `agents`
	WHERE `agents`.`id` = `triggers`.`agent_id`
)
WHERE `trigger_type` = 'inbox'
	AND `inbox_provisioning_state` = 'active';
