import { env } from 'cloudflare:workers'
import type { Env } from '../env'

type PolicyScope =
  | { level: 'organization'; teamId?: never }
  | { level: 'project'; teamId?: never }
  | { level: 'team'; teamId: string }

interface SeedPolicyInput {
  authorization?: string
  organizationId?: string
  projectId?: string
  scope: PolicyScope
  toolPolicy?: Record<string, unknown>
  mcpPolicy?: Record<string, unknown>
  sandboxPolicy?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export async function seedPolicy(input: SeedPolicyInput) {
  const db = (env as unknown as Env).DB
  const organizationId = input.organizationId ?? organizationIdFromAuthorization(input.authorization)
  const projectId = input.projectId ?? (await resolveProjectId(db, organizationId))
  const timestamp = new Date().toISOString()
  const teamId = input.scope.level === 'team' ? input.scope.teamId : null

  await db
    .prepare(
      `DELETE FROM policies
     WHERE project_id = ?
       AND scope = ?
       AND ((? IS NULL AND team_id IS NULL) OR team_id = ?)`,
    )
    .bind(projectId, input.scope.level, teamId, teamId)
    .run()

  const policy = {
    id: `policy_${crypto.randomUUID().replaceAll('-', '')}`,
    organizationId,
    projectId,
    scope: input.scope.level,
    teamId,
    toolPolicy: input.toolPolicy ?? {},
    mcpPolicy: input.mcpPolicy ?? {},
    sandboxPolicy: input.sandboxPolicy ?? {},
    metadata: input.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await db
    .prepare(
      `INSERT INTO policies
       (id, organization_id, project_id, scope, team_id, tool_policy, mcp_policy, sandbox_policy, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      policy.id,
      policy.organizationId,
      policy.projectId,
      policy.scope,
      policy.teamId,
      JSON.stringify(policy.toolPolicy),
      JSON.stringify(policy.mcpPolicy),
      JSON.stringify(policy.sandboxPolicy),
      JSON.stringify(policy.metadata),
      policy.createdAt,
      policy.updatedAt,
    )
    .run()

  return policy
}

function organizationIdFromAuthorization(authorization?: string) {
  const match = /^Bearer\s+e2e:(?<spec>.+)$/.exec(authorization ?? '')
  if (!match?.groups?.spec) {
    return 'org_flare_123'
  }
  const [rawRunId = '', ...directiveParts] = match.groups.spec.split(';')
  const directives = new Map<string, string>()
  for (const part of directiveParts) {
    const separator = part.indexOf('=')
    if (separator > 0) {
      directives.set(part.slice(0, separator), part.slice(separator + 1))
    }
  }
  const sanitize = (value: string) => value.replaceAll(/[^A-Za-z0-9_-]/g, '_')
  const safeRunId = sanitize(rawRunId) || 'run'
  const safeOrgRunId = sanitize(directives.get('org') ?? '') || safeRunId
  return `org_e2e_${safeOrgRunId}`
}

async function resolveProjectId(db: Env['DB'], organizationId: string) {
  const existing = await db
    .prepare('SELECT id FROM projects WHERE organization_id = ? LIMIT 1')
    .bind(organizationId)
    .first<{ id: string }>()
  if (existing) {
    return existing.id
  }

  const timestamp = new Date().toISOString()
  const projectId = `project_${organizationId.replaceAll(/[^A-Za-z0-9_-]/g, '_')}`
  await db
    .prepare(
      `INSERT INTO projects (id, organization_id, name, created_at, updated_at)
     VALUES (?, ?, 'Default project', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    )
    .bind(projectId, organizationId, timestamp, timestamp)
    .run()
  return projectId
}
