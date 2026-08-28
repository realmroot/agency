ALTER TABLE `web_authorization_attempts` ADD `client_key` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_web_authorization_attempts_client_expires` ON `web_authorization_attempts` (`client_key`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER `limit_web_authorization_attempts_per_client`
BEFORE INSERT ON `web_authorization_attempts`
WHEN (
	SELECT count(*) FROM `web_authorization_attempts`
	WHERE `client_key` = NEW.`client_key`
	AND `expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) >= 32
BEGIN
	SELECT RAISE(ABORT, 'web authorization attempt rate limit');
END;
