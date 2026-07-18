ALTER TABLE `runners` RENAME COLUMN `runtime_inventory` TO `runtimes`;
--> statement-breakpoint
ALTER TABLE `runners` DROP COLUMN `capabilities`;
