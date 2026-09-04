import {
  IdentityRuntimeMismatchError,
  IdentityRuntimeRequiredError,
  IdentityRuntimeUnsupportedError,
  resolveIdentityRuntime,
} from '@server/domain/identity'
import { runtimeNameForIdentity } from '@server/domain/runtime/driver'
import type { RuntimeName } from '@server/domain/runtime-catalog'
import {
  hasSecretMaterial,
  nextDueFromInterval,
  type Trigger,
  type TriggerSchedule,
  type TriggerSessionTemplate,
} from '@server/domain/trigger'
import { newPrimaryKey } from '@server/id'
import { creationDigest, creationFingerprint } from './creation-idempotency'
import type { Deps } from './deps'
import { initialInboxProvisioning, reconcileInboxSubscription, removeInboxSubscription } from './inbox-subscriptions'
import {
  type AuthScope,
  CreationIdempotencyConflictError,
  type TriggerConfig,
  TriggerConflictError,
  TriggerValidationError,
} from './ports'

// Raw secrets must be stored as secret references, so trigger metadata, resource
// volumes, and plain env are rejected when they carry secret-like material.
function rejectSecretMaterial(input: {
  template?: TriggerSessionTemplate | undefined
  templateMetadata?: Partial<TriggerSessionTemplate['metadata']> | undefined
  volumes?: TriggerSessionTemplate['spec']['volumes'] | undefined
  env?: Record<string, string> | undefined
}) {
  if (input.template !== undefined && hasSecretMaterial(input.template.metadata)) {
    throw new TriggerValidationError('Invalid trigger template metadata', {
      template: 'Secret material must be stored in secret references.',
    })
  }
  if (input.templateMetadata !== undefined && hasSecretMaterial(input.templateMetadata)) {
    throw new TriggerValidationError('Invalid trigger template metadata', {
      template: 'Secret material must be stored in secret references.',
    })
  }
  if (
    (input.volumes !== undefined && hasSecretMaterial(input.volumes)) ||
    (input.env !== undefined && hasSecretMaterial(input.env))
  ) {
    throw new TriggerValidationError('Invalid trigger session configuration', {
      volumes: 'Volumes must not contain secret material.',
      env: 'Environment variables must not contain raw secret material.',
    })
  }
}

// The referenced agent must be live for the trigger to dispatch, and a pinned
// environment must be live too. A null environment is left to per-dispatch
// resolution and skips the environment check. A missing reference is a 404; an
// deleted/unavailable one is a 409.
async function assertReferencesUsable(deps: Deps, projectId: string, agentId: string, environmentId: string | null) {
  const agentError = await deps.triggers.agentUsable(projectId, agentId)
  if (agentError) {
    throw new TriggerConflictError(agentError.message, agentError.status)
  }
  if (environmentId !== null) {
    const environmentError = await deps.triggers.environmentUsable(projectId, environmentId)
    if (environmentError) {
      throw new TriggerConflictError(environmentError.message, environmentError.status)
    }
  }
}

export interface CreateTriggerInputDto {
  idempotencyKey?: string
  config: Omit<TriggerConfig, 'nextDueAt' | 'template'> & {
    nextDueAt: string | null
    template: Omit<TriggerSessionTemplate, 'spec'> & {
      spec: Omit<TriggerSessionTemplate['spec'], 'runtime'> & { runtime?: TriggerSessionTemplate['spec']['runtime'] }
    }
  }
}

function normalizeScheduleConfig(config: CreateTriggerInputDto['config']) {
  if (config.source.type === 'schedule') {
    if (config.source.schedule === undefined) {
      throw new TriggerValidationError('Invalid trigger schedule', {
        schedule: 'Scheduled triggers require an interval schedule.',
      })
    }
    return {
      source: config.source,
      nextDueAt: config.nextDueAt ?? nextDueFromInterval(config.source.schedule.intervalSeconds),
    }
  }
  if (config.nextDueAt !== null) {
    throw new TriggerValidationError('Invalid trigger schedule', {
      schedule: 'Non-scheduled triggers do not use schedule timing.',
    })
  }
  return { source: config.source, nextDueAt: null }
}

export async function createTrigger(deps: Deps, auth: AuthScope, input: CreateTriggerInputDto): Promise<Trigger> {
  const requestFingerprint = input.idempotencyKey ? await creationFingerprint(input.config) : undefined
  const keyHash = input.idempotencyKey ? await creationDigest(input.idempotencyKey) : undefined
  if (keyHash && requestFingerprint) {
    const replay = await deps.triggers.findCreation(auth.project.id, keyHash)
    if (replay) {
      if (replay.fingerprint !== requestFingerprint) throw new CreationIdempotencyConflictError()
      return replay.trigger.spec.source.type === 'inbox'
        ? reconcileInboxSubscription(deps, replay.trigger)
        : replay.trigger
    }
  }
  rejectSecretMaterial({
    templateMetadata: input.config.template.metadata,
    volumes: input.config.template.spec.volumes,
    env: input.config.template.spec.env,
  })
  await assertReferencesUsable(
    deps,
    auth.project.id,
    input.config.template.spec.agentId,
    input.config.template.spec.environmentId,
  )
  const agent = await deps.agents.find(auth.project.id, input.config.template.spec.agentId)
  if (!agent) throw new TriggerConflictError('Agent not found', 404)
  if (input.config.source.type === 'inbox' && !agent.spec.identity) {
    throw new TriggerConflictError('Inbox triggers require a Realmroot-bound Agent')
  }
  let runtime: RuntimeName
  try {
    runtime = runtimeNameForIdentity(resolveIdentityRuntime(input.config.template.spec.runtime, agent.spec.identity))
  } catch (error) {
    if (
      error instanceof IdentityRuntimeMismatchError ||
      error instanceof IdentityRuntimeRequiredError ||
      error instanceof IdentityRuntimeUnsupportedError
    ) {
      throw new TriggerConflictError(error.message, 409, error.code)
    }
    throw error
  }

  const timestamp = new Date().toISOString()
  const timing = normalizeScheduleConfig(input.config)
  const requestedConfig: TriggerConfig = {
    ...input.config,
    template: { ...input.config.template, spec: { ...input.config.template.spec, runtime } },
  }
  const config: TriggerConfig = {
    ...requestedConfig,
    source: timing.source,
    nextDueAt: timing.nextDueAt,
  }
  const triggerId = newPrimaryKey()
  const inbox = config.source.type === 'inbox' ? await initialInboxProvisioning(deps) : null
  const trigger = await deps.triggers.insert(
    {
      id: triggerId,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      config,
      createdByUserId: auth.user.id,
      inboxProvisioning: inbox?.fields ?? null,
      ...(keyHash && requestFingerprint ? { creationKeyHash: keyHash, creationFingerprint: requestFingerprint } : {}),
    },
    timestamp,
  )
  return inbox
    ? reconcileInboxSubscription(
        deps,
        trigger,
        trigger.status.subscription?.id === inbox.fields.subscriptionId ? inbox.token : undefined,
      )
    : trigger
}

export interface UpdateTriggerPatch {
  name?: string
  source?:
    | { type: 'schedule'; schedule?: Partial<TriggerSchedule> }
    | { type: 'http'; concurrency?: { mode: 'parallel' | 'serial' } }
    | { type: 'inbox' }
  suspend?: boolean
  template?: {
    metadata?: Partial<TriggerSessionTemplate['metadata']>
    spec?: Partial<TriggerSessionTemplate['spec']>
  }
  nextDueAt?: string
}

function mergeTemplate(trigger: Trigger, patch: UpdateTriggerPatch): TriggerSessionTemplate {
  return {
    metadata: {
      labels: patch.template?.metadata?.labels ?? trigger.spec.template.metadata.labels,
      annotations: patch.template?.metadata?.annotations ?? trigger.spec.template.metadata.annotations,
    },
    spec: {
      ...trigger.spec.template.spec,
      ...patch.template?.spec,
    },
  }
}

function mergeSource(trigger: Trigger, patch: UpdateTriggerPatch): Pick<TriggerConfig, 'source' | 'nextDueAt'> {
  const current = trigger.spec.source
  if (patch.source?.type === 'inbox') {
    if (patch.nextDueAt !== undefined) {
      throw new TriggerValidationError('Invalid trigger schedule', {
        schedule: 'Inbox triggers do not use schedule timing.',
      })
    }
    return { source: { type: 'inbox' }, nextDueAt: null }
  }
  if (patch.source?.type === 'http') {
    if (patch.nextDueAt !== undefined) {
      throw new TriggerValidationError('Invalid trigger schedule', {
        schedule: 'HTTP triggers do not use schedule timing.',
      })
    }
    return {
      source: {
        type: 'http',
        ...(patch.source.concurrency !== undefined
          ? { concurrency: patch.source.concurrency }
          : current.type === 'http' && current.concurrency !== undefined
            ? { concurrency: current.concurrency }
            : {}),
      },
      nextDueAt: null,
    }
  }
  if (patch.source?.type === 'schedule' || (!patch.source && current.type === 'schedule')) {
    const currentSchedule = current.type === 'schedule' ? current.schedule : null
    const patchSchedule = patch.source?.type === 'schedule' ? patch.source.schedule : undefined
    const intervalSeconds = patchSchedule?.intervalSeconds ?? currentSchedule?.intervalSeconds
    if (intervalSeconds === undefined) {
      throw new TriggerValidationError('Invalid trigger schedule', {
        schedule: 'Scheduled triggers require an interval schedule.',
      })
    }
    const schedule: TriggerSchedule = {
      type: 'interval',
      intervalSeconds,
      windowSeconds: patchSchedule?.windowSeconds ?? currentSchedule?.windowSeconds ?? 0,
    }
    return {
      source: { type: 'schedule', schedule },
      nextDueAt: patch.nextDueAt ?? trigger.status.nextDueAt ?? nextDueFromInterval(schedule.intervalSeconds),
    }
  }
  if (patch.nextDueAt !== undefined) {
    throw new TriggerValidationError('Invalid trigger schedule', {
      schedule: 'HTTP triggers do not use schedule timing.',
    })
  }
  return current.type === 'inbox'
    ? { source: { type: 'inbox' }, nextDueAt: null }
    : {
        source: {
          type: 'http',
          ...(current.type === 'http' && current.concurrency !== undefined ? { concurrency: current.concurrency } : {}),
        },
        nextDueAt: null,
      }
}

export interface UpdateTriggerResult {
  trigger: Trigger
}

// Orchestrates a PATCH with secret-material rejection, reference validation,
// and an atomic field merge.
export async function updateTrigger(
  deps: Deps,
  auth: AuthScope,
  trigger: Trigger,
  patch: UpdateTriggerPatch,
): Promise<UpdateTriggerResult> {
  let template = mergeTemplate(trigger, patch)
  rejectSecretMaterial({
    templateMetadata: patch.template?.metadata,
    volumes: patch.template?.spec?.volumes,
    env: patch.template?.spec?.env,
  })
  const timing = mergeSource(trigger, patch)

  const agentId = template.spec.agentId
  const environmentId = template.spec.environmentId
  if (patch.template?.spec?.agentId !== undefined || patch.template?.spec?.environmentId !== undefined) {
    await assertReferencesUsable(deps, auth.project.id, agentId, environmentId)
  }
  const agent = await deps.agents.find(auth.project.id, agentId)
  if (!agent) throw new TriggerConflictError('Agent not found', 404)
  if (timing.source.type === 'inbox' && !agent.spec.identity) {
    throw new TriggerConflictError('Inbox triggers require a Realmroot-bound Agent')
  }
  try {
    const requestedRuntime =
      patch.template?.spec?.runtime !== undefined
        ? patch.template.spec.runtime
        : agent.spec.identity
          ? undefined
          : template.spec.runtime
    template = {
      ...template,
      spec: {
        ...template.spec,
        runtime: runtimeNameForIdentity(resolveIdentityRuntime(requestedRuntime, agent.spec.identity)),
      },
    }
  } catch (error) {
    if (
      error instanceof IdentityRuntimeMismatchError ||
      error instanceof IdentityRuntimeRequiredError ||
      error instanceof IdentityRuntimeUnsupportedError
    ) {
      throw new TriggerConflictError(error.message, 409, error.code)
    }
    throw error
  }

  const timestamp = new Date().toISOString()
  const config: TriggerConfig = {
    name: patch.name ?? trigger.metadata.name,
    source: timing.source,
    suspend: patch.suspend ?? trigger.spec.suspend,
    template,
    nextDueAt: timing.nextDueAt,
  }
  const leavingInbox = trigger.spec.source.type === 'inbox' && timing.source.type !== 'inbox'
  if (leavingInbox) await removeInboxSubscription(deps, trigger)
  const enteringInbox = trigger.spec.source.type !== 'inbox' && timing.source.type === 'inbox'
  const inbox = enteringInbox ? await initialInboxProvisioning(deps) : null
  let updated = await deps.triggers.update(
    auth.project.id,
    trigger.metadata.uid,
    {
      config,
      ...(leavingInbox
        ? { inboxProvisioning: null }
        : enteringInbox
          ? { inboxProvisioning: inbox?.fields ?? null }
          : {}),
    },
    timestamp,
  )
  if (updated.spec.source.type === 'inbox') {
    updated = await reconcileInboxSubscription(deps, updated, inbox?.token)
  }
  return { trigger: updated }
}

// Soft-deletes the trigger while retaining its runs for audit history.
export async function deleteTrigger(deps: Deps, auth: AuthScope, triggerId: string): Promise<boolean> {
  const trigger = await deps.triggers.find(auth.project.id, triggerId)
  if (trigger) await removeInboxSubscription(deps, trigger)
  return deps.triggers.delete(auth.project.id, triggerId)
}
