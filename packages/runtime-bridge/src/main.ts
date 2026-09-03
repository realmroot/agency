import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import { assertEnborRuntimeEvent } from './events/enbor'
import { resolveCliPath } from './host/cli'
import {
  bridgeError,
  createResumeTokenWatcher,
  type EnborRuntimeEvent,
  type RuntimeBridgeInputMessage,
  type RuntimeBridgeOutputMessage,
  type RuntimeInventoryEntry,
} from './protocol'
import { getProvider, listProviders } from './providers/registry'
import { isE2eBridgeTest, probeFailureStatus, runE2eBridgeTest, TEST_MODE_RUNTIME_MODELS } from './run-modes'
import { createRuntimeControlQueue } from './runtime-controls'

type ActiveRun = {
  controls: ReturnType<typeof createRuntimeControlQueue>
}

const active = new Map<string, ActiveRun>()

function write(message: RuntimeBridgeOutputMessage) {
  stdout.write(`${JSON.stringify(message)}\n`)
}

function writeSessionEvent(requestId: string, event: EnborRuntimeEvent) {
  const canonical = assertEnborRuntimeEvent(event)
  write({
    type: 'runtime.event',
    requestId,
    event: canonical,
  })
}

function writeProviderEvent(
  request: Extract<RuntimeBridgeInputMessage, { type: 'run' }>,
  event: Record<string, unknown>,
) {
  write({
    type: 'provider.event',
    requestId: request.requestId,
    runtime: request.runtime,
    event,
  })
}

function parseInput(line: string): RuntimeBridgeInputMessage | null {
  const record = JSON.parse(line) as RuntimeBridgeInputMessage
  if (!record || typeof record !== 'object' || !('type' in record)) {
    throw new Error('Bridge input must be an object with type')
  }
  return record
}

async function run(request: Extract<RuntimeBridgeInputMessage, { type: 'run' }>) {
  const state: ActiveRun = {
    controls: createRuntimeControlQueue((reason) => {
      writeSessionEvent(request.requestId, {
        type: 'runtime.error',
        payload: { message: `Runtime rejected injected prompt: ${reason}`, code: 'runtime_prompt_rejected' },
      })
    }),
  }
  active.set(request.requestId, state)
  try {
    if (isE2eBridgeTest(request)) {
      await runE2eBridgeTest(request, state, write)
      return
    }
    const provider = getProvider(request.runtime)
    const handle = await provider.execute({
      ...request,
      emitProviderEvent: (event) => writeProviderEvent(request, event),
    })
    await state.controls.attach(handle)
    // Surface the resume token as soon as the provider learns it so the runner
    // can persist it via lease renewals; waiting for the final result message
    // loses the token when the runner is interrupted mid-run.
    const emitResumeToken = createResumeTokenWatcher(handle, (resumeToken) => {
      write({ type: 'resumeToken', requestId: request.requestId, resumeToken })
    })
    emitResumeToken()
    for await (const event of handle.events) {
      emitResumeToken()
      writeSessionEvent(request.requestId, event)
      emitResumeToken()
    }
    write({ type: 'result', requestId: request.requestId, result: { resumeToken: handle.getResumeToken?.() } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    write({ type: 'error', requestId: request.requestId, error: bridgeError(message, 'runtime_bridge_error') })
  } finally {
    active.delete(request.requestId)
  }
}

async function inventory(request: Extract<RuntimeBridgeInputMessage, { type: 'inventory' }>) {
  const runtimes: RuntimeInventoryEntry[] = []
  const bridgeTestMode = process.env.ENBOR_RUNTIME_BRIDGE_TEST_MODE === '1'
  for (const provider of listProviders()) {
    const installed = bridgeTestMode || Boolean(resolveCliPath(provider.binary))
    if (!installed) {
      runtimes.push({
        runtime: provider.name,
        binary: provider.binary,
        installed: false,
        fallbackModels: provider.fallbackModels,
        models: [],
        status: 'missing',
        detail: `${provider.binary} CLI not found on PATH`,
      })
      continue
    }
    let models: string[] = []
    let status = 'ready'
    let detail = 'host CLI is available'
    try {
      if (bridgeTestMode) {
        models = TEST_MODE_RUNTIME_MODELS[provider.name] ?? []
        detail = 'deterministic bridge test runtime'
      } else {
        models = provider.listModels ? ((await provider.listModels({ env: request.env })) ?? []) : []
        if (models && models.length > 0) {
          detail = `host CLI enumerated ${models.length} models`
        } else {
          status = 'unauthenticated'
          detail = 'host CLI exposed no models; authenticate the runtime CLI'
        }
      }
    } catch (err) {
      status = probeFailureStatus(err instanceof Error ? err.message : String(err))
      detail = 'host model enumeration failed'
    }

    let usageWindows = null
    let limitedDetail: string | null = null
    if (request.includeUsage && provider.fetchUsage && !bridgeTestMode) {
      try {
        usageWindows = await provider.fetchUsage({ env: request.env })
      } catch {
        usageWindows = null
      }
      if ((!usageWindows || usageWindows.length === 0) && provider.usageUnavailableDetail) {
        limitedDetail = provider.usageUnavailableDetail
      }
    }

    runtimes.push({
      runtime: provider.name,
      binary: provider.binary,
      installed: true,
      fallbackModels: provider.fallbackModels,
      models,
      status,
      detail,
      ...(usageWindows ? { usageWindows } : {}),
      ...(limitedDetail ? { limitedDetail } : {}),
    })
  }
  write({ type: 'result', requestId: request.requestId, result: { runtimes } })
}

async function control(message: Exclude<RuntimeBridgeInputMessage, { type: 'run' | 'inventory' }>) {
  const state = active.get(message.requestId)
  if (!state) {
    write({
      type: 'error',
      requestId: message.requestId,
      error: bridgeError('No active runtime request', 'no_active_request'),
    })
    return
  }
  await state.controls.dispatch(message)
}

write({ type: 'ready' })

const lines = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY })
lines.on('line', (line) => {
  if (!line.trim()) return
  void (async () => {
    try {
      const message = parseInput(line)
      if (!message) return
      if (message.type === 'run') {
        await run(message)
      } else if (message.type === 'inventory') {
        await inventory(message)
      } else {
        await control(message)
      }
    } catch (err) {
      write({
        type: 'error',
        requestId: 'unknown',
        error: bridgeError(err instanceof Error ? err.message : String(err), 'invalid_bridge_input'),
      })
    }
  })()
})
