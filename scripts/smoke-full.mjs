// Full-chain Enbor smoke.
//
// This is intentionally heavier than the focused smoke checks:
// - boots the real local Worker stack through the e2e server script
// - builds and starts a real enbor-runner process
// - creates real control-plane resources over HTTP
// - opens the real browser session WebSocket
// - runs the focused session-socket integration check, including live prompt dispatch
// - verifies live runner events and completed-session backfill after runner reconnect
//
//   pnpm run smoke:real

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import WebSocket from 'ws'

const ROOT = process.cwd()
const RUNTIME = 'codex'
const DONE_MARKER = 'ENBOR_FULL_SMOKE_DONE'
const RESULT_MARKER = 'ENBOR_FULL_SMOKE_RUNTIME_OK'
const SUBAGENT_RESULT = '4'
const BACKFILL_REQUEST_ID = 'full_smoke_backfill'
const timeoutMs = Number(process.env.ENBOR_FULL_SMOKE_TIMEOUT_MS ?? 5 * 60 * 1000)

const packages = {
  type: 'packages',
  apt: [],
  cargo: [],
  gem: [],
  go: [],
  npm: [],
  pip: [],
  webi: [],
}

function info(message) {
  console.log(`[smoke:real] ${message}`)
}

function fail(message, detail) {
  const error = new Error(message)
  error.detail = detail
  error.smokeFatal = true
  throw error
}

function run(command, args, options = {}) {
  info(`${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  })
  if (result.status !== 0) {
    fail(`${command} failed`, [result.stdout, result.stderr].filter(Boolean).join('\n'))
  }
  return result
}

function commandExists(binary) {
  const options = { encoding: 'utf8', stdio: 'pipe' }
  return spawnSync(binary, ['--version'], options).status === 0 || spawnSync(binary, ['--help'], options).status === 0
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'enbor-full-smoke-'))
}

function removeTempRoot(path) {
  const makeDirectoriesWritable = (directory) => {
    chmodSync(directory, 0o700)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) makeDirectoriesWritable(join(directory, entry.name))
    }
  }
  makeDirectoriesWritable(path)
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('failed to allocate a TCP port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

function startProcess(command, args, options) {
  const output = []
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const capture = (chunk) => {
    const text = chunk.toString()
    output.push(text)
    if (output.length > 400) {
      output.splice(0, output.length - 400)
    }
    if (options.prefix) {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        console.log(`[${options.prefix}] ${line}`)
      }
    }
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  return { child, output }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  const signal = (value) => {
    if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, value)
        return
      } catch {
        // Fall back to the direct child below.
      }
    }
    child.kill(value)
  }
  signal('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          signal('SIGKILL')
        }
        resolve()
      }, 5000),
    ),
  ])
}

async function waitFor(predicate, label, options = {}) {
  const started = Date.now()
  const limit = options.timeoutMs ?? timeoutMs
  let lastError = null
  while (Date.now() - started <= limit) {
    try {
      const result = await predicate()
      if (result) {
        return result
      }
    } catch (error) {
      if (error?.smokeFatal === true) {
        throw error
      }
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500))
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

async function waitForReady(origin) {
  await waitFor(async () => {
    const response = await fetch(`${origin}/api/v1/e2e/ready`)
    if (!response.ok) {
      return false
    }
    const body = await response.json()
    return body.ok === true
  }, 'local Worker e2e readiness')
}

async function api(origin, token, path, options = {}) {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  const headers = {
    authorization: `Bearer ${token.accessToken}`,
    'x-enbor-project-id': token.projectId,
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  }
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${text}`)
  }
  return body
}

async function e2eToken(origin, runId) {
  const response = await fetch(`${origin}/api/v1/e2e/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, personal: true }),
  })
  const text = await response.text()
  if (response.status !== 201) {
    throw new Error(`POST /api/v1/e2e/auth/token returned ${response.status}: ${text}`)
  }
  return { ...JSON.parse(text), runnerAccessToken: `e2e-runner:${runId};personal=1` }
}

async function e2eBrowserCookie(origin, accessToken) {
  const response = await fetch(`${origin}/api/v1/e2e/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  })
  if (response.status !== 204) {
    throw new Error(`POST /api/v1/e2e/auth/session returned ${response.status}: ${await response.text()}`)
  }
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error('E2E browser session did not set a cookie')
  return cookie
}

async function sessionSocketTicket(origin, sessionId, cookie) {
  const response = await fetch(`${origin}/api/v1/sessions/${sessionId}/socket-tickets`, {
    method: 'POST',
    headers: { cookie, origin },
  })
  const text = await response.text()
  if (response.status !== 201) {
    throw new Error(`POST /api/v1/sessions/${sessionId}/socket-tickets returned ${response.status}: ${text}`)
  }
  return JSON.parse(text).ticket
}

function managedRunnerEnvironment(temp, credentialPath) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(temp, 'managed-config'),
    XDG_STATE_HOME: join(temp, 'managed-state'),
    ENBOR_RUNNER_CREDENTIALS: credentialPath,
    ENBOR_RUNNER_HEARTBEAT_INTERVAL: '5s',
    ENBOR_RUNNER_LEASE_SECONDS: '30',
    ENBOR_RUNNER_RENEW_INTERVAL: '10s',
    ENBOR_RUNNER_COMMAND_TIMEOUT: '4m',
    ENBOR_RUNNER_SHUTDOWN_GRACE: '5s',
    ENBOR_RUNNER_MAX_SESSION_DURATION: '4m',
    ENBOR_RUNTIME_BRIDGE_HOST_HOME: process.env.ENBOR_RUNTIME_BRIDGE_HOST_HOME ?? process.env.HOME ?? '',
  }
}

function managedStatus(binary, instanceId, env) {
  const result = run(binary, ['status', instanceId, '--output', 'json'], { env })
  const statuses = JSON.parse(result.stdout)
  if (!Array.isArray(statuses) || statuses.length !== 1) {
    fail('managed Runner status did not return exactly one instance', result.stdout)
  }
  return statuses[0]
}

function verifyManagedRunnerLifecycle(binary, origin, token, environmentId, temp, credentialPath) {
  const env = managedRunnerEnvironment(temp, credentialPath)
  let instanceId = null
  try {
    const started = run(
      binary,
      [
        'start',
        '--api-server',
        origin,
        '--project-id',
        token.projectId,
        '--environment-id',
        environmentId,
        '--allow-unsafe-process',
        '--max-concurrent',
        '1',
      ],
      { env },
    )
    instanceId = started.stdout.trim().split(/\s+/, 1)[0]
    if (!instanceId?.startsWith('runner_')) {
      fail('managed Runner start did not return an instance id', started.stdout)
    }
    const first = managedStatus(binary, instanceId, env)
    if (first.localState !== 'ready' || first.controlPlaneState !== 'active' || !first.runnerId) {
      fail('managed Runner did not become locally ready and remotely active', JSON.stringify(first, null, 2))
    }

    run(binary, ['stop', instanceId], { env })
    const stopped = managedStatus(binary, instanceId, env)
    if (stopped.localState !== 'stopped') {
      fail('managed Runner did not stop locally', JSON.stringify(stopped, null, 2))
    }

    run(binary, ['start', instanceId], { env })
    run(binary, ['restart', instanceId], { env })
    const restarted = managedStatus(binary, instanceId, env)
    if (restarted.localState !== 'ready' || restarted.runnerId !== first.runnerId) {
      fail(
        'managed Runner restart did not preserve its remote Runner identity',
        JSON.stringify({ first, restarted }, null, 2),
      )
    }
    info(`verified managed lifecycle for ${instanceId} (${first.runnerId})`)
    return { instanceId, env, status: restarted }
  } catch (error) {
    if (instanceId) {
      const status = spawnSync(binary, ['status', instanceId, '--output', 'json'], { env, encoding: 'utf8' })
      const logs = spawnSync(binary, ['logs', instanceId], { env, encoding: 'utf8' })
      console.error(
        [`managed lifecycle status:\n${status.stdout || status.stderr}`, `managed lifecycle logs:\n${logs.stdout || logs.stderr}`].join(
          '\n',
        ),
      )
      const removal = spawnSync(binary, ['remove', instanceId, '--purge'], { env, encoding: 'utf8' })
      if (removal.status !== 0) {
        error.smokeCleanupFailed = true
        error.detail = [
          error.detail,
          `failed to remove managed Runner ${instanceId}`,
          removal.error?.message,
          removal.stdout,
          removal.stderr,
        ]
          .filter(Boolean)
          .join('\n\n')
      }
    }
    throw error
  }
}

async function waitForRunner(origin, token, environmentId) {
  return await waitFor(async () => {
    const query = new URLSearchParams({ environmentId, state: 'active' })
    const page = await api(origin, token, `/api/v1/runners?${query.toString()}`)
    return page.data?.find((runner) => runner.state === 'active' && runner.environmentId === environmentId)
  }, 'active self-hosted runner')
}

function socketURL(origin, sessionId) {
  const url = new URL(`/api/v1/sessions/${sessionId}/socket`, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function openSocket(url, ticket) {
  return new Promise((resolve, reject) => {
    const origin = url.replace(/^ws/, 'http').replace(/\/api\/v1\/.*$/, '')
    const socket = new WebSocket(url, ['enbor-ticket', `enbor-ticket.${ticket}`], { origin })
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`socket open timed out: ${url}`))
    }, 15_000)
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve(socket)
      },
      { once: true },
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error(`socket failed to open: ${url}`))
      },
      { once: true },
    )
  })
}

function watchSocket(socket) {
  const frames = []
  const waiters = []
  const closed = { value: false, reason: null }
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data))
    frames.push(frame)
    for (const waiter of [...waiters]) {
      if (waiter.predicate(frame)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(frame)
      }
    }
  })
  socket.addEventListener('close', (event) => {
    closed.value = true
    closed.reason = `${event.code} ${event.reason}`.trim()
    for (const waiter of waiters.splice(0)) {
      waiter.reject(new Error(`socket closed while waiting for ${waiter.label}: ${closed.reason}`))
    }
  })
  socket.addEventListener('error', () => {
    for (const waiter of waiters.splice(0)) {
      waiter.reject(new Error(`socket errored while waiting for ${waiter.label}`))
    }
  })
  return {
    frames,
    async waitFor(predicate, label, limitMs = timeoutMs) {
      const existing = frames.find(predicate)
      if (existing) {
        return existing
      }
      if (closed.value) {
        throw new Error(`socket is closed while waiting for ${label}: ${closed.reason}`)
      }
      return await new Promise((resolve, reject) => {
        const waiter = { predicate, label, resolve, reject }
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          reject(new Error(`timed out waiting for socket frame: ${label}`))
        }, limitMs)
        waiters.push({
          ...waiter,
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
      })
    },
    requestBackfill(limit = 200) {
      socket.send(JSON.stringify({ type: 'backfill', requestId: BACKFILL_REQUEST_ID, limit }))
    },
    close() {
      socket.close(1000, 'smoke complete')
    },
  }
}

function frameContains(frame, marker) {
  return JSON.stringify(frame).includes(marker)
}

function eventRecord(value) {
  return value?.record ?? value
}

function hasExactAssistantText(value, expected) {
  const record = eventRecord(value)
  const message = record?.payload?.message
  return (
    message?.role === 'assistant' &&
    Array.isArray(message.content) &&
    message.content.some(
      (block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim() === expected,
    )
  )
}

function isAssistantTextMessage(value) {
  const message = eventRecord(value)?.payload?.message
  return (
    message?.role === 'assistant' &&
    Array.isArray(message.content) &&
    message.content.some((block) => block?.type === 'text' && typeof block.text === 'string')
  )
}

function eventTypes(frames) {
  return frames
    .filter((frame) => frame.type === 'event')
    .map((frame) => frame.record?.type)
    .filter(Boolean)
}

function assertToolEvents(label, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  if (!serialized.includes('"type":"tool_call"')) {
    fail(`${label} is missing a tool_call content block`, serialized)
  }
  if (!serialized.includes('"type":"tool_result"')) {
    fail(`${label} is missing a tool_result content block`, serialized)
  }
}

function workspacePaths(workDir, sessionId) {
  const sessionDir = join(workDir, 'sessions', sessionId)
  return {
    sessionDir,
    workspace: join(sessionDir, 'workspace'),
    eventLog: join(sessionDir, 'events.jsonl'),
    resultFile: join(sessionDir, 'workspace', 'enbor-full-smoke-result.txt'),
  }
}

function listTree(root, limit = 120) {
  if (!existsSync(root)) {
    return `${root} does not exist`
  }
  const rows = []
  const walk = (dir, prefix = '') => {
    if (rows.length >= limit) {
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (rows.length >= limit) {
        return
      }
      const relative = `${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`
      rows.push(relative)
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${relative}`)
      }
    }
  }
  walk(root)
  return rows.length > 0 ? rows.join('\n') : `${root} is empty`
}

function assertWorkspace(workDir, sessionId, identity) {
  const paths = workspacePaths(workDir, sessionId)
  statSync(paths.workspace)
  const result = readFileSync(paths.resultFile, 'utf8')
  if (result !== `${RESULT_MARKER}\n`) {
    fail('runtime did not write the expected workspace result file', `${paths.resultFile}: ${JSON.stringify(result)}`)
  }
  const eventLog = readFileSync(paths.eventLog, 'utf8')
  if (!eventLog.includes(DONE_MARKER)) {
    fail('runner local event log does not include the final assistant marker', paths.eventLog)
  }
  assertToolEvents('runner local event log', eventLog)
  const issuerDir = Buffer.from(identity.status.descriptor.issuer).toString('base64url')
  const runtimeFile = `${Buffer.from(identity.spec.runtime).toString('base64url')}.json`
  const statePath = join(paths.workspace, '.enbor', 'realmroot-state', 'identities', issuerDir, runtimeFile)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  const stableAgentId = state.identity?.id ?? state.agent_id
  if (state.runtime !== identity.spec.runtime || stableAgentId !== identity.status.descriptor.agentId) {
    fail(
      'runner materialized Realmroot state does not match the bound Identity',
      JSON.stringify(
        {
          statePath,
          expected: { runtime: identity.spec.runtime, agentId: identity.status.descriptor.agentId },
          actual: { runtime: state.runtime, agentId: stableAgentId },
        },
        null,
        2,
      ),
    )
  }
}

function recentOutput(output) {
  return output.join('').split(/\r?\n/).slice(-120).join('\n')
}

async function main() {
  run('pnpm', ['exec', 'vitest', 'run', '--project', 'integration', 'server/integration/runner-relay.test.ts'])

  if (!commandExists('codex')) {
    fail('codex CLI is required for full smoke')
  }
  const temp = tempRoot()
  const runnerBinary = join(temp, 'enbor-runner')
  const credentialPath = join(temp, 'credentials.json')
  const runId = `full-smoke-${Date.now()}`
  const port = Number(process.env.E2E_PORT || (await findFreePort()))
  const origin = `http://localhost:${port}`
  let server = null
  let managedRunner = null
  let socket = null
  let secondSocket = null
  let token = null
  let sessionId = null
  let failure = null
  let preserveTempAfterCleanupFailure = false

  try {
    run('pnpm', ['run', 'bridge:build'])
    run('go', ['build', '-o', runnerBinary, '.'], { cwd: join(ROOT, 'cmd/enbor-runner') })

    info(`starting local e2e server on ${origin}`)
    server = startProcess('pnpm', ['run', 'e2e:server'], {
      env: { ...process.env, E2E_PORT: String(port), E2E_FAKE_REALMROOT_ENROLLMENT: 'true' },
    })
    await waitForReady(origin)
    token = await e2eToken(origin, runId)
    writeFileSync(
      credentialPath,
      JSON.stringify({
        active: `${origin}#${runId}`,
        profiles: [
          {
            accountId: runId,
            apiServer: origin,
            accessToken: token.runnerAccessToken,
            tokenType: 'Bearer',
            dpopPrivateKey: 'e2e-only',
          },
        ],
      }),
      { mode: 0o600 },
    )
    info(`using project ${token.projectId}`)

    await api(origin, token, '/api/v1/e2e/catalog/seed', { method: 'POST', body: {} })
    const environment = await api(origin, token, '/api/v1/environments', {
      method: 'POST',
      body: {
        metadata: { name: `full-smoke-env-${runId}` },
        spec: {
          scope: 'project',
          type: 'self_hosted',
          networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
          packages,
          variables: {},
        },
      },
    })
    const environmentId = environment.metadata.uid
    managedRunner = verifyManagedRunnerLifecycle(runnerBinary, origin, token, environmentId, temp, credentialPath)
    const { stateDir, workDir } = managedRunner.status
    if (!stateDir || !workDir) {
      fail('managed Runner status did not expose its automatically selected storage paths')
    }
    await waitForReady(origin)

    const identity = await api(origin, token, '/api/v1/identities', {
      method: 'POST',
      headers: { 'idempotency-key': `full-smoke-identity-${runId}` },
      body: {
        metadata: { name: `full-smoke-identity-${runId}` },
        spec: { username: `smoke-${Date.now()}`, runtime: RUNTIME },
      },
    })
    if (identity.spec.runtime !== RUNTIME || identity.status.state !== 'active') {
      fail('Identity did not provision with the smoke Runtime', JSON.stringify(identity, null, 2))
    }

    const agent = await api(origin, token, '/api/v1/agents', {
      method: 'POST',
      body: {
        metadata: { name: `full-smoke-agent-${runId}` },
        spec: {
          systemPrompt: [
            'You are running the Enbor full-chain smoke test.',
            'Before using any file or shell tool, you MUST call the spawn_agent collaboration tool exactly once with the arithmetic-checker agent and ask it to reply only 4 for 2+2.',
            'You MUST call wait for that child and receive 4 before continuing. If the child result is unavailable, fail instead of completing the task.',
            'After the child returns 4, use the shell tool to run pwd exactly once.',
            `Write exactly "${RESULT_MARKER}\\n" to enbor-full-smoke-result.txt in the workspace root.`,
            `When done, reply exactly "${DONE_MARKER}".`,
          ].join('\n'),
          skills: [],
          subagents: [
            {
              name: 'arithmetic-checker',
              description: 'Answers one arithmetic smoke-test question.',
              systemPrompt: 'Answer the delegated arithmetic question exactly and do not modify files.',
            },
          ],
          mcpConnectors: [],
          identityRef: identity.metadata.uid,
        },
      },
    })

    if (agent.spec.provider !== null || agent.spec.model !== null) {
      fail('Agent unexpectedly pinned a platform provider or model', JSON.stringify(agent.spec, null, 2))
    }

    const session = await api(origin, token, '/api/v1/sessions', {
      method: 'POST',
      body: {
        metadata: { labels: { smoke: 'full' } },
        spec: {
          agentId: agent.metadata.uid,
          environmentId,
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
        prompt: [
          'Run the full-chain Enbor smoke test.',
          `Before any other tool call, you MUST call spawn_agent exactly once with subagent type arithmetic-checker and prompt it to answer only "${SUBAGENT_RESULT}" for 2+2.`,
          `Then you MUST call wait for that child and receive "${SUBAGENT_RESULT}" before using file or shell tools.`,
          'After the child returns 4, use the shell tool to run pwd exactly once.',
          `Ensure enbor-full-smoke-result.txt contains exactly "${RESULT_MARKER}\\n".`,
          `Reply exactly "${DONE_MARKER}" and nothing else.`,
        ].join('\n'),
      },
    })
    sessionId = session.metadata.uid
    if (session.spec.runtime !== RUNTIME || session.status?.bindings?.agent?.snapshot?.identity?.identityId !== identity.metadata.uid) {
      fail('Session did not inherit the bound Identity Runtime', JSON.stringify(session, null, 2))
    }
    info(`created session ${sessionId}`)

    const browserCookie = await e2eBrowserCookie(origin, token.accessToken)
    const ticket = await sessionSocketTicket(origin, sessionId, browserCookie)
    socket = watchSocket(await openSocket(socketURL(origin, sessionId), ticket))
    await waitForRunner(origin, token, environmentId)
    await socket.waitFor(
      (frame) => frame.type === 'event' && frame.record?.type === 'runtime.started',
      'runtime.started',
    )
    const completedSession = await waitFor(async () => {
      const current = await api(origin, token, `/api/v1/sessions/${sessionId}`)
      if (current.status?.phase === 'error') {
        fail('session entered error phase', JSON.stringify(current.status, null, 2))
      }
      return current.status?.phase === 'idle' || current.status?.phase === 'stopped' ? current : false
    }, 'session completion')
    if (completedSession.status?.phase !== 'idle' && completedSession.status?.phase !== 'stopped') {
      fail('session did not complete cleanly', JSON.stringify(completedSession.status, null, 2))
    }
    const finalAssistantFrame = await socket.waitFor(
      (frame) => frame.type === 'event' && isAssistantTextMessage(frame),
      'final assistant message',
      10_000,
    )
    if (!hasExactAssistantText(finalAssistantFrame, DONE_MARKER)) {
      fail('runtime completed without the expected final assistant marker', JSON.stringify(finalAssistantFrame, null, 2))
    }
    assertToolEvents('live browser socket events', socket.frames)

    assertWorkspace(workDir, sessionId, identity)
    const restEvents = await api(origin, token, `/api/v1/sessions/${sessionId}/events`)
    if (!Array.isArray(restEvents.data) || !restEvents.data.some((event) => hasExactAssistantText(event, DONE_MARKER))) {
      fail('REST session events do not include the completed runtime event', JSON.stringify(restEvents, null, 2))
    }
    assertToolEvents('REST session events', restEvents.data)

    socket.requestBackfill()
    const firstBackfill = await socket.waitFor(
      (frame) => frame.type === 'backfill' && frame.requestId === BACKFILL_REQUEST_ID,
      'initial completed-session backfill',
    )
    if (
      !Array.isArray(firstBackfill.events) ||
      !firstBackfill.events.some((event) => hasExactAssistantText(event, DONE_MARKER))
    ) {
      fail('browser socket backfill does not include the completed runtime event', JSON.stringify(firstBackfill, null, 2))
    }
    assertToolEvents('initial completed-session backfill', firstBackfill.events)

    run(runnerBinary, ['restart', managedRunner.instanceId], { env: managedRunner.env })
    await waitForRunner(origin, token, environmentId)

    const reconnectTicket = await sessionSocketTicket(origin, sessionId, browserCookie)
    secondSocket = watchSocket(await openSocket(socketURL(origin, sessionId), reconnectTicket))
    const reconnectBackfill = await secondSocket.waitFor(
      (frame) => frame.type === 'backfill',
      'automatic backfill after runner reconnect',
    )
    if (reconnectBackfill.type === 'runner_unavailable') {
      fail('completed session backfill reported runner_unavailable after runner reconnect')
    }
    if (
      !Array.isArray(reconnectBackfill.events) ||
      !reconnectBackfill.events.some((event) => hasExactAssistantText(event, DONE_MARKER))
    ) {
      secondSocket.requestBackfill()
      const explicitBackfill = await secondSocket.waitFor(
        (frame) => frame.type === 'backfill' && frame.requestId === BACKFILL_REQUEST_ID,
        'explicit backfill after runner reconnect',
      )
      if (
        !Array.isArray(explicitBackfill.events) ||
        !explicitBackfill.events.some((event) => hasExactAssistantText(event, DONE_MARKER))
      ) {
        fail(
          'completed session backfill after runner reconnect does not include the runtime event',
          JSON.stringify({ automatic: reconnectBackfill, explicit: explicitBackfill }, null, 2),
        )
      }
      assertToolEvents('explicit backfill after runner reconnect', explicitBackfill.events)
    } else {
      assertToolEvents('automatic backfill after runner reconnect', reconnectBackfill.events)
    }

    const types = eventTypes(socket.frames)
    info(`verified ${sessionId}; live event types: ${types.join(', ')}`)
    info('Enbor full-chain smoke passed')
  } catch (error) {
    preserveTempAfterCleanupFailure = error?.smokeCleanupFailed === true
    const liveDiagnostics = []
    if (token && sessionId) {
      try {
        liveDiagnostics.push(
          `session:\n${JSON.stringify(await api(origin, token, `/api/v1/sessions/${sessionId}`), null, 2)}`,
        )
      } catch (diagnosticError) {
        liveDiagnostics.push(`session diagnostic failed: ${diagnosticError.message}`)
      }
      try {
        const query = new URLSearchParams({ sessionId, limit: '20' })
        liveDiagnostics.push(
          `work items:\n${JSON.stringify(await api(origin, token, `/api/v1/work-items?${query.toString()}`), null, 2)}`,
        )
      } catch (diagnosticError) {
        liveDiagnostics.push(`work item diagnostic failed: ${diagnosticError.message}`)
      }
    }
    const details = [
      `origin: ${origin}`,
      token ? `projectId: ${token.projectId}` : null,
      sessionId ? `sessionId: ${sessionId}` : null,
      sessionId && managedRunner?.status.workDir && existsSync(managedRunner.status.workDir)
        ? `sessionDir: ${workspacePaths(managedRunner.status.workDir, sessionId).sessionDir}`
        : null,
      managedRunner?.status.workDir && existsSync(managedRunner.status.workDir)
        ? `workDir tree:\n${listTree(managedRunner.status.workDir)}`
        : null,
      managedRunner?.status.stateDir && existsSync(managedRunner.status.stateDir)
        ? `stateDir tree:\n${listTree(managedRunner.status.stateDir)}`
        : null,
      ...liveDiagnostics,
      server ? `e2e server output:\n${recentOutput(server.output)}` : null,
      managedRunner
        ? `runner logs:\n${spawnSync(runnerBinary, ['logs', managedRunner.instanceId], { env: managedRunner.env, encoding: 'utf8' }).stdout}`
        : null,
      socket ? `socket frames:\n${JSON.stringify(socket.frames.slice(-20), null, 2)}` : null,
      secondSocket ? `second socket frames:\n${JSON.stringify(secondSocket.frames.slice(-20), null, 2)}` : null,
    ].filter(Boolean)
    failure = {
      message: error instanceof Error ? error.message : String(error),
      detail: [error instanceof Error ? error.detail : null, details.join('\n\n')].filter(Boolean).join('\n\n'),
    }
  } finally {
    socket?.close()
    secondSocket?.close()
    let managedRunnerRemoved = !preserveTempAfterCleanupFailure
    if (managedRunner) {
      const removal = spawnSync(runnerBinary, ['remove', managedRunner.instanceId, '--purge'], {
        env: managedRunner.env,
        encoding: 'utf8',
      })
      if (removal.status !== 0) {
        managedRunnerRemoved = false
        const cleanupMessage = `failed to remove managed Runner ${managedRunner.instanceId}; retained smoke temp directory: ${temp}`
        const cleanupDetail = [removal.error?.message, removal.stdout, removal.stderr].filter(Boolean).join('\n')
        failure = failure
          ? { ...failure, detail: [failure.detail, cleanupMessage, cleanupDetail].filter(Boolean).join('\n\n') }
          : { message: cleanupMessage, detail: cleanupDetail }
      }
    }
    await stopProcess(server?.child)
    if (process.env.ENBOR_FULL_SMOKE_KEEP_TEMP === 'true') {
      info(`retained smoke temp directory by request: ${temp}`)
    } else if (!managedRunnerRemoved) {
      info(`retained smoke temp directory after managed Runner cleanup failure: ${temp}`)
    } else {
      try {
        removeTempRoot(temp)
      } catch {
        const cleanupMessage = `failed to remove smoke temp directory: ${temp}`
        failure = failure
          ? { ...failure, detail: [failure.detail, cleanupMessage].filter(Boolean).join('\n\n') }
          : { message: cleanupMessage, detail: '' }
      }
    }
  }
  if (failure) {
    console.error(`\nsmoke failed: ${failure.message}`)
    if (server) {
      console.error(`e2e server exit: code=${server.child.exitCode} signal=${server.child.signalCode}`)
    }
    if (failure.detail) {
      console.error(failure.detail)
    }
    process.exitCode = 1
  }
}

await main()
