import { parseAmaSandboxToolInput } from '@ama/runtime-contracts/tool-contracts'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getModel, type Model } from '@earendil-works/pi-ai'
import { gitRepositoryMountPath } from '@server/domain/git-repository'
import { memoryStoreIdFromRef, normalizeMemoryPath } from '@server/domain/memory-store'
import {
  type MemoryVolume,
  type Volume,
  type VolumeMount,
  volumeMountPath,
  volumeMountReadOnly,
} from '@server/domain/runtime/execution-inputs'
import type { WorkspaceGitCredential, WorkspaceManifest, WorkspaceManifestMount } from '@server/domain/workspace'
import type {
  AmaTurnExecutor,
  CloudRuntimeLifecycle,
  RunnerChannel,
  RuntimeWorkspaceReader,
  SessionSandboxExecutor,
} from '@server/usecases/ports'
import { isAmaSandboxToolName } from '@shared/agent-tools'
import type { AmaEvent } from '@shared/session-events'
import { canonicalProvider } from '../../domain/runtime/provider'
import type { Env } from '../../env'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
} from '../../usecases/runtime/engine/errors'
import type {
  RuntimeToolPolicyDecision,
  RuntimeToolPolicyInput,
  ToolExecutor,
} from '../../usecases/runtime/engine/ports'
import { runTurn, runtimeMessagesFromEvents } from '../../usecases/runtime/engine/turn-engine'
import { toolExecutor } from './sandbox-tool-executor'
import { workersAiModelClient } from './workers-ai-model-client'

// Canonical home is the AMA turn engine; re-exported so existing importers keep
// their import paths.
export type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput }
// The turn engine, ports, and error vocabulary live under
// server/usecases/runtime/engine. This module is the Worker host: it
// resolves the model, builds the Cloudflare tool executor and the Workers AI
// model client, maps the SessionTurnInput callbacks to ports, and owns
// cloud-only sandbox start/stop and workspace preparation.
// Canonical home is the AMA turn engine; re-exported for existing importers.
export {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
  runtimeMessagesFromEvents,
}

export type SessionRuntimeStartInput = {
  sessionId: string
  sandboxId: string
  runtime?: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  environmentSnapshot: Record<string, unknown> | null
  mcpServers?: Record<string, unknown>
  volumes?: Volume[]
  volumeMounts?: VolumeMount[]
  workspaceManifest?: WorkspaceManifest
  env?: Record<string, string>
}

export type SessionRuntimeStartResult = {
  sandboxId: string
  metadata: Record<string, unknown>
}

export type RuntimeToolCall = {
  id?: string
  name?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: Record<string, unknown>
  durationMs?: number
}

export type RuntimeCommandBody = {
  type?: string
  message?: string
  response?: string
  simulateError?: boolean
  errorMessage?: string
  toolCalls?: RuntimeToolCall[]
}

export type SessionTurnResult = {
  // 'paused': the run still wants more model turns but yielded its execution
  // budget; the caller re-enters with `continuation` to pick up the
  // transcript (rebuilt from persisted events) where it left off.
  status: 'idle' | 'aborted' | 'paused'
}

export type SessionTurnInput = {
  sessionId: string
  sandboxId: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  // Required unless `continuation` is set: a continuation resumes from the
  // persisted transcript whose last message is a tool result.
  prompt?: string
  continuation?: boolean
  messages?: AgentMessage[]
  // Checked before each model call after the first; returning true pauses the run.
  shouldPause?: () => boolean
  ensureActive?: () => Promise<void>
  onEvent: (event: AmaEvent) => Promise<void>
  approveToolCall?: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision>
  // Supplies a caller-provided tool result (e.g. an approved custom tool
  // outcome) instead of executing the tool in the sandbox.
  resolveToolResult?: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
}

let sandboxBindingPromise: Promise<typeof import('@cloudflare/sandbox')['getSandbox']> | null = null

async function getSandboxBinding() {
  sandboxBindingPromise ??= import('@cloudflare/sandbox').then(({ getSandbox }) => getSandbox)
  return await sandboxBindingPromise
}

export function workspaceVolumeManifest(manifest: WorkspaceManifest = { root: '/workspace', mounts: [] }) {
  const volumes = manifest.mounts
    .map((mount) => {
      if (mount.type === 'git_repository') {
        return {
          type: 'git_repository',
          name: mount.name,
          url: mount.url,
          mountPath: mount.mountPath,
          ...(mount.ref ? { ref: mount.ref } : {}),
          status: 'declared',
        }
      }
      if (mount.type === 'memory') {
        return {
          type: 'memory',
          memoryRef: mount.memoryRef,
          name: mount.name,
          mountPath: mount.mountPath,
          status: 'declared',
        }
      }
      if (mount.type === 'empty_dir') {
        return {
          type: 'empty_dir',
          name: mount.name,
          mountPath: mount.mountPath,
          files: mount.files.map((file) => ({ path: file.path })),
          status: 'declared',
        }
      }
      return {
        type: 'secret',
        name: mount.name,
        mountPath: mount.mountPath,
        files: mount.files.map((file) => ({ path: file.path })),
        status: 'declared',
      }
    })
    .sort((left, right) => String(left.mountPath).localeCompare(String(right.mountPath)))
  return {
    version: 1,
    workspaceRoot: manifest.root,
    volumes,
  }
}

const GIT_CLONE_TIMEOUT_MS = 120_000

type CloudWorkspaceSandbox = {
  exec(
    command: string,
    options?: { cwd?: string; timeout?: number },
  ): Promise<{ success?: boolean; exitCode?: number; stdout?: string; stderr?: string }>
  writeFile(path: string, content: string, options?: { encoding?: string }): Promise<unknown>
}

async function execOrThrow(sandbox: CloudWorkspaceSandbox, command: string, options?: { timeout?: number }) {
  const result = await sandbox.exec(command, options)
  if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    throw new Error(
      `Sandbox workspace setup failed (exit ${result.exitCode}): ${result.stderr || result.stdout || command}`,
    )
  }
  return result
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function gitCredentialLine(repositoryUrl: string, credential: WorkspaceGitCredential) {
  const parsed = new URL(repositoryUrl)
  return `https://${encodeURIComponent(credential.username)}:${encodeURIComponent(credential.password)}@${parsed.host}\n`
}

// Parity with the self-hosted runner's prepareRuntimeWorkspace: configure the
// agent git identity and clone declared git_repository volumes. Volume
// credentials are scoped to workspace setup; session env/envFrom remains the
// general mechanism for platform-provided runtime authorization.
async function prepareCloudWorkspace(
  sandbox: CloudWorkspaceSandbox,
  values: {
    manifest: WorkspaceManifest
    env: Record<string, string>
  },
) {
  const homeDir = values.env.HOME || '/root'
  await execOrThrow(sandbox, `mkdir -p ${shellQuote(homeDir)}`)
  if (values.env.GIT_AUTHOR_NAME) {
    await execOrThrow(sandbox, `git config --global user.name ${shellQuote(values.env.GIT_AUTHOR_NAME)}`)
  }
  if (values.env.GIT_AUTHOR_EMAIL) {
    await execOrThrow(sandbox, `git config --global user.email ${shellQuote(values.env.GIT_AUTHOR_EMAIL)}`)
  }
  const gitVolumes = values.manifest.mounts.filter(
    (volume): volume is Extract<WorkspaceManifestMount, { type: 'git_repository' }> => volume.type === 'git_repository',
  )
  const credentialLines = gitVolumes
    .filter((volume) => Boolean(volume.credential))
    .map((volume) => gitCredentialLine(volume.url, volume.credential!))
  const cloneCredentialsPath = credentialLines.length > 0 ? `${homeDir}/.git-clone-credentials` : null
  if (cloneCredentialsPath) {
    await sandbox.writeFile(cloneCredentialsPath, credentialLines.join(''), { encoding: 'utf-8' })
  }

  let pendingError: unknown = null
  try {
    for (const volume of gitVolumes) {
      const url = volume.url
      const mountPath = volume.mountPath || gitRepositoryMountPath(volume.url)
      if (!mountPath.startsWith('/workspace/')) {
        throw new Error(`git_repository mountPath must stay under /workspace: ${mountPath}`)
      }
      const credentialArgs = cloneCredentialsPath
        ? `-c credential.helper= -c credential.helper=${shellQuote(`store --file ${cloneCredentialsPath}`)} `
        : ''
      await execOrThrow(sandbox, `git ${credentialArgs}clone ${shellQuote(url)} ${shellQuote(mountPath)}`, {
        timeout: GIT_CLONE_TIMEOUT_MS,
      })
      if (volume.ref) {
        await execOrThrow(sandbox, `git -C ${shellQuote(mountPath)} checkout ${shellQuote(volume.ref)}`)
      }
    }
  } catch (error) {
    pendingError = error
  }
  if (cloneCredentialsPath) {
    try {
      await execOrThrow(sandbox, `rm -f ${shellQuote(cloneCredentialsPath)}`)
    } catch (error) {
      pendingError ??= error
    }
  }
  if (pendingError) throw pendingError

  for (const mount of values.manifest.mounts.filter(
    (mount): mount is Extract<WorkspaceManifestMount, { type: 'memory' }> => mount.type === 'memory',
  )) {
    const mountPath = mount.mountPath
    if (!mountPath.startsWith('/workspace/.ama/memory-stores/')) {
      throw new Error(`Invalid memory mount path: ${mountPath}`)
    }
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(mountPath)}`)
    for (const memory of mount.files) {
      const path = memory.path
      const content = memory.content
      if (!path || path.startsWith('/') || path.includes('..')) {
        throw new Error(`Invalid memory path: ${path}`)
      }
      const fullPath = `${mountPath}/${path}`
      const parentPath = fullPath.slice(0, fullPath.lastIndexOf('/'))
      await execOrThrow(sandbox, `mkdir -p ${shellQuote(parentPath)}`)
      await sandbox.writeFile(fullPath, content, { encoding: 'utf-8' })
    }
    if (mount.readOnly) {
      await execOrThrow(sandbox, `chmod -R a-w ${shellQuote(mountPath)}`)
    }
  }
  for (const mount of values.manifest.mounts.filter(
    (mount): mount is Extract<WorkspaceManifestMount, { type: 'secret' }> => mount.type === 'secret',
  )) {
    const mountPath = mount.mountPath
    if (!mountPath.startsWith('/workspace/')) {
      throw new Error(`Invalid secret volume mount path: ${mountPath}`)
    }
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(mountPath)}`)
    for (const file of mount.files) {
      const path = file.path
      const content = file.content
      if (!path || path.startsWith('/') || path.includes('..')) {
        throw new Error(`Invalid secret volume file path: ${path}`)
      }
      const fullPath = `${mountPath}/${path}`
      const parentPath = fullPath.slice(0, fullPath.lastIndexOf('/'))
      await execOrThrow(sandbox, `mkdir -p ${shellQuote(parentPath)}`)
      await sandbox.writeFile(fullPath, content, { encoding: 'utf-8' })
    }
    if (mount.readOnly) {
      await execOrThrow(sandbox, `chmod -R a-w ${shellQuote(mountPath)}`)
    }
  }
  for (const mount of values.manifest.mounts.filter(
    (mount): mount is Extract<WorkspaceManifestMount, { type: 'empty_dir' }> => mount.type === 'empty_dir',
  )) {
    await materializeCloudEmptyDir(sandbox, mount)
  }
}

async function materializeCloudEmptyDir(
  sandbox: CloudWorkspaceSandbox,
  mount: Extract<WorkspaceManifestMount, { type: 'empty_dir' }>,
) {
  if (!mount.mountPath.startsWith('/workspace/')) {
    throw new Error(`Invalid empty directory volume mount path: ${mount.mountPath}`)
  }
  await rejectCloudWorkspaceSymlinks(sandbox, mount.mountPath)
  const existing = await sandbox.exec(
    `[ ! -L ${shellQuote(mount.mountPath)} ] && [ -d ${shellQuote(mount.mountPath)} ]`,
  )
  if (commandSucceeded(existing)) return
  const occupied = await sandbox.exec(`[ -e ${shellQuote(mount.mountPath)} ] || [ -L ${shellQuote(mount.mountPath)} ]`)
  if (commandSucceeded(occupied)) {
    throw new Error(`Empty directory volume mount path is not a directory: ${mount.mountPath}`)
  }
  const parentPath = mount.mountPath.slice(0, mount.mountPath.lastIndexOf('/'))
  const stagingPath = `${parentPath}/.ama-empty-dir-${crypto.randomUUID()}`
  await execOrThrow(sandbox, `umask 077 && mkdir -p ${shellQuote(parentPath)} && mkdir ${shellQuote(stagingPath)}`)
  try {
    for (const file of mount.files) {
      if (
        !file.path ||
        file.path.startsWith('/') ||
        file.path.split('/').some((segment) => !segment || segment === '..')
      ) {
        throw new Error(`Invalid empty directory seed path: ${file.path}`)
      }
      const target = `${stagingPath}/${file.path}`
      const seedParentPath = target.slice(0, target.lastIndexOf('/'))
      await execOrThrow(
        sandbox,
        `umask 077 && mkdir -p ${shellQuote(seedParentPath)} && : > ${shellQuote(target)} && chmod 600 ${shellQuote(target)}`,
      )
      await sandbox.writeFile(target, file.content, { encoding: 'utf-8' })
      await execOrThrow(sandbox, `chmod 600 ${shellQuote(target)}`)
    }
    await execOrThrow(sandbox, `mv -T -n ${shellQuote(stagingPath)} ${shellQuote(mount.mountPath)}`)
    const stagingRemains = await sandbox.exec(`[ -d ${shellQuote(stagingPath)} ]`)
    if (commandSucceeded(stagingRemains)) {
      await rejectCloudWorkspaceSymlinks(sandbox, mount.mountPath)
      const winner = await sandbox.exec(
        `[ ! -L ${shellQuote(mount.mountPath)} ] && [ -d ${shellQuote(mount.mountPath)} ]`,
      )
      if (!commandSucceeded(winner)) {
        throw new Error(`Empty directory volume publication conflict: ${mount.mountPath}`)
      }
      await execOrThrow(sandbox, `rm -rf ${shellQuote(stagingPath)}`)
    }
  } catch (cause) {
    let cleanupError: unknown = null
    try {
      await execOrThrow(sandbox, `rm -rf ${shellQuote(stagingPath)}`)
    } catch (error) {
      cleanupError = error
    }
    if (cleanupError) throw new AggregateError([cause, cleanupError], 'Empty directory materialization failed')
    throw cause
  }
}

function commandSucceeded(result: { success?: boolean; exitCode?: number }) {
  return result.success === true || result.exitCode === 0
}

async function rejectCloudWorkspaceSymlinks(sandbox: CloudWorkspaceSandbox, mountPath: string) {
  const segments = mountPath.slice('/workspace/'.length).split('/')
  const prefixes = segments.map((_, index) => `/workspace/${segments.slice(0, index + 1).join('/')}`)
  await execOrThrow(sandbox, prefixes.map((path) => `[ ! -L ${shellQuote(path)} ]`).join(' && '))
}

const CLOUD_ENVIRONMENT_BIN = '/workspace/.ama/environment/bin'

async function prepareCloudEnvironmentPackages(
  sandbox: CloudWorkspaceSandbox,
  environmentSnapshot: Record<string, unknown> | null,
) {
  const packages = environmentSnapshot?.packages
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) return null
  const goPackages = (packages as Record<string, unknown>).go
  if (!Array.isArray(goPackages) || goPackages.length === 0) return null
  try {
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(CLOUD_ENVIRONMENT_BIN)}`)
    for (const module of goPackages) {
      if (typeof module !== 'string' || !module) {
        throw new Error('Go package declaration must be a non-empty string')
      }
      await execOrThrow(sandbox, `GOBIN=${shellQuote(CLOUD_ENVIRONMENT_BIN)} go install ${shellQuote(module)}`, {
        timeout: GIT_CLONE_TIMEOUT_MS,
      })
    }
    return CLOUD_ENVIRONMENT_BIN
  } catch (cause) {
    throw new Error('Environment package installation failed', { cause })
  }
}

export async function startSessionRuntime(
  env: Env,
  input: SessionRuntimeStartInput,
): Promise<SessionRuntimeStartResult> {
  resolveRuntimeModel(env, input.model)
  if (env.AMA_RUNTIME_MODE !== 'test') {
    const getSandbox = await getSandboxBinding()
    const sandbox = getSandbox(env.SANDBOX, input.sandboxId, { keepAlive: true, normalizeId: true })
    const sessionEnv = { ...(input.env ?? {}) }
    const environmentBin = await prepareCloudEnvironmentPackages(sandbox, input.environmentSnapshot)
    if (environmentBin) {
      const inheritedPath = sessionEnv.PATH ?? (await sandbox.exec('printf %s "$PATH"')).stdout ?? ''
      sessionEnv.PATH = inheritedPath ? `${environmentBin}:${inheritedPath}` : environmentBin
    }
    if (Object.keys(sessionEnv).length > 0) {
      await sandbox.setEnvVars(sessionEnv)
    }
    await prepareCloudWorkspace(sandbox, {
      manifest: input.workspaceManifest ?? { root: '/workspace', mounts: [] },
      env: sessionEnv,
    })
  }

  return {
    sandboxId: input.sandboxId,
    metadata: {
      runtimeMode: env.AMA_RUNTIME_MODE === 'test' ? 'test' : 'live',
      runtimeDriver: 'ama-cloud',
      runtimeBackend: 'ama-cloud',
      runtimeProtocol: 'ama-runtime-rpc',
      loop: 'cloud-session-runtime',
      executor: 'cloudflare-sandbox',
      piCorePackage: '@earendil-works/pi-agent-core',
    },
  }
}

export async function stopSessionRuntime(env: Env, sandboxId: string) {
  await toolExecutor(env).stop?.(sandboxId)
}

export async function readMemoryStoreMemories(
  env: Env,
  input: { sandboxId: string; volumes: MemoryVolume[]; volumeMounts: VolumeMount[] },
) {
  if (env.AMA_RUNTIME_MODE === 'test') {
    return []
  }
  const getSandbox = await getSandboxBinding()
  const sandbox = getSandbox(env.SANDBOX, input.sandboxId, { keepAlive: true, normalizeId: true })
  const stores: Array<{ memoryRef: string; memories: Array<{ path: string; content: string }> }> = []
  for (const volume of input.volumes) {
    if (volumeMountReadOnly(volume.name, input.volumeMounts)) {
      continue
    }
    const storeId = memoryStoreIdFromRef(volume.memoryRef)
    const mountPath = String(volumeMountPath(volume.name, input.volumeMounts) ?? '')
    if (!storeId || !mountPath.startsWith('/workspace/.ama/memory-stores/')) {
      continue
    }
    const listed = await sandbox.exec(`find ${shellQuote(mountPath)} -type f -print | sort`)
    if (typeof listed.exitCode === 'number' && listed.exitCode !== 0) {
      throw new Error(`Memory store readback failed: ${listed.stderr || listed.stdout || storeId}`)
    }
    const memories = []
    for (const filePath of (listed.stdout ?? '').split('\n').filter(Boolean)) {
      if (!filePath.startsWith(`${mountPath}/`)) {
        continue
      }
      const relativePath = normalizeMemoryPath(filePath.slice(mountPath.length + 1))
      const content = await sandbox.exec(`cat ${shellQuote(filePath)}`)
      if (typeof content.exitCode === 'number' && content.exitCode !== 0) {
        throw new Error(`Memory file readback failed: ${content.stderr || relativePath}`)
      }
      memories.push({ path: relativePath, content: content.stdout ?? '' })
    }
    stores.push({ memoryRef: volume.memoryRef, memories })
  }
  return stores
}

export function runtimeToolCalls(body: unknown) {
  if (!body || typeof body !== 'object') {
    return []
  }
  const calls = (body as RuntimeCommandBody).toolCalls
  return Array.isArray(calls) ? calls.filter((call): call is RuntimeToolCall => !!call && typeof call === 'object') : []
}

export async function executeRuntimeToolCalls(
  env: Env,
  values: {
    sessionId: string
    sandboxId: string
    body: unknown
  },
) {
  const executor = toolExecutor(env)
  const results = []
  for (const call of runtimeToolCalls(values.body)) {
    if (typeof call.id !== 'string' || !call.id) {
      throw new Error('Runtime tool call id is required')
    }
    const toolCallId = call.id
    const toolName = typeof call.name === 'string' ? call.name : 'tool'
    if (!isAmaSandboxToolName(toolName)) {
      throw new Error(`Unsupported sandbox tool: ${toolName}`)
    }
    const input = parseAmaSandboxToolInput(toolName, call.input ?? {})
    results.push(
      await executor.execute({
        sessionId: values.sessionId,
        sandboxId: values.sandboxId,
        toolCallId,
        toolName,
        input,
        cwd: '/workspace',
      }),
    )
  }
  return results
}

function piProviderName(provider: string) {
  return canonicalProvider(provider)
}

function runtimeDefaultModel(env: Env) {
  return env.AMA_DEFAULT_MODEL ?? '@cf/moonshotai/kimi-k2.6'
}

function resolveRuntimeModel(env: Env, model: string | null) {
  return model ?? runtimeDefaultModel(env)
}

function fallbackModel(model: string): Model<string> {
  return {
    id: model,
    name: model,
    api: 'ama-workers-ai',
    provider: 'cloudflare-workers-ai',
    baseUrl: 'cloudflare-ai-binding://AI',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  }
}

// Cloud dispatches every model through the Workers AI binding (env.AI.run): the
// model id drives native (@cf) vs AI Gateway routing, so the agent's vendor is
// irrelevant here — every cloud model resolves against the workers-ai api.
function runtimeModel(model: string) {
  return getModel('cloudflare-workers-ai', model as never) ?? fallbackModel(model)
}

// Worker host adapter over the shared turn engine: resolve the Workers AI
// model, build the Cloudflare tool executor and model client, and map the
// optional SessionTurnInput callbacks to the engine's ports (absent callbacks
// become permissive defaults — no gating, no liveness check, never pause).
export async function runSessionTurn(
  env: Env,
  input: SessionTurnInput,
  executor = toolExecutor(env),
): Promise<SessionTurnResult> {
  const provider = piProviderName(input.provider)
  const modelId = resolveRuntimeModel(env, input.model)
  const model = runtimeModel(modelId)
  return runTurn({
    sessionId: input.sessionId,
    sandboxId: input.sandboxId,
    model,
    providerLabel: provider,
    modelLabel: modelId,
    agentSnapshot: input.agentSnapshot,
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.continuation ? { continuation: true } : {}),
    ...(input.messages ? { messages: input.messages } : {}),
    sink: { emit: (event) => input.onEvent(event) },
    policy: { approve: input.approveToolCall ?? (async () => ({ allowed: true })) },
    toolResults: { resolve: input.resolveToolResult ?? (async () => null) },
    liveness: { ensureActive: input.ensureActive ?? (async () => {}) },
    ...(input.shouldPause ? { budget: { shouldPause: input.shouldPause } } : {}),
    executor,
    modelClient: workersAiModelClient(env),
  })
}

export type RuntimeExecutionAdapters = {
  cloudRuntime: CloudRuntimeLifecycle
  runtimeWorkspace: RuntimeWorkspaceReader
  sandboxExecutor: SessionSandboxExecutor
  amaTurnExecutor: AmaTurnExecutor
}

// Binds env-backed cloud/runner execution behind narrow usecase ports. The
// free functions above stay exported for existing direct importers.
export function createRuntimeExecutionAdapters(
  env: Env,
  options: {
    runnerChannel?: RunnerChannel
    resolveSandboxBackend?: (sessionId: string) => Promise<string | null>
  } = {},
): RuntimeExecutionAdapters {
  const cloudExecutor = toolExecutor(env)
  const executorForSession = async (sessionId: string) => {
    const backend = await options.resolveSandboxBackend?.(sessionId)
    if (backend === 'runner-sandbox') {
      if (!options.runnerChannel) {
        throw new Error('Runner sandbox channel is not configured')
      }
      return { execute: (input) => options.runnerChannel!.executeSandboxTool(input) } satisfies ToolExecutor
    }
    return cloudExecutor
  }

  return {
    cloudRuntime: {
      startCloudSession(input) {
        return startSessionRuntime(env, input)
      },
      stopCloudSession(sandboxId) {
        return stopSessionRuntime(env, sandboxId)
      },
    },
    runtimeWorkspace: {
      async readMemoryStoreMemories(input) {
        if ((await options.resolveSandboxBackend?.(input.sessionId)) === 'runner-sandbox') {
          if (!options.runnerChannel) {
            throw new Error('Runner sandbox channel is not configured')
          }
          return await options.runnerChannel.readMemoryStoreMemories({
            sessionId: input.sessionId,
            volumes: input.volumes,
            volumeMounts: input.volumeMounts,
          })
        }
        return readMemoryStoreMemories(env, input)
      },
    },
    sandboxExecutor: {
      async executeToolCalls(input) {
        if ((await options.resolveSandboxBackend?.(input.sessionId)) === 'runner-sandbox') {
          const body = input.body as { toolCalls?: RuntimeToolCall[] }
          const calls = runtimeToolCalls(body)
          const results = []
          for (const call of calls) {
            if (typeof call.id !== 'string' || !call.id) {
              throw new Error('Runtime tool call id is required')
            }
            const toolName = (() => {
              const value = typeof call.name === 'string' ? call.name : 'tool'
              if (!isAmaSandboxToolName(value)) {
                throw new Error(`Unsupported sandbox tool: ${value}`)
              }
              return value
            })()
            results.push(
              await (await executorForSession(input.sessionId)).execute({
                sessionId: input.sessionId,
                sandboxId: input.sandboxId,
                toolCallId: call.id,
                toolName,
                input: parseAmaSandboxToolInput(toolName, call.input ?? {}),
                cwd: '/workspace',
              }),
            )
          }
          return results
        }
        return executeRuntimeToolCalls(env, input)
      },
      async executeTool(input) {
        return await (await executorForSession(input.sessionId)).execute(input)
      },
    },
    amaTurnExecutor: {
      async runTurn(input) {
        return await runSessionTurn(env, input, await executorForSession(input.sessionId))
      },
    },
  }
}
