WITH RECURSIVE ranked_names AS (
  SELECT
    id,
    organization_id,
    name,
    row_number() OVER (PARTITION BY organization_id, name ORDER BY created_at, id) AS name_rank
  FROM projects
),
duplicates AS (
  SELECT id, organization_id, name
  FROM ranked_names
  WHERE name_rank > 1
),
candidates (id, organization_id, original_name, suffix, candidate_name) AS (
  SELECT
    id,
    organization_id,
    name,
    0,
    substr(name, 1, max(1, 114 - length(id))) || ' Copy ' || id
  FROM duplicates

  UNION ALL

  SELECT
    candidates.id,
    candidates.organization_id,
    candidates.original_name,
    candidates.suffix + 1,
    substr(
      candidates.original_name,
      1,
      max(1, 113 - length(candidates.id) - length(candidates.suffix + 1))
    ) || ' Copy ' || candidates.id || ' ' || (candidates.suffix + 1)
  FROM candidates
  WHERE EXISTS (
    SELECT 1
    FROM projects existing
    WHERE existing.organization_id = candidates.organization_id
      AND existing.name = candidates.candidate_name
  )
),
available_names AS (
  SELECT candidates.id, candidates.candidate_name
  FROM candidates
  WHERE NOT EXISTS (
    SELECT 1
    FROM projects existing
    WHERE existing.organization_id = candidates.organization_id
      AND existing.name = candidates.candidate_name
  )
)
UPDATE projects
SET name = (
      SELECT available_names.candidate_name
      FROM available_names
      WHERE available_names.id = projects.id
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  SELECT id
  FROM duplicates
);

DROP INDEX idx_projects_one_default_per_organization;

CREATE UNIQUE INDEX idx_projects_unique_name_per_organization
ON projects (organization_id, name);
