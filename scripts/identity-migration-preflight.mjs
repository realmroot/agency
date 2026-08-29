import { execFileSync } from 'node:child_process'

const database = argument('--database')
if (!database) {
  throw new Error('Usage: pnpm identity:migration:preflight -- --database <D1 database> [--remote] [--env <name>]')
}

const sql = String.raw`
WITH candidates AS (
  SELECT 'agent:' || a.id AS source_id, a.id AS agent_id, a.realmroot AS descriptor
  FROM agents a WHERE a.realmroot IS NOT NULL
  UNION ALL
  SELECT 'version:' || v.id, v.agent_id, v.realmroot
  FROM agent_versions v WHERE v.realmroot IS NOT NULL
  UNION ALL
  SELECT 'session:' || s.id, s.agent_id, json_extract(s.agent_snapshot, '$.realmroot')
  FROM sessions s WHERE json_type(s.agent_snapshot, '$.realmroot') = 'object'
), sources AS (
  SELECT agent_id, descriptor, min(source_id) AS source_id
  FROM candidates GROUP BY agent_id, descriptor
), conflicts AS (
  SELECT
    'shared_remote_identity' AS category,
    group_concat(DISTINCT agent_id) AS agent_ids,
    group_concat(source_id) AS source_ids,
    json_extract(descriptor, '$.agentId') AS resource_id,
    'Remote identity is used by multiple AMA Agents' AS detail
  FROM sources
  GROUP BY json_extract(descriptor, '$.agentId'), json_extract(descriptor, '$.origin')
  HAVING count(DISTINCT agent_id) > 1
  UNION ALL
  SELECT
    'shared_credential', group_concat(DISTINCT agent_id), group_concat(source_id), NULL,
    'Realmroot credential is used by multiple AMA Agents'
  FROM sources
  GROUP BY json_extract(descriptor, '$.credentialRef')
  HAVING count(DISTINCT agent_id) > 1
  UNION ALL
  SELECT
    'credential_multiple_descriptors', group_concat(DISTINCT agent_id), group_concat(source_id), NULL,
    'One credential maps to multiple full descriptors and cannot be split into dedicated Vaults'
  FROM sources
  GROUP BY json_extract(descriptor, '$.credentialRef')
  HAVING count(*) > 1
  UNION ALL
  SELECT
    'remote_multiple_descriptors', group_concat(DISTINCT agent_id), group_concat(source_id),
    json_extract(descriptor, '$.agentId'),
    'One Remote identity maps to multiple full descriptors'
  FROM sources
  GROUP BY json_extract(descriptor, '$.agentId'), json_extract(descriptor, '$.origin')
  HAVING count(*) > 1
  UNION ALL
  SELECT
    'malformed_descriptor', agent_id, source_id, NULL,
    'Legacy descriptor is missing agentId, origin, or a credential reference'
  FROM sources
  WHERE nullif(json_extract(descriptor, '$.agentId'), '') IS NULL
    OR nullif(json_extract(descriptor, '$.origin'), '') IS NULL
    OR nullif(json_extract(descriptor, '$.credentialRef'), '') IS NULL
    OR instr(json_extract(descriptor, '$.credentialRef'), '/credentials/') = 0
  UNION ALL
  SELECT
    'trigger_runtime_mismatch', a.id, 'trigger:' || t.id, t.id,
    'Active Trigger runtime ' || t.runtime || ' conflicts with migrated Identity runtime ama'
  FROM triggers t
  JOIN agents a ON a.id = t.agent_id
  WHERE a.realmroot IS NOT NULL AND t.enabled = 1 AND t.archived_at IS NULL AND t.runtime <> 'ama'
)
SELECT category, agent_ids, source_ids, resource_id, detail
FROM conflicts
ORDER BY category, agent_ids, source_ids;
`

const args = ['d1', 'execute', database, '--command', sql, '--json']
if (process.argv.includes('--remote')) args.push('--remote')
const environment = argument('--env')
if (environment) args.push('--env', environment)

const output = execFileSync('wrangler', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
const payload = JSON.parse(output)
const envelopes = Array.isArray(payload) ? payload : [payload]
const conflicts = envelopes.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []))

if (conflicts.length === 0) {
  console.log('Identity migration preflight passed: no conflicts found.')
} else {
  console.error(`Identity migration preflight failed: ${conflicts.length} conflict(s).`)
  for (const conflict of conflicts) console.error(JSON.stringify(conflict))
  process.exitCode = 1
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
