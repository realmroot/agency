// Smoke test for the runner-side runtime surface.
//
// Enbor is the first-party runtime and is executed through the runner's Go tool
// adapter. Codex, Claude Code, and Copilot are CLI-backed runtimes hosted by the
// Node bridge. This smoke exercises that bridge in deterministic test mode and
// asserts that Enbor is not accidentally routed through the CLI-backed provider path.
//
//   pnpm run smoke:mock
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'

const BUNDLE = join(process.cwd(), 'cmd', 'enbor-runner', 'pkg', 'runtimebridge', 'bundle.mjs')
let passed = 0
let failed = 0

const ok = (name, cond, detail = '') => {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` ${detail}` : ''}`)
  }
}

function startBridge() {
  const child = spawn('node', [BUNDLE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AMA_RUNTIME_BRIDGE_TEST_MODE: '1' },
  })
  const events = []
  const outputs = []
  const waiters = []

  const notify = () => {
    for (const waiter of waiters.slice()) {
      if (waiter.pred()) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve()
      }
    }
  }

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    outputs.push(msg)
    if (msg.type === 'runtime.event' && msg.event && typeof msg.event.type === 'string') {
      events.push(msg.event)
    }
    notify()
  })
  child.stderr.on('data', () => {})

  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`)
  const until = (pred, ms = 10000) =>
    new Promise((resolve, reject) => {
      if (pred()) return resolve()
      const waiter = { pred, resolve }
      waiters.push(waiter)
      setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error(`timeout after ${ms}ms`))
      }, ms)
    })
  const waitReady = (ms = 5000) => until(() => outputs.some((message) => message.type === 'ready'), ms)
  const waitForResult = (requestId, ms = 10000) =>
    until(() => outputs.some((message) => message.type === 'result' && message.requestId === requestId), ms)
  const waitForError = (requestId, ms = 10000) =>
    until(() => outputs.some((message) => message.type === 'error' && message.requestId === requestId), ms)
  const waitForEventCount = (type, n, ms = 10000) =>
    until(() => events.filter((event) => event.type === type).length >= n, ms)

  return {
    child,
    events,
    outputs,
    send,
    waitReady,
    waitForResult,
    waitForError,
    waitForEventCount,
    waitUntil: until,
    stop: () => {
      if (child.exitCode === null) child.kill()
    },
  }
}

const requestBase = (runtime, requestId, overrides = {}) => ({
  type: 'run',
  requestId,
  runtime,
  sessionId: requestId,
  cwd: mkdtempSync(join(tmpdir(), `ama-${runtime}-smoke-`)),
  env: {},
  prompt: `Smoke ${runtime}.`,
  provider: `provider_${runtime}`,
  model: `${runtime}-model`,
  runtimeConfig: { e2eBridgeTest: true },
  agentSnapshot: { instructions: 'Smoke test agent.' },
  ...overrides,
})

async function bridgeInventory() {
  console.log('\n[bridge] runtime inventory')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'inventory_all'
  bridge.send({ type: 'inventory', requestId, env: {}, includeUsage: true })
  await bridge.waitForResult(requestId)
  const result = bridge.outputs.find((message) => message.requestId === requestId && message.type === 'result')?.result
  const runtimes = Array.isArray(result?.runtimes) ? result.runtimes : []
  for (const runtime of ['codex', 'claude-code', 'copilot']) {
    const entry = runtimes.find((item) => item.runtime === runtime)
    ok(`${runtime} inventory entry`, Boolean(entry), `(result=${JSON.stringify(result)})`)
    ok(`${runtime} installed in test mode`, entry?.installed === true)
    ok(`${runtime} reports models or fallback`, Boolean(entry?.models?.length || entry?.fallbackModels?.length))
  }
  bridge.stop()
}

async function deterministicRun(runtime) {
  console.log(`\n[${runtime}] deterministic bridge run`)
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = `run_${runtime.replace(/[^a-z0-9]/gi, '_')}`
  bridge.send(requestBase(runtime, requestId))
  await bridge.waitForResult(requestId)
  const types = bridge.events.map((event) => event.type)
  const payloads = bridge.events.map((event) => JSON.stringify(event.payload)).join('\n')
  const result = bridge.outputs.find((message) => message.requestId === requestId && message.type === 'result')?.result
  ok('emitted turn.started', types.includes('turn.started'))
  ok('emitted assistant message', types.includes('message.completed'))
  ok('emitted sandbox tool call block', payloads.includes('"type":"tool_call"'))
  ok('emitted sandbox tool result block', payloads.includes('"type":"tool_result"'))
  ok('emitted usage.recorded', types.includes('usage.recorded'))
  ok('emitted turn.completed', types.includes('turn.completed'))
  ok('returned resume token', typeof result?.resumeToken === 'string' && result.resumeToken.length > 0)
  bridge.stop()
}

async function liveRunWithPrompt() {
  console.log('\n[claude-code] live bridge controls')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'run_claude_live'
  bridge.send(
    requestBase('claude-code', requestId, {
      runtimeConfig: { e2eBridgeTest: true, e2eBridgeLive: true },
      model: 'claude-sonnet-4-6',
    }),
  )
  await bridge.waitForEventCount('message.completed', 1)
  bridge.send({ type: 'send', requestId, message: 'Follow-up prompt.' })
  await bridge.waitForEventCount('message.completed', 2)
  bridge.send({ type: 'abort', requestId })
  await bridge.waitForResult(requestId)
  const messagePayload = bridge.events
    .filter((event) => event.type === 'message.completed')
    .map((event) => JSON.stringify(event.payload))
    .join('\n')
  ok('initial prompt reached live runtime', messagePayload.includes('received:Smoke claude-code.'))
  ok('follow-up prompt reached live runtime', messagePayload.includes('live-received:Follow-up prompt.'))
  ok('abort completed the live run', bridge.events.some((event) => event.type === 'turn.completed'))
  bridge.stop()
}

async function livePermissionFlow() {
  console.log('\n[copilot] permission bridge controls')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'run_copilot_permission'
  bridge.send(
    requestBase('copilot', requestId, {
      runtimeConfig: {
        e2eBridgeTest: true,
        e2eBridgeLive: true,
        e2eBridgePermission: { action: 'shell', command: 'printf permission-ok' },
      },
      model: 'copilot-cli',
    }),
  )
  await bridge.waitForEventCount('permission.requested', 1)
  const permission = bridge.events.find((event) => event.type === 'permission.requested')?.payload
  bridge.send({ type: 'permissionDecision', requestId, permissionId: permission?.permissionId, allowed: true })
  await bridge.waitUntil(() => bridge.events.some((event) => JSON.stringify(event.payload).includes('permission-ok')))
  bridge.send({ type: 'abort', requestId })
  await bridge.waitForResult(requestId)
  const payloads = bridge.events.map((event) => JSON.stringify(event.payload)).join('\n')
  ok('permission request emitted', typeof permission?.permissionId === 'string' && permission.permissionId.length > 0)
  ok('approved permission executed sandbox tool', payloads.includes('permission-ok'))
  bridge.stop()
}

async function enborRejectedByBridge() {
  console.log('\n[ama] first-party runtime boundary')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'run_ama_rejected'
  bridge.send(requestBase('ama', requestId, { runtimeConfig: {} }))
  await bridge.waitForError(requestId)
  const error = bridge.outputs.find((message) => message.requestId === requestId && message.type === 'error')?.error
  ok('ama is not a runner SDK bridge provider', String(error?.message ?? '').includes('Unsupported runtime provider: ama'))
  bridge.stop()
}

async function main() {
  console.log(`Smoke testing runner runtime bridge: ${BUNDLE}`)
  await bridgeInventory()
  await deterministicRun('codex')
  await liveRunWithPrompt()
  await livePermissionFlow()
  await enborRejectedByBridge()
  console.log(`\n=== smoke: ${passed} passed, ${failed} failed ===`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('smoke harness error:', error)
  process.exit(2)
})
