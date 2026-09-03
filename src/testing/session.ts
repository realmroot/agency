import type { Session, SessionAgentSnapshot, SessionEnvironmentSnapshot, SessionState } from '@/lib/enborrpc'

type SessionFixtureFields = {
  id: string
  projectId: string
  agentId: string
  environmentId: string | null
  environmentVersionId: string | null
  agentSnapshot: SessionAgentSnapshot
  environmentSnapshot: SessionEnvironmentSnapshot | null
  name: string | null
  phase: SessionState
  reason: string | null
  startedAt: string | null
  closedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

type SessionShapeOverrides = Omit<Partial<Session>, 'metadata' | 'spec' | 'status'> & {
  metadata?: Partial<Session['metadata']>
  spec?: Partial<Session['spec']>
  status?: Partial<Session['status']> & {
    bindings?: Partial<Session['status']['bindings']> & {
      agent?: Partial<Session['status']['bindings']['agent']>
      environment?: Partial<Session['status']['bindings']['environment']>
    }
  }
}

export type TestSessionOverrides = SessionShapeOverrides &
  Partial<
    Pick<
      SessionFixtureFields,
      | 'id'
      | 'projectId'
      | 'agentId'
      | 'environmentId'
      | 'agentSnapshot'
      | 'environmentSnapshot'
      | 'environmentVersionId'
      | 'name'
      | 'phase'
      | 'reason'
      | 'startedAt'
      | 'closedAt'
      | 'archivedAt'
      | 'createdAt'
      | 'updatedAt'
    >
  >

const now = '2026-05-23T00:00:00.000Z'

export function buildTestSession(overrides: TestSessionOverrides = {}): Session {
  const uid = overrides.id ?? overrides.metadata?.uid ?? 'session_1'
  const projectId = overrides.projectId ?? overrides.metadata?.projectId ?? 'project_1'
  const agentId = overrides.agentId ?? overrides.spec?.agentId ?? 'agent_1'
  const environmentId =
    overrides.environmentId !== undefined ? overrides.environmentId : (overrides.spec?.environmentId ?? 'env_1')
  const phase = overrides.phase ?? overrides.status?.phase ?? 'idle'
  const reason = overrides.reason ?? overrides.status?.reason ?? null
  const startedAt = overrides.startedAt !== undefined ? overrides.startedAt : (overrides.status?.startedAt ?? now)
  const closedAt = overrides.closedAt !== undefined ? overrides.closedAt : (overrides.status?.closedAt ?? null)
  const createdAt = overrides.createdAt ?? overrides.metadata?.createdAt ?? now
  const updatedAt = overrides.updatedAt ?? overrides.metadata?.updatedAt ?? now
  const name = overrides.name !== undefined ? overrides.name : (overrides.metadata?.name ?? 'Test session')
  const agentSnapshot =
    overrides.agentSnapshot ?? overrides.status?.bindings?.agent?.snapshot ?? defaultAgentSnapshot(agentId)
  const environmentSnapshot =
    overrides.environmentSnapshot === undefined
      ? (overrides.status?.bindings?.environment?.snapshot ??
        (environmentId === null ? null : defaultEnvironmentSnapshot(environmentId)))
      : overrides.environmentSnapshot
  const runtime = overrides.spec?.runtime ?? 'ama'
  const baseBindings = {
    agent: { versionId: 'agentver_1', snapshot: agentSnapshot },
    environment: {
      id: environmentId,
      versionId: environmentSnapshot ? 'envver_1' : null,
      snapshot: environmentSnapshot,
    },
    runtime,
  }
  const bindings = {
    ...baseBindings,
    ...overrides.status?.bindings,
    agent: {
      ...baseBindings.agent,
      ...overrides.status?.bindings?.agent,
    },
    environment: {
      ...baseBindings.environment,
      ...overrides.status?.bindings?.environment,
    },
  }
  const placement = {
    hostingMode: overrides.status?.placement?.hostingMode ?? 'cloud',
    provider: overrides.status?.placement?.provider ?? 'workers-ai',
    model: overrides.status?.placement?.model ?? '@cf/moonshotai/kimi-k2.6',
  }
  const volumes = overrides.spec?.volumes ?? []
  const session: Session = {
    metadata: {
      uid,
      projectId,
      name: name ?? uid,
      description: null,
      labels: {},
      annotations: {},
      createdBy: 'user_1',
      createdAt,
      updatedAt,
      ...overrides.metadata,
    },
    spec: {
      agentId,
      environmentId,
      runtime,
      env: {},
      envFrom: [],
      volumes,
      volumeMounts: [],
      ...overrides.spec,
    },
    status: {
      phase,
      reason,
      conditions: [],
      startedAt,
      closedAt,
      ...overrides.status,
      bindings,
      placement: overrides.status?.placement ?? placement,
    },
  }
  return session
}

function defaultAgentSnapshot(agentId: string): SessionAgentSnapshot {
  return {
    id: 'agentver_1',
    agentId,
    projectId: 'project_1',
    version: 1,
    systemPrompt: 'Do the work',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: ['ama@coding-agent'],
    subagents: [],
    allowedTools: ['read', 'write'],
    mcpConnectors: [],
    identity: null,
    createdAt: now,
  }
}

function defaultEnvironmentSnapshot(environmentId: string): SessionEnvironmentSnapshot {
  return {
    id: 'envver_1',
    environmentId,
    projectId: 'project_1',
    version: 1,
    scope: 'project',
    type: 'cloud',
    networking: {
      type: 'limited',
      allowMcpServers: false,
      allowPackageManagers: true,
      allowedHosts: ['registry.npmjs.org'],
    },
    packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['tsx@latest'], pip: [], webi: [] },
    variables: {},
    createdAt: now,
  }
}
