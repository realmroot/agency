import {
  assertAmaRuntimeEvent,
  messageEvent,
  randomId,
  runtimeError,
  runtimeEvent,
  textMessage,
  toolCallBlock,
  toolResultMessage,
  usageEvent,
} from './events/ama'
import {
  type AmaRuntimeEvent,
  bridgeError,
  createResumeTokenWatcher,
  type RuntimeBridgeInputMessage,
  type RuntimeBridgeOutputMessage,
  type RuntimeProviderHandle,
} from './protocol'

type RunRequest = Extract<RuntimeBridgeInputMessage, { type: 'run' }>

type RunState = { handle?: RuntimeProviderHandle; done: boolean }

function sessionEventOutput(requestId: string, event: AmaRuntimeEvent): RuntimeBridgeOutputMessage {
  const canonical = assertAmaRuntimeEvent(event)
  return {
    type: 'runtime.event',
    requestId,
    event: canonical,
  }
}

// Stable, safe error codes for official-runtime auth/authz failures. The
// canonical events and session status reasons derive from these — raw
// provider errors and credential material never leave the bridge.
export const RUNTIME_AUTH_ERROR_CODES: Record<string, string> = {
  missing_login: 'runtime_auth_missing_login',
  unauthorized: 'runtime_auth_unauthorized',
  product_disabled: 'runtime_auth_product_disabled',
  expired: 'runtime_auth_expired',
}

// Deterministic per-runtime model ids for e2e runs: enumeration must not hit
// the real SDKs there, and these match the runner's pinned fallback models so
// test-mode capabilities equal production-fallback capabilities.
export const TEST_MODE_RUNTIME_MODELS: Record<string, string[]> = {
  codex: ['gpt-5.3-codex'],
  'claude-code': ['claude-sonnet-4-6'],
  copilot: ['copilot-cli'],
}

/** True when the bridge is running an e2e deterministic test request. */
export function isE2eBridgeTest(request: RunRequest): boolean {
  return process.env.AMA_RUNTIME_BRIDGE_TEST_MODE === '1' && request.runtimeConfig?.e2eBridgeTest === true
}

// Classifies a host runtime probe failure into a safe inventory status. The
// raw error message stays on the host: only the classification and a generic
// detail leave the bridge, so credentials never ride along.
export function probeFailureStatus(message: string): 'unauthenticated' | 'unauthorized' | 'limited' | 'unhealthy' {
  if (/unauthoriz|forbidden|\b403\b/i.test(message)) return 'unauthorized'
  if (/unauthent|credential|login|sign[ -]?in|api key|\b401\b/i.test(message)) return 'unauthenticated'
  if (/rate.?limit|quota|too many requests|\b429\b/i.test(message)) return 'limited'
  return 'unhealthy'
}

function deterministicResumeToken(request: RunRequest): string {
  return request.runtime === 'codex' ? `e2e-${request.sessionId}` : request.sessionId
}

// Interactive deterministic runtime for e2e: stays alive after the initial
// prompt so live follow-up prompts and aborts exercise the real handle paths.
export function liveBridgeTestHandle(request: RunRequest): RuntimeProviderHandle {
  const marker = `${request.runtime}-bridge-live`
  // A resumed run continues the conversation instead of replaying the initial
  // prompt — the distinct marker lets acceptance prove no duplicate history.
  const initialMessage = request.resume
    ? `${marker} resumed-with-token:${request.resumeToken ? 'yes' : 'none'}`
    : `${marker} received:${request.prompt}`
  const queue: AmaRuntimeEvent[] = [
    runtimeEvent('turn.started', { status: 'running' }),
    runtimeEvent('message.completed', { message: textMessage('assistant', initialMessage) }),
  ]
  const permission = request.runtimeConfig?.e2eBridgePermission as { action?: string; command?: string } | undefined
  if (permission && typeof permission === 'object') {
    queue.push(
      runtimeEvent('permission.requested', {
        permissionId: `perm_${request.sessionId}`,
        command: permission.command ?? 'printf permission-ok',
      }),
    )
  }
  let ended = false
  let wake: (() => void) | null = null
  const push = (...events: AmaRuntimeEvent[]) => {
    queue.push(...events)
    wake?.()
  }
  const end = () => {
    ended = true
    wake?.()
  }
  return {
    events: (async function* () {
      while (true) {
        while (queue.length > 0) {
          const next = queue.shift()
          if (next) yield next
        }
        if (ended) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = null
      }
    })(),
    async send(message: string) {
      push(
        runtimeEvent('message.completed', { message: textMessage('assistant', `${marker} live-received:${message}`) }),
      )
    },
    async abort() {
      push(runtimeEvent('turn.completed', { status: 'aborted' }))
      end()
    },
    async resolvePermission(permissionId: string, allowed: boolean, reason?: string) {
      if (!allowed) {
        push(
          runtimeEvent('message.completed', {
            message: textMessage('assistant', `${marker} permission-denied:${reason ?? 'denied'}`),
          }),
        )
        return
      }
      const toolCallId = `${permissionId}_tool`
      push(
        messageEvent({
          id: randomId('msg'),
          role: 'assistant',
          content: [toolCallBlock({ id: toolCallId, name: 'bash', input: { command: 'printf permission-ok' } })],
        }),
        messageEvent(
          toolResultMessage(toolCallId, { content: [{ type: 'text', text: 'permission-ok' }], exitCode: 0 }),
        ),
        runtimeEvent('message.completed', { message: textMessage('assistant', `${marker} permission-approved`) }),
      )
    },
    getResumeToken: () => deterministicResumeToken(request),
  }
}

export function deterministicBridgeTestEvents(request: RunRequest): AmaRuntimeEvent[] {
  const marker = `${request.runtime}-bridge-test`
  const toolCallId = `${request.runtime.replace(/[^a-z0-9]/gi, '_')}_tool`
  const receipt = [
    `session:${request.sessionId}`,
    `runtime:${request.runtime}`,
    `workspace:${request.cwd}`,
    `workspaceEnv:${request.env.AMA_WORKSPACE}`,
    `home:${request.env.HOME}`,
    `tmpdir:${request.env.TMPDIR}`,
    `hasAmaToken:${Object.hasOwn(request.env, 'AMA_TOKEN')}`,
    `leakedToken:${Object.values(request.env).includes('raw-secret-value') ? 'raw-secret-value' : 'none'}`,
  ].join('\n')
  return [
    runtimeEvent('turn.started', { status: 'running' }),
    runtimeEvent('message.completed', {
      message: textMessage('assistant', `${marker} received:${request.prompt}\n${receipt}`),
    }),
    messageEvent({
      id: randomId('msg'),
      role: 'assistant',
      content: [
        toolCallBlock({ id: toolCallId, name: 'bash', input: { command: `printf ${request.runtime}-tool-ok` } }),
      ],
    }),
    messageEvent(
      toolResultMessage(toolCallId, { content: [{ type: 'text', text: `${request.runtime}-tool-ok` }], exitCode: 0 }),
    ),
    usageEvent({
      model: `${request.runtime}-bridge-test-model`,
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    }),
    runtimeError(`${marker} safe diagnostic`, 'bridge_test_diagnostic'),
    runtimeEvent('turn.completed', { status: 'completed' }),
  ]
}

// Drives the deterministic/live e2e test-mode run, writing the same NDJSON
// outputs main.ts's production path emits. Records the live handle on state so
// control messages (abort/send/permission) still reach it.
export async function runE2eBridgeTest(
  request: RunRequest,
  state: RunState,
  write: (message: RuntimeBridgeOutputMessage) => void,
): Promise<void> {
  const authFailure = request.runtimeConfig?.e2eBridgeAuthFailure
  if (typeof authFailure === 'string' && authFailure) {
    // Deterministic stand-in for the official runtime reporting an
    // authentication or authorization failure on startup.
    const code = RUNTIME_AUTH_ERROR_CODES[authFailure] ?? 'runtime_auth_unauthorized'
    write(
      sessionEventOutput(
        request.requestId,
        runtimeError(`${request.runtime} authentication failed: ${authFailure.replaceAll('_', ' ')}`, code),
      ),
    )
    write({
      type: 'error',
      requestId: request.requestId,
      error: bridgeError(`${request.runtime} runtime is not authenticated`, code),
    })
    return
  }
  if (request.runtimeConfig?.e2eBridgeLive !== true) {
    for (const event of deterministicBridgeTestEvents(request)) {
      write(sessionEventOutput(request.requestId, event))
    }
    write({ type: 'result', requestId: request.requestId, result: { resumeToken: deterministicResumeToken(request) } })
    return
  }
  const handle = liveBridgeTestHandle(request)
  state.handle = handle
  const emitLiveResumeToken = createResumeTokenWatcher(handle, (resumeToken) => {
    write({ type: 'resumeToken', requestId: request.requestId, resumeToken })
  })
  emitLiveResumeToken()
  for await (const event of handle.events) {
    emitLiveResumeToken()
    write(sessionEventOutput(request.requestId, event))
    emitLiveResumeToken()
  }
  write({ type: 'result', requestId: request.requestId, result: { resumeToken: handle.getResumeToken?.() } })
}
