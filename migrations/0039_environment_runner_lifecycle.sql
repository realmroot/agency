-- Refuse to normalize historical orphans while work may still be in flight.
-- A successful migration therefore proves that every live Runner below a
-- deleted Environment is safe to tombstone; it never leaves an invalid live
-- child behind silently.
CREATE TRIGGER trg_environment_runner_migration_guard
BEFORE UPDATE OF updated_at ON runners
WHEN OLD.deleted_at IS NULL
  AND OLD.environment_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM environments
    WHERE environments.id = OLD.environment_id
      AND environments.project_id = OLD.project_id
      AND environments.deleted_at IS NOT NULL
  )
  AND (
    OLD.current_load > 0
    OR EXISTS (
      SELECT 1
      FROM leases
      WHERE leases.runner_id = OLD.id
        AND leases.project_id = OLD.project_id
        AND leases.state = 'active'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot migrate a busy runner under a deleted environment');
END;

UPDATE runners
SET updated_at = updated_at
WHERE deleted_at IS NULL
  AND environment_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM environments
    WHERE environments.id = runners.environment_id
      AND environments.project_id = runners.project_id
      AND environments.deleted_at IS NOT NULL
  );

DROP TRIGGER trg_environment_runner_migration_guard;

-- Existing idle Runner rows attached to deleted Environments are lifecycle
-- leftovers from the pre-cascade behavior. Preserve their records as matching
-- tombstones so they no longer block Project deletion.
UPDATE `runners`
SET
  `deleted_at` = (
    SELECT `environments`.`deleted_at`
    FROM `environments`
    WHERE `environments`.`id` = `runners`.`environment_id`
      AND `environments`.`project_id` = `runners`.`project_id`
  ),
  `updated_at` = max(
    `updated_at`,
    (
      SELECT `environments`.`deleted_at`
      FROM `environments`
      WHERE `environments`.`id` = `runners`.`environment_id`
        AND `environments`.`project_id` = `runners`.`project_id`
    )
  ),
  `state` = 'disabled'
WHERE `deleted_at` IS NULL
  AND `environment_id` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `environments`
    WHERE `environments`.`id` = `runners`.`environment_id`
      AND `environments`.`project_id` = `runners`.`project_id`
      AND `environments`.`deleted_at` IS NOT NULL
  );

CREATE TRIGGER trg_runners_reject_live_insert_on_deleted_environment
BEFORE INSERT ON runners
WHEN NEW.deleted_at IS NULL
  AND NEW.environment_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM environments
    WHERE id = NEW.environment_id
      AND project_id = NEW.project_id
      AND deleted_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live runner to a deleted environment');
END;

CREATE TRIGGER trg_runners_reject_live_update_on_deleted_environment
BEFORE UPDATE OF environment_id, deleted_at ON runners
WHEN NEW.deleted_at IS NULL
  AND NEW.environment_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM environments
    WHERE id = NEW.environment_id
      AND project_id = NEW.project_id
      AND deleted_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot attach a live runner to a deleted environment');
END;
