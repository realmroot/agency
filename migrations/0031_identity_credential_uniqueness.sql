CREATE UNIQUE INDEX `idx_vault_credentials_identity_purpose`
ON `vault_credentials` (
  `vault_id`,
  json_extract(`metadata`, '$.managedBy'),
  json_extract(`metadata`, '$.identityId'),
  coalesce(
    json_extract(`metadata`, '$.purpose'),
    CASE WHEN `type` = 'ama.dev/realmroot-agent-state' THEN 'agent-state' END
  )
)
WHERE json_extract(`metadata`, '$.managedBy') = 'identity';
