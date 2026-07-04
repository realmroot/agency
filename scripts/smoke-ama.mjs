// End-to-end AMA runner smoke.
//
// This starts a real ama-runner process against a local v1 control-plane stub.
// The control plane is fake; the runner process, workspace preparation, embedded
// runtime bridge, local runtime CLI, event store, lease completion, and memory
// writeback are real.
//
//   pnpm run smoke:ama
//
// Optional:
//   AMA_SMOKE_RUNTIME=codex|claude-code|copilot pnpm run smoke:ama
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SESSION_ID = 'session_smoke'
const WORK_ITEM_ID = 'work_smoke'
const LEASE_ID = 'lease_smoke'
const RUNNER_ID = 'runner_smoke'
const TOKEN = 'smoke-token'
const PROJECT_ID = 'project_smoke'
const MEMORY_STORE_ID = 'memstore_smoke'
const SMOKE_DONE_MARKER = 'AMA_SMOKE_DONE'
const FOLLOW_UP_MARKER = 'AMA_SMOKE_FOLLOW_UP_DONE'
const RESUME_STARTED_MARKER = 'AMA_SMOKE_RESUME_STARTED'
const RESUMED_MARKER = 'AMA_SMOKE_RESUMED'
const MEMORY_UPDATED_MARKER = 'AMA_SMOKE_MEMORY_UPDATED'
const SYSTEM_PROMPT_MARKER = 'AMA_SMOKE_SYSTEM_PROMPT_REACHED'
const RESULT_MARKER = 'AMA_SMOKE_RUNTIME_OK'
const DEFAULT_SMOKE_GIT_REPOSITORY_URL = 'https://github.com/saltbo/slink.git'
const timeoutMs = Number(process.env.AMA_SMOKE_TIMEOUT_MS ?? 4 * 60 * 1000)

function gitSmokeConfig() {
  const repositoryUrl = DEFAULT_SMOKE_GIT_REPOSITORY_URL
  const parsed = new URL(repositoryUrl)
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail('Default smoke Git repository URL must be a safe HTTPS git repository URL')
  }
  const repositoryPath = [parsed.hostname, ...parsed.pathname.replace(/\.git$/i, '').split('/').filter(Boolean)]
  if (repositoryPath.length < 3) {
    fail('Default smoke Git repository URL must include a repository path')
  }
  const token = process.env.AMA_SMOKE_GIT_TOKEN?.trim()
  return {
    url: repositoryUrl,
    ref: process.env.AMA_SMOKE_GIT_REF?.trim() || '',
    token,
    mountPath: `/workspace/repos/${repositoryPath.join('/')}`,
    relativePath: `repos/${repositoryPath.join('/')}`,
  }
}

const runtimeMatrix = {
  codex: {
    binary: 'codex',
    provider: 'provider_codex',
    model: 'gpt-5.3-codex',
    runtimeConfig: { model: 'gpt-5.3-codex' },
  },
  'claude-code': {
    binary: 'claude',
    provider: 'provider_claude_code',
    model: 'claude-sonnet-4-6',
    runtimeConfig: { model: 'claude-sonnet-4-6' },
  },
  copilot: {
    binary: 'copilot',
    provider: 'provider_copilot',
    model: 'copilot-cli',
    runtimeConfig: { approvalMode: 'auto', model: 'copilot-cli' },
  },
}

function fail(message, detail) {
  console.error(`\nsmoke failed: ${message}`)
  if (detail) console.error(detail)
  process.exit(1)
}

function info(message) {
  console.log(`[smoke:ama] ${message}`)
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
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', stdio: 'pipe' })
  return result.status === 0
}

function selectRuntime() {
  const requested = process.env.AMA_SMOKE_RUNTIME?.trim()
  if (requested) {
    const selected = runtimeMatrix[requested]
    if (!selected) fail(`unsupported AMA_SMOKE_RUNTIME "${requested}"`)
    if (!commandExists(selected.binary)) fail(`requested runtime binary "${selected.binary}" is not available on PATH`)
    return { name: requested, ...selected }
  }
  for (const name of ['codex', 'claude-code', 'copilot']) {
    const selected = runtimeMatrix[name]
    if (commandExists(selected.binary)) return { name, ...selected }
  }
  fail('no local runtime CLI is available; install or login to codex, claude, or copilot')
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function websocketAccept(key) {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
}

function sendWebSocket(socket, value, opcode = 0x1) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  let header
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  socket.write(Buffer.concat([header, payload]))
}

function parseWebSocketFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let headerLength = 2
    if (length === 126) {
      if (offset + 4 > buffer.length) break
      length = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break
      length = Number(buffer.readBigUInt64BE(offset + 2))
      headerLength = 10
    }
    const maskLength = masked ? 4 : 0
    const frameLength = headerLength + maskLength + length
    if (offset + frameLength > buffer.length) break
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : undefined
    const payloadStart = offset + headerLength + maskLength
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length))
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
    }
    frames.push({ opcode, payload })
    offset += frameLength
  }
  return { frames, rest: buffer.subarray(offset) }
}

function newLease(state = 'active') {
  const now = new Date().toISOString()
  return {
    id: LEASE_ID,
    workItemId: WORK_ITEM_ID,
    runnerId: RUNNER_ID,
    state,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    renewedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function createWorkItem(runtime, gitConfig) {
  const prompt = [
    'Run the AMA end-to-end smoke check.',
    `1. Confirm these workspace files do not exist: .ama/resources.json, .ama/agent.json, .ama/system-prompt.md.`,
    `2. Confirm .ama/memory-stores/${MEMORY_STORE_ID}/heartbeat.md exists.`,
    `3. Write exactly "${RESULT_MARKER}\\n" to ama-smoke-result.txt in the workspace root.`,
    `4. Replace .ama/memory-stores/${MEMORY_STORE_ID}/heartbeat.md with exactly "${MEMORY_UPDATED_MARKER}\\n".`,
    ...(gitConfig
      ? [`5. Confirm ${gitConfig.relativePath} exists.`]
      : []),
    `${gitConfig ? '6' : '5'}. Reply with exactly "${SMOKE_DONE_MARKER}".`,
    'Do not perform any unrelated work.',
  ].join('\n')

  const runtimeConfig = {
    ...runtime.runtimeConfig,
    ...(runtime.name === 'codex' ? { codexIdleKeepAliveMs: 5000 } : {}),
  }
  const workspaceMounts = [
    ...(gitConfig
      ? [
          {
            name: 'repo',
            type: 'git_repository',
            mountPath: gitConfig.mountPath,
            url: gitConfig.url,
            ref: gitConfig.ref,
            ...(gitConfig.token
              ? {
                  credential: {
                    username: 'x-access-token',
                    password: gitConfig.token,
                  },
                }
              : {}),
          },
        ]
      : []),
    {
      name: 'memory',
      type: 'memory',
      mountPath: `/workspace/.ama/memory-stores/${MEMORY_STORE_ID}`,
      memoryRef: `ama://memories/${MEMORY_STORE_ID}`,
      description: 'AMA smoke memory',
      access: 'read_write',
      files: [{ path: 'heartbeat.md', content: 'AMA_SMOKE_MEMORY_INITIAL\n' }],
    },
  ]

  return {
    id: WORK_ITEM_ID,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    environmentId: 'env_smoke',
    type: 'session.start',
    state: 'available',
    priority: 0,
    attempts: 0,
    maxAttempts: 1,
    payload: {
      protocol: 'ama-runner-work',
      type: 'session.start',
      sessionId: SESSION_ID,
      hostingMode: 'self_hosted',
      runtime: runtime.name,
      runtimeConfig,
      provider: runtime.provider,
      model: runtime.model,
      runtimeDriver: `${runtime.name}-self-hosted`,
      requiredRunnerCapability: runtime.name,
      env: {},
      workspaceManifest: {
        root: '/workspace',
        mounts: workspaceMounts,
      },
      agentSnapshot: {
        systemPrompt: [
          'These developer instructions are part of the AMA smoke test.',
          `Create system-prompt-proof.txt in the workspace root containing exactly "${SYSTEM_PROMPT_MARKER}\\n".`,
          'Then follow the user prompt.',
        ].join('\n'),
        skills: [],
        capabilityTags: ['smoke'],
        subagents: [],
      },
      prompt,
    },
  }
}

function createControlPlane(runtime, gitConfig) {
  const state = {
    runnerCreates: [],
    heartbeats: [],
    leaseCreates: [],
    leaseUpdates: [],
    channelMessages: [],
    channelSockets: [],
    backfillResponses: [],
    channelAccepted: false,
    followUpSent: false,
    requestedPaths: [],
    unauthorized: [],
    leased: false,
    completed: false,
    assignmentsSent: 0,
    workItem: createWorkItem(runtime, gitConfig),
  }

  function assignedWorkItem() {
    return { ...state.workItem, state: 'leased', runnerId: RUNNER_ID, leaseId: LEASE_ID }
  }

  function sendAssignment(socket) {
    if (state.leased || state.completed) return
    state.leased = true
    state.assignmentsSent += 1
    sendWebSocket(socket, {
      type: 'work.assigned',
      runnerId: RUNNER_ID,
      lease: newLease(),
      workItem: assignedWorkItem(),
    })
  }

  const server = createServer(async (request, response) => {
    try {
      state.requestedPaths.push(`${request.method} ${request.url}`)
      if (!request.url?.endsWith('/channel') && request.headers.authorization !== `Bearer ${TOKEN}`) {
        state.unauthorized.push(`${request.method} ${request.url}`)
      }
      if (request.method === 'GET' && request.url === '/api/v1/configz') {
        return json(response, 200, {
          version: 1,
          service: { name: 'Any Managed Agents', origin: 'https://ama.example.test' },
          auth: {
            oidc: {
              issuer: 'https://issuer.example.test',
              resource: 'https://ama.example.test',
              browser: { clientId: 'browser-client', scopes: ['openid', 'email', 'profile'] },
              runner: { clientId: 'runner-client', scopes: ['openid', 'profile', 'email', 'offline_access'] },
            },
          },
        })
      }
      if (request.method === 'POST' && request.url === '/api/v1/runners') {
        state.runnerCreates.push(await collectBody(request))
        return json(response, 201, {
          id: RUNNER_ID,
          name: 'smoke-runner',
          capabilities: ['ama-sandbox'],
          state: 'offline',
          currentLoad: 0,
          maxConcurrent: 1,
        })
      }
      if (request.method === 'PUT' && request.url === `/api/v1/runners/${RUNNER_ID}/heartbeat`) {
        state.heartbeats.push(await collectBody(request))
        return json(response, 200, {
          runnerId: RUNNER_ID,
          state: 'active',
          currentLoad: 0,
          runtimeUsage: [],
          runtimeInventory: [],
          lastHeartbeatAt: new Date().toISOString(),
        })
      }
      if (request.method === 'GET' && request.url === '/api/v1/work-items?state=available') {
        return json(response, 200, { data: state.leased || state.completed ? [] : [state.workItem] })
      }
      if (request.method === 'POST' && request.url === '/api/v1/leases') {
        const body = await collectBody(request)
        state.leaseCreates.push(body)
        if (body.workItemId !== WORK_ITEM_ID || body.runnerId !== RUNNER_ID) {
          return json(response, 409, { error: { code: 'claim_failed', message: 'unexpected lease body' } })
        }
        state.leased = true
        return json(response, 201, newLease())
      }
      if (request.method === 'GET' && request.url === `/api/v1/work-items/${WORK_ITEM_ID}`) {
        return json(response, 200, state.workItem)
      }
      if (request.method === 'PATCH' && request.url === `/api/v1/leases/${LEASE_ID}`) {
        const body = await collectBody(request)
        state.leaseUpdates.push(body)
        if (body.state === 'completed' || body.state === 'failed' || body.state === 'interrupted') {
          state.completed = true
        }
        return json(response, 200, newLease(body.state || 'active'))
      }
      if (request.method === 'POST' && request.url === `/api/v1/sessions/${SESSION_ID}/events`) {
        return json(response, 204, {})
      }
      if (request.method === 'GET' && request.url === `/api/v1/runners/${RUNNER_ID}/channel`) {
        response.writeHead(426, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'upgrade_required', message: 'websocket upgrade required' } }))
        return
      }
      json(response, 404, { error: { code: 'not_found', message: `unexpected ${request.method} ${request.url}` } })
    } catch (error) {
      json(response, 500, { error: { code: 'smoke_server_error', message: String(error?.message ?? error) } })
    }
  })

  server.on('upgrade', (request, socket) => {
    if (request.url !== `/api/v1/runners/${RUNNER_ID}/channel`) {
      socket.destroy()
      return
    }
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    state.channelAccepted = true
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
        '\r\n',
      ].join('\r\n'),
    )
    sendWebSocket(socket, { type: 'runner.channel.accepted' })
    sendAssignment(socket)
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const parsed = parseWebSocketFrames(buffered)
      buffered = parsed.rest
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x8) {
          socket.end()
          continue
        }
        if (frame.opcode === 0x9) {
          sendWebSocket(socket, frame.payload, 0x0a)
          continue
        }
        if (frame.opcode !== 0x1) continue
        const text = frame.payload.toString('utf8')
        try {
          const message = JSON.parse(text)
          state.channelMessages.push(message)
          if (message.type === 'session.backfill_response') {
            state.backfillResponses.push(message)
          }
          const runnerEventId = message.record?.id ?? message.eventId
          if (message.type === 'runner.event' && runnerEventId) {
            sendWebSocket(socket, { type: 'runner.event.accepted', eventId: runnerEventId })
          }
          const runnerEvent = message.record
          if (
            runtime.name === 'codex' &&
            message.type === 'runner.event' &&
            runnerEvent?.payload?.message?.role === 'assistant' &&
            !state.followUpSent &&
            JSON.stringify(message).includes(SMOKE_DONE_MARKER)
          ) {
            state.followUpSent = true
            sendWebSocket(socket, {
              type: 'session.command',
              sessionId: SESSION_ID,
              command: {
                type: 'send',
                message: [
                  'Continue the same Codex thread for the AMA smoke follow-up.',
                  `Write exactly "${FOLLOW_UP_MARKER}\\n" to ama-smoke-followup.txt in the workspace root.`,
                  `Reply with exactly "${FOLLOW_UP_MARKER}".`,
                  'Do not perform any unrelated work.',
                ].join('\n'),
              },
            })
          }
        } catch {
          state.channelMessages.push({ type: 'unparseable', text })
        }
      }
    })
    state.channelSockets.push(socket)
  })

  return { server, state }
}

function createResumeControlPlane(runtime) {
  const sessionId = 'session_smoke_resume'
  const firstWorkItemId = 'work_smoke_resume_1'
  const secondWorkItemId = 'work_smoke_resume_2'
  const firstLeaseId = 'lease_smoke_resume_1'
  const secondLeaseId = 'lease_smoke_resume_2'
  const state = {
    runnerCreates: [],
    heartbeats: [],
    leaseCreates: [],
    leaseUpdates: [],
    channelMessages: [],
    channelSockets: [],
    requestedPaths: [],
    unauthorized: [],
    phase: 'first',
    firstLeased: false,
    secondLeased: false,
    interrupted: false,
    completed: false,
    resumeToken: '',
    assignmentsSent: 0,
  }
  const workItem = (id, resume = false) => ({
    id,
    projectId: PROJECT_ID,
    sessionId,
    environmentId: 'env_smoke',
    type: 'session.start',
    state: 'available',
    priority: 0,
    attempts: 0,
    maxAttempts: 1,
    payload: {
      protocol: 'ama-runner-work',
      type: 'session.start',
      sessionId,
      hostingMode: 'self_hosted',
      runtime: runtime.name,
      runtimeConfig: { ...runtime.runtimeConfig },
      provider: runtime.provider,
      model: runtime.model,
      runtimeDriver: `${runtime.name}-self-hosted`,
      requiredRunnerCapability: runtime.name,
      env: {},
      volumes: [],
      volumeMounts: [],
      agentSnapshot: { systemPrompt: 'AMA resume smoke. Follow the user prompt exactly.' },
      prompt: resume
        ? [
            'Continue the AMA resume smoke.',
            `Write exactly "${RESUMED_MARKER}\\n" to ama-smoke-resumed.txt in the workspace root.`,
            `Reply with exactly "${RESUMED_MARKER}".`,
          ].join('\n')
        : [
            'Start the AMA interrupted/resume smoke.',
            `Write exactly "${RESUME_STARTED_MARKER}\\n" to ama-smoke-resume-started.txt in the workspace root.`,
            'Then run this exact shell command and wait for it: sleep 120',
            'Do not reply before the sleep command completes.',
          ].join('\n'),
      resume,
      resumeToken: resume ? state.resumeToken : '',
    },
  })
  const lease = (id, workItemId, runnerId = RUNNER_ID, stateName = 'active') => {
    const now = new Date().toISOString()
    return {
      id,
      workItemId,
      runnerId,
      state: stateName,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      renewedAt: now,
      createdAt: now,
      updatedAt: now,
      ...(state.resumeToken ? { resumeToken: state.resumeToken } : {}),
    }
  }

  function assignmentForCurrentPhase() {
    if (state.phase === 'first' && !state.firstLeased) {
      state.firstLeased = true
      state.assignmentsSent += 1
      return {
        type: 'work.assigned',
        runnerId: RUNNER_ID,
        lease: lease(firstLeaseId, firstWorkItemId),
        workItem: { ...workItem(firstWorkItemId), state: 'leased', runnerId: RUNNER_ID, leaseId: firstLeaseId },
      }
    }
    if (state.phase === 'second' && !state.secondLeased) {
      state.secondLeased = true
      state.assignmentsSent += 1
      return {
        type: 'work.assigned',
        runnerId: RUNNER_ID,
        lease: lease(secondLeaseId, secondWorkItemId),
        workItem: { ...workItem(secondWorkItemId, true), state: 'leased', runnerId: RUNNER_ID, leaseId: secondLeaseId },
      }
    }
    return null
  }

  const server = createServer(async (request, response) => {
    try {
      state.requestedPaths.push(`${request.method} ${request.url}`)
      if (!request.url?.endsWith('/channel') && request.headers.authorization !== `Bearer ${TOKEN}`) {
        state.unauthorized.push(`${request.method} ${request.url}`)
      }
      if (request.method === 'GET' && request.url === '/api/v1/configz') {
        return json(response, 200, {
          version: 1,
          service: { name: 'Any Managed Agents', origin: 'https://ama.example.test' },
          auth: { oidc: null },
        })
      }
      if (request.method === 'POST' && request.url === '/api/v1/runners') {
        state.runnerCreates.push(await collectBody(request))
        return json(response, 201, { id: RUNNER_ID, name: 'resume-smoke-runner', capabilities: [], state: 'offline', currentLoad: 0, maxConcurrent: 1 })
      }
      if (request.method === 'PUT' && request.url === `/api/v1/runners/${RUNNER_ID}/heartbeat`) {
        state.heartbeats.push(await collectBody(request))
        return json(response, 200, { runnerId: RUNNER_ID, state: 'active', currentLoad: 0, runtimeUsage: [], runtimeInventory: [] })
      }
      if (request.method === 'GET' && request.url === '/api/v1/work-items?state=available') {
        if (state.phase === 'first' && !state.firstLeased) return json(response, 200, { data: [workItem(firstWorkItemId)] })
        if (state.phase === 'second' && !state.secondLeased) return json(response, 200, { data: [workItem(secondWorkItemId, true)] })
        return json(response, 200, { data: [] })
      }
      if (request.method === 'POST' && request.url === '/api/v1/leases') {
        const body = await collectBody(request)
        state.leaseCreates.push(body)
        if (body.workItemId === firstWorkItemId) {
          state.firstLeased = true
          return json(response, 201, lease(firstLeaseId, firstWorkItemId))
        }
        if (body.workItemId === secondWorkItemId) {
          state.secondLeased = true
          return json(response, 201, lease(secondLeaseId, secondWorkItemId))
        }
        return json(response, 409, { error: { code: 'claim_failed', message: 'unexpected work item' } })
      }
      if (request.method === 'GET' && request.url === `/api/v1/work-items/${firstWorkItemId}`) {
        return json(response, 200, workItem(firstWorkItemId))
      }
      if (request.method === 'GET' && request.url === `/api/v1/work-items/${secondWorkItemId}`) {
        return json(response, 200, workItem(secondWorkItemId, true))
      }
      if (request.method === 'PATCH' && request.url === `/api/v1/leases/${firstLeaseId}`) {
        const body = await collectBody(request)
        state.leaseUpdates.push({ leaseId: firstLeaseId, ...body })
        if (body.resumeToken) state.resumeToken = body.resumeToken
        if (body.state === 'interrupted') {
          state.interrupted = true
          state.phase = 'second'
        }
        return json(response, 200, lease(firstLeaseId, firstWorkItemId, RUNNER_ID, body.state || 'active'))
      }
      if (request.method === 'PATCH' && request.url === `/api/v1/leases/${secondLeaseId}`) {
        const body = await collectBody(request)
        state.leaseUpdates.push({ leaseId: secondLeaseId, ...body })
        if (body.state === 'completed') state.completed = true
        return json(response, 200, lease(secondLeaseId, secondWorkItemId, RUNNER_ID, body.state || 'active'))
      }
      json(response, 404, { error: { code: 'not_found', message: `unexpected ${request.method} ${request.url}` } })
    } catch (error) {
      json(response, 500, { error: { code: 'smoke_server_error', message: String(error?.message ?? error) } })
    }
  })

  server.on('upgrade', (request, socket) => {
    if (request.url !== `/api/v1/runners/${RUNNER_ID}/channel`) return socket.destroy()
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') return socket.destroy()
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${websocketAccept(key)}`, '\r\n'].join('\r\n'))
    sendWebSocket(socket, { type: 'runner.channel.accepted' })
    const assignment = assignmentForCurrentPhase()
    if (assignment) sendWebSocket(socket, assignment)
    state.channelSockets.push(socket)
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const parsed = parseWebSocketFrames(buffered)
      buffered = parsed.rest
      for (const frame of parsed.frames) {
        if (frame.opcode !== 0x1) continue
        try {
          const message = JSON.parse(frame.payload.toString('utf8'))
          state.channelMessages.push(message)
          const runnerEventId = message.record?.id ?? message.eventId
          if (message.type === 'runner.event' && runnerEventId) {
            sendWebSocket(socket, { type: 'runner.event.accepted', eventId: runnerEventId })
          }
        } catch {
          // ignored
        }
      }
    })
  })
  return { server, state, sessionId }
}

function sendBackfillRequest(controlPlaneState) {
  const socket = controlPlaneState.channelSockets.find((candidate) => !candidate.destroyed)
  if (!socket) fail('no active runner channel socket for backfill request')
  sendWebSocket(socket, {
    type: 'session.backfill_request',
    eventId: 'backfill_smoke',
    sessionId: SESSION_ID,
  })
}

function waitFor(predicate, label) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`timed out waiting for ${label}`))
      }
    }, 250)
  })
}

function readJSONL(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function findWorkspace(workDir) {
  const sessionDir = join(workDir, 'sessions', SESSION_ID)
  const workspace = join(sessionDir, 'workspace')
  statSync(workspace)
  return { sessionDir, workspace }
}

function assertSmokeState(workDir, controlPlaneState, runtime, gitConfig) {
  const { sessionDir, workspace } = findWorkspace(workDir)
  const eventLog = join(sessionDir, 'events.jsonl')
  const events = readJSONL(eventLog)
  const eventTypes = events.map((record) => record.type)
  for (const required of ['runtime.started', 'message.completed']) {
    if (!eventTypes.includes(required)) fail(`event log is missing ${required}`, `events: ${eventTypes.join(', ')}`)
  }
  const serializedEvents = JSON.stringify(events)
  if (!serializedEvents.includes(SMOKE_DONE_MARKER)) fail(`runtime response did not include ${SMOKE_DONE_MARKER}`, eventLog)
  if (runtime.name === 'codex' && !serializedEvents.includes(FOLLOW_UP_MARKER)) {
    fail(`Codex multi-turn response did not include ${FOLLOW_UP_MARKER}`, eventLog)
  }
  if (!controlPlaneState.channelAccepted) fail('runner relay channel was not accepted')
  const liveEventTypes = controlPlaneState.channelMessages
    .filter((message) => message.type === 'runner.event')
    .map((message) => message.record?.type)
    .filter(Boolean)
  for (const required of ['runtime.started', 'message.completed']) {
    if (!liveEventTypes.includes(required)) fail(`live relay is missing ${required}`, liveEventTypes.join(', '))
  }

  const completed = controlPlaneState.leaseUpdates.find((update) => update.state === 'completed')
  if (!completed) fail('lease never completed', JSON.stringify(controlPlaneState.leaseUpdates, null, 2))
  const memoryStores = completed.result?.memoryStores
  const heartbeat = Array.isArray(memoryStores)
    ? memoryStores
        .find((store) => store.memoryRef === `ama://memories/${MEMORY_STORE_ID}`)
        ?.memories?.find((memory) => memory.path === 'heartbeat.md')
    : undefined
  if (heartbeat?.content !== `${MEMORY_UPDATED_MARKER}\n`) {
    fail('memory store writeback did not include updated heartbeat', JSON.stringify(completed.result, null, 2))
  }

  for (const relative of ['.ama/resources.json', '.ama/agent.json', '.ama/system-prompt.md']) {
    try {
      statSync(join(workspace, relative))
      fail(`workspace contains deprecated file ${relative}`, workspace)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (readFileSync(join(workspace, 'ama-smoke-result.txt'), 'utf8') !== `${RESULT_MARKER}\n`) {
    fail('workspace result marker was not written', workspace)
  }
  if (runtime.name === 'codex' && readFileSync(join(workspace, 'ama-smoke-followup.txt'), 'utf8') !== `${FOLLOW_UP_MARKER}\n`) {
    fail('Codex follow-up marker was not written', workspace)
  }
  if (readFileSync(join(workspace, 'system-prompt-proof.txt'), 'utf8') !== `${SYSTEM_PROMPT_MARKER}\n`) {
    fail('agent developer instructions did not reach the runtime', workspace)
  }
  if (gitConfig) {
    const repoPath = join(workspace, ...gitConfig.relativePath.split('/'))
    if (!existsSync(repoPath)) fail('Git repository resource was not mounted', repoPath)
    if (gitConfig.token) {
      if (!existsSync(join(sessionDir, 'git-credentials'))) fail('session-scoped git credentials file was not created', sessionDir)
      if (existsSync(join(workspace, 'git-credentials'))) fail('git credentials leaked into workspace root', workspace)
      const credentials = readFileSync(join(sessionDir, 'git-credentials'), 'utf8')
      if (!credentials.includes(gitConfig.token)) fail('session git credential store does not contain the smoke token')
      const helpers = run('git', ['-C', repoPath, 'config', '--worktree', '--get-all', 'credential.helper']).stdout
      if (!helpers.includes(join(sessionDir, 'git-credentials'))) {
        fail('repository worktree does not use session-scoped credential helper', helpers)
      }
      if (serializedEvents.includes(gitConfig.token)) fail('Git token leaked into session event log')
    } else if (existsSync(join(sessionDir, 'git-credentials'))) {
      fail('session-scoped git credentials file was created without a smoke token', sessionDir)
    }
  }
  if (controlPlaneState.unauthorized.length > 0) {
    fail('runner made unauthenticated control-plane requests', controlPlaneState.unauthorized.join('\n'))
  }
  if (controlPlaneState.runnerCreates.length !== 1) fail('runner was not registered exactly once')
  if (controlPlaneState.heartbeats.length === 0) fail('runner heartbeat was not sent')
  if (controlPlaneState.leaseCreates.length !== 0) fail('runner should not poll and claim leases anymore')
  if (controlPlaneState.assignmentsSent !== 1) fail('control plane did not push exactly one work assignment')

  return { sessionDir, workspace, eventLog, eventCount: events.length, events }
}

function startRunner(runnerPath, origin, stateDir, workDir) {
  const runnerEnv = { ...process.env }
  delete runnerEnv.AMA_RUNTIME_BRIDGE_TEST_MODE
  runnerEnv.AMA_TOKEN = TOKEN
  runnerEnv.AMA_API_SERVER = origin
  runnerEnv.AMA_PROJECT_ID = PROJECT_ID
  runnerEnv.AMA_RUNNER_ALLOW_UNSAFE_PROCESS = 'true'
  runnerEnv.AMA_RUNNER_HEARTBEAT_INTERVAL = '2s'
  runnerEnv.AMA_RUNNER_LEASE_SECONDS = '30'
  runnerEnv.AMA_RUNNER_RENEW_INTERVAL = '2s'
  runnerEnv.AMA_RUNNER_COMMAND_TIMEOUT = '3m'
  runnerEnv.AMA_RUNNER_SHUTDOWN_GRACE = '1s'
  runnerEnv.AMA_RUNNER_MAX_SESSION_DURATION = '3m'

  return spawn(
    runnerPath,
    [
      '--api-server',
      origin,
      '--project-id',
      PROJECT_ID,
      '--state-dir',
      stateDir,
      '--work-dir',
      workDir,
      '--allow-unsafe-process',
      '--max-concurrent',
      '1',
    ],
    {
      cwd: ROOT,
      env: runnerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

async function stopRunner(runner) {
  if (!runner || runner.exitCode !== null) return
  const exit = new Promise((resolve) => runner.once('exit', (code, signal) => resolve({ code, signal })))
  runner.kill('SIGTERM')
  await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 5000))])
}

function pipeRunnerLogs(runner) {
  let stdout = ''
  let stderr = ''
  runner.stdout.on('data', (chunk) => {
    stdout += chunk
    process.stdout.write(chunk)
  })
  runner.stderr.on('data', (chunk) => {
    stderr += chunk
    process.stderr.write(chunk)
  })
  return { stdout: () => stdout, stderr: () => stderr }
}

async function runResumeSmoke(runtime, runnerPath, root) {
  if (runtime.name !== 'codex') {
    info('resume smoke skipped; currently implemented for Codex resume tokens')
    return
  }
  const workDir = join(root, 'resume-work')
  const stateDir = join(root, 'resume-state')
  const { server, state, sessionId } = createResumeControlPlane(runtime)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://${address.address}:${address.port}`
  info(`resume smoke control plane: ${origin}`)

  let runner = startRunner(runnerPath, origin, stateDir, workDir)
  let logs = pipeRunnerLogs(runner)
  try {
    await waitFor(
      () =>
        state.leaseUpdates.some((update) => update.leaseId === 'lease_smoke_resume_1' && update.state === 'active' && update.resumeToken),
      'resume token before interruption',
    )
    await stopRunner(runner)
    await waitFor(() => state.interrupted, 'interrupted lease after runner stop')
    if (!state.resumeToken) fail('interrupted lease did not include a resume token')

    runner = startRunner(runnerPath, origin, stateDir, workDir)
    logs = pipeRunnerLogs(runner)
    await waitFor(() => state.completed, 'resumed lease completion')
    const workspace = join(workDir, 'sessions', sessionId, 'workspace')
    if (readFileSync(join(workspace, 'ama-smoke-resumed.txt'), 'utf8') !== `${RESUMED_MARKER}\n`) {
      fail('resumed Codex session did not write the resumed marker', workspace)
    }
    info('resume smoke passed')
  } catch (error) {
    console.error('\nresume runner stdout:\n' + logs.stdout())
    console.error('\nresume runner stderr:\n' + logs.stderr())
    console.error('\nresume control-plane requests:\n' + state.requestedPaths.join('\n'))
    console.error('\nresume lease updates:\n' + JSON.stringify(state.leaseUpdates, null, 2))
    fail(error.message)
  } finally {
    await stopRunner(runner)
    server.close()
  }
}

async function main() {
  const runtime = selectRuntime()
  const gitConfig = gitSmokeConfig()
  info(`selected runtime: ${runtime.name} (${runtime.binary})`)
  info(`Git repository smoke enabled: ${gitConfig.url}${gitConfig.ref ? `#${gitConfig.ref}` : ''}`)

  run('pnpm', ['run', 'bridge:build'])
  const root = mkdtempSync(join(tmpdir(), 'ama-smoke-'))
  const workDir = join(root, 'work')
  const stateDir = join(root, 'state')
  const runnerPath = join(root, 'ama-runner')
  run('go', ['build', '-o', runnerPath, '.'], { cwd: join(ROOT, 'cmd', 'ama-runner') })

  const { server, state } = createControlPlane(runtime, gitConfig)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://${address.address}:${address.port}`
  info(`local control plane: ${origin}`)
  info(`work dir: ${workDir}`)

  const runner = startRunner(runnerPath, origin, stateDir, workDir)
  const logs = pipeRunnerLogs(runner)
  try {
    await waitFor(() => state.completed, 'completed lease')
    sendBackfillRequest(state)
    await waitFor(() => state.backfillResponses.length > 0, 'session backfill response')
    const result = assertSmokeState(workDir, state, runtime, gitConfig)
    const backfill = state.backfillResponses[0]
    if (!Array.isArray(backfill.events) || backfill.events.length !== result.events.length) {
      fail('backfill response did not return the full event log', JSON.stringify(backfill, null, 2))
    }
    info(`completed lease updates: ${state.leaseUpdates.length}`)
    info(`event log: ${result.eventLog} (${result.eventCount} events)`)
    info(`workspace: ${result.workspace}`)
  } catch (error) {
    console.error('\nrunner stdout:\n' + logs.stdout())
    console.error('\nrunner stderr:\n' + logs.stderr())
    console.error('\ncontrol-plane requests:\n' + state.requestedPaths.join('\n'))
    console.error('\nlease updates:\n' + JSON.stringify(state.leaseUpdates, null, 2))
    fail(error.message)
  } finally {
    await stopRunner(runner)
    server.close()
  }

  await runResumeSmoke(runtime, runnerPath, root)
  info('AMA smoke passed')
}

main().catch((error) => fail(error.message, error.stack))
