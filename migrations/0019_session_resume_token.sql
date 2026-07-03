ALTER TABLE `sessions` RENAME COLUMN `pi_runtime_id` TO `resume_token`;
ALTER TABLE `sessions` DROP COLUMN `pi_process_id`;
