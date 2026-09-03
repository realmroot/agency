ALTER TABLE `projects` ADD `deleted_at` text;

ALTER TABLE `identities` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `agents` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `memory_stores` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `environments` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `vaults` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `sessions` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `triggers` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `runners` RENAME COLUMN `archived_at` TO `deleted_at`;
ALTER TABLE `budgets` ADD `deleted_at` text;
ALTER TABLE `memory_store_memories` ADD `deleted_at` text;

-- A previously archived store becomes an irreversible tombstone in this
-- migration, so every child that disappeared with it must become a tombstone
-- too. This keeps migrated state consistent with the new cascading DELETE.
UPDATE `memory_store_memories`
SET
  `deleted_at` = (
    SELECT `memory_stores`.`deleted_at`
    FROM `memory_stores`
    WHERE `memory_stores`.`id` = `memory_store_memories`.`store_id`
  ),
  `updated_at` = max(
    `updated_at`,
    (
      SELECT `memory_stores`.`deleted_at`
      FROM `memory_stores`
      WHERE `memory_stores`.`id` = `memory_store_memories`.`store_id`
    )
  )
WHERE EXISTS (
  SELECT 1
  FROM `memory_stores`
  WHERE `memory_stores`.`id` = `memory_store_memories`.`store_id`
    AND `memory_stores`.`deleted_at` IS NOT NULL
);

DROP INDEX `idx_projects_unique_name_per_organization`;
CREATE UNIQUE INDEX `idx_projects_unique_live_name_per_organization`
  ON `projects` (`organization_id`, `name`)
  WHERE `deleted_at` IS NULL;

DROP INDEX `idx_memory_store_memories_store_path`;
CREATE UNIQUE INDEX `idx_memory_store_memories_unique_live_store_path`
  ON `memory_store_memories` (`store_id`, `path`)
  WHERE `deleted_at` IS NULL;

CREATE TRIGGER trg_projects_reject_restore
BEFORE UPDATE OF deleted_at ON projects
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_memory_store_memories_reject_live_insert_on_deleted_project
BEFORE INSERT ON memory_store_memories
WHEN NEW.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_memory_store_memories_reject_live_update_on_deleted_project
BEFORE UPDATE ON memory_store_memories
WHEN NEW.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_memory_store_memories_reject_live_insert_on_deleted_store
BEFORE INSERT ON memory_store_memories
WHEN NEW.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM memory_stores WHERE id = NEW.store_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live memory to a deleted memory store');
END;

CREATE TRIGGER trg_memory_store_memories_reject_live_update_on_deleted_store
BEFORE UPDATE ON memory_store_memories
WHEN NEW.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM memory_stores WHERE id = NEW.store_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live memory to a deleted memory store');
END;

CREATE TRIGGER trg_memory_store_memories_reject_restore
BEFORE UPDATE OF deleted_at ON memory_store_memories
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

-- A soft-deleted Project cannot acquire a new live product resource, even
-- when a previously authorized request races with Project deletion.
CREATE TRIGGER trg_agents_reject_live_insert_on_deleted_project
BEFORE INSERT ON agents
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_agents_reject_live_update_on_deleted_project
BEFORE UPDATE ON agents
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_agents_reject_restore
BEFORE UPDATE OF deleted_at ON agents
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_budgets_reject_live_insert_on_deleted_project
BEFORE INSERT ON budgets
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_budgets_reject_live_update_on_deleted_project
BEFORE UPDATE ON budgets
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_budgets_reject_restore
BEFORE UPDATE OF deleted_at ON budgets
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_environments_reject_live_insert_on_deleted_project
BEFORE INSERT ON environments
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_environments_reject_live_update_on_deleted_project
BEFORE UPDATE ON environments
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_environments_reject_restore
BEFORE UPDATE OF deleted_at ON environments
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_identities_reject_live_insert_on_deleted_project
BEFORE INSERT ON identities
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_identities_reject_live_update_on_deleted_project
BEFORE UPDATE ON identities
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_identities_reject_restore
BEFORE UPDATE OF deleted_at ON identities
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_memory_stores_reject_live_insert_on_deleted_project
BEFORE INSERT ON memory_stores
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_memory_stores_reject_live_update_on_deleted_project
BEFORE UPDATE ON memory_stores
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_memory_stores_reject_restore
BEFORE UPDATE OF deleted_at ON memory_stores
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_runners_reject_live_insert_on_deleted_project
BEFORE INSERT ON runners
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_runners_reject_live_update_on_deleted_project
BEFORE UPDATE ON runners
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_runners_reject_restore
BEFORE UPDATE OF deleted_at ON runners
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_sessions_reject_live_insert_on_deleted_project
BEFORE INSERT ON sessions
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_sessions_reject_live_update_on_deleted_project
BEFORE UPDATE ON sessions
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_sessions_reject_restore
BEFORE UPDATE OF deleted_at ON sessions
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_triggers_reject_live_insert_on_deleted_project
BEFORE INSERT ON triggers
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_triggers_reject_live_update_on_deleted_project
BEFORE UPDATE ON triggers
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_triggers_reject_restore
BEFORE UPDATE OF deleted_at ON triggers
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;

CREATE TRIGGER trg_trigger_runs_reject_insert_on_deleted_trigger
BEFORE INSERT ON trigger_runs
WHEN EXISTS (SELECT 1 FROM triggers WHERE id = NEW.trigger_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot dispatch a deleted trigger');
END;

CREATE TRIGGER trg_vaults_reject_live_insert_on_deleted_project
BEFORE INSERT ON vaults
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_vaults_reject_live_update_on_deleted_project
BEFORE UPDATE ON vaults
WHEN NEW.deleted_at IS NULL
  AND NEW.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live resource to a deleted project');
END;

CREATE TRIGGER trg_vaults_reject_restore
BEFORE UPDATE OF deleted_at ON vaults
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deleted resources cannot be restored');
END;
