import {
  hasSecretMaterial,
  nextDueFromInterval,
  type Trigger,
  type TriggerSchedule,
  type TriggerSessionTemplate,
} from '@server/domain/trigger'
import type { Deps } from './deps'
import { type AuthScope, type TriggerConfig, TriggerConflictError, TriggerValidationError } from './ports'

// Raw secrets must be stored as secret references, so trigger metadata, resource
// volumes, and plain env are rejected when they carry secret-like material.
function rejectSecretMaterial(input: {
  template?: Pick<TriggerSessionTemplate, 'metadata'> | undefined
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
// archived/unavailable one is a 409.
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

type TriggerTemplateInput = Omit<TriggerSessionTemplate, 'spec'> & {
  spec: Omit<TriggerSessionTemplate['spec'], 'runtime'>
}

export interface CreateTriggerInputDto {
  config: Omit<TriggerConfig, 'template' | 'nextDueAt'> & {
    template: TriggerTemplateInput
    nextDueAt: string | null
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
      schedule: 'HTTP triggers do not use schedule timing.',
    })
  }
  return { source: config.source, nextDueAt: null }
}

export async function createTrigger(deps: Deps, auth: AuthScope, input: CreateTriggerInputDto): Promise<Trigger> {
  rejectSecretMaterial({
    template: input.config.template,
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

  const timestamp = new Date().toISOString()
  const timing = normalizeScheduleConfig(input.config)
  const config: TriggerConfig = {
    name: input.config.name,
    source: timing.source,
    suspend: input.config.suspend,
    template: {
      ...input.config.template,
      spec: { ...input.config.template.spec, runtime: agent.spec.runtime },
    },
    nextDueAt: timing.nextDueAt,
  }
  return deps.triggers.insert(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      config,
      createdByUserId: auth.user.id,
    },
    timestamp,
  )
}

export interface UpdateTriggerPatch {
  name?: string
  source?:
    | { type: 'schedule'; schedule?: Partial<TriggerSchedule> }
    | { type: 'http'; concurrency?: { mode: 'parallel' | 'serial' } }
  suspend?: boolean
  template?: {
    metadata?: Partial<TriggerSessionTemplate['metadata']>
    spec?: Partial<Omit<TriggerSessionTemplate['spec'], 'runtime'>>
  }
  archived?: boolean
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
  return {
    source: {
      type: 'http',
      ...(current.type === 'http' && current.concurrency !== undefined ? { concurrency: current.concurrency } : {}),
    },
    nextDueAt: null,
  }
}

export interface UpdateTriggerResult {
  trigger: Trigger
  archived: boolean
}

// Orchestrates a PATCH: archive lifecycle (archive/restore), secret-material
// rejection, agent/environment reference re-validation when changed, field
// merge. Throws TriggerConflictError when field updates target an archived
// trigger.
export async function updateTrigger(
  deps: Deps,
  auth: AuthScope,
  trigger: Trigger,
  patch: UpdateTriggerPatch,
): Promise<UpdateTriggerResult> {
  if (trigger.metadata.archivedAt !== null && patch.archived !== false) {
    throw new TriggerConflictError('Archived triggers cannot be updated')
  }
  const template = mergeTemplate(trigger, patch)
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
  const effectiveTemplate: TriggerSessionTemplate = {
    ...template,
    spec: { ...template.spec, runtime: agent.spec.runtime },
  }

  const timestamp = new Date().toISOString()
  const archivedAt =
    patch.archived === true
      ? (trigger.metadata.archivedAt ?? timestamp)
      : patch.archived === false
        ? null
        : trigger.metadata.archivedAt
  const config: TriggerConfig = {
    name: patch.name ?? trigger.metadata.name,
    source: timing.source,
    suspend: patch.suspend ?? trigger.spec.suspend,
    template: effectiveTemplate,
    nextDueAt: timing.nextDueAt,
  }
  const updated = await deps.triggers.update(auth.project.id, trigger.metadata.uid, { config, archivedAt }, timestamp)
  return { trigger: updated, archived: patch.archived === true && trigger.metadata.archivedAt === null }
}

// Hard-deletes the trigger and its runs, tenant-scoped. Returns false when no
// matching trigger exists in the project so the http layer can answer 404.
export async function deleteTrigger(deps: Deps, auth: AuthScope, triggerId: string): Promise<boolean> {
  return deps.triggers.delete(auth.project.id, triggerId)
}
