WITH ranked_defaults AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS default_rank
  FROM projects
  WHERE name = 'Default'
)
UPDATE projects
SET name = 'Default Copy ' || substr(id, 1, 8),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  SELECT id
  FROM ranked_defaults
  WHERE default_rank > 1
);

INSERT INTO projects (id, organization_id, name, created_at, updated_at)
SELECT
  'default_' || lower(hex(randomblob(16))),
  organizations.organization_id,
  'Default',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT DISTINCT organization_id
  FROM projects
) AS organizations
WHERE NOT EXISTS (
  SELECT 1
  FROM projects
  WHERE projects.organization_id = organizations.organization_id
    AND projects.name = 'Default'
);

CREATE UNIQUE INDEX idx_projects_one_default_per_organization
ON projects (organization_id)
WHERE name = 'Default';
