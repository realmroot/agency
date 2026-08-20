import type { AuditEntry, AuthScope } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import { auditRecords } from '../../db/schema'

type Db = ReturnType<typeof drizzle>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

// The scheduler actor is recorded as a system actor with no user id; every
// other caller is the authenticated user.
function defaultActor(auth: AuthScope) {
  if (auth.user.id === 'system:scheduler') {
    return { actorType: 'system' as const, actorUserId: null, controllerUserId: null }
  }
  if (auth.agentActor) {
    return { actorType: 'agent' as const, actorUserId: auth.agentActor.subject, controllerUserId: auth.user.id }
  }
  return { actorType: 'user' as const, actorUserId: auth.user.id, controllerUserId: null }
}

// recordAudit (audit.ts) allows the caller to override the recorded actor; the
// AuditPort gateway always derives it from the auth scope.
export interface AuditWriteEntry extends AuditEntry {
  actorType?: 'user' | 'agent' | 'system'
  actorUserId?: string | null
  controllerUserId?: string | null
}

export interface AuditWriteRepo {
  record(auth: AuthScope, entry: AuditWriteEntry): Promise<void>
}

export function createAuditWriteRepo(db: Db): AuditWriteRepo {
  return {
    async record(auth, entry) {
      const actor = defaultActor(auth)
      await db.insert(auditRecords).values({
        id: newId('audit'),
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        actorUserId: entry.actorUserId === undefined ? actor.actorUserId : entry.actorUserId,
        controllerUserId: entry.controllerUserId === undefined ? actor.controllerUserId : entry.controllerUserId,
        actorType: entry.actorType ?? actor.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        outcome: entry.outcome,
        requestId: entry.requestId ?? null,
        correlationId: entry.correlationId ?? null,
        sessionId: entry.sessionId ?? null,
        policyCategory: entry.policyCategory ?? null,
        metadata: JSON.stringify(entry.metadata ?? {}),
        before: JSON.stringify(entry.before ?? {}),
        after: JSON.stringify(entry.after ?? {}),
        createdAt: new Date().toISOString(),
      })
    },
  }
}
