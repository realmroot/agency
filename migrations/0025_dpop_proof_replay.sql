CREATE TABLE `dpop_proofs` (
  `issuer` text NOT NULL,
  `key_thumbprint` text NOT NULL,
  `jti` text NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text NOT NULL,
  PRIMARY KEY (`issuer`, `key_thumbprint`, `jti`)
);
--> statement-breakpoint
CREATE INDEX `idx_dpop_proofs_expires_at` ON `dpop_proofs` (`expires_at`);
