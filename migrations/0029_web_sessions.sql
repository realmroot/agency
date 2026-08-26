CREATE TABLE `web_auth_attempts` (
  `id_hash` text PRIMARY KEY NOT NULL,
  `state_hash` text NOT NULL UNIQUE,
  `nonce` text NOT NULL,
  `pkce_verifier` text NOT NULL,
  `return_to` text NOT NULL,
  `expires_at` text NOT NULL
);
CREATE INDEX `idx_web_auth_attempts_expiry` ON `web_auth_attempts` (`expires_at`);

CREATE TABLE `web_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `auth_json` text NOT NULL,
  `csrf_token` text NOT NULL,
  `expires_at` text NOT NULL,
  `rr_refresh_ciphertext` text NOT NULL,
  `rr_refresh_nonce` text NOT NULL,
  `rr_access_ciphertext` text NOT NULL,
  `rr_access_nonce` text NOT NULL,
  `rr_access_expires_at` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX `idx_web_sessions_expiry` ON `web_sessions` (`expires_at`);
