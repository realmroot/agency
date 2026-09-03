// Integration tests for the RunnerPool relay end-to-end path.
//
// The runner opens GET /api/v1/runners/{runnerId}/channel (101 WebSocket),
// which the HTTP layer routes to the RunnerPool DO keyed by environmentId.
// RunnerPool accepts runner.event frames and writes them into the per-session
// Session DO. Browser sockets always connect to the per-session Session DO.
//
// Tests:
// 1. Fan-out multiplexing: runner.event sent by the runner channel fans out to
//    the browser socket watching that session.
// 2. Reconnect guard: a second runner channel open (reconnect) supersedes the
//    first. The first socket's close handler must NOT tear down the newly
//    installed socket (the DO guards teardown by socket identity). Proved by
//    sending on the second socket and confirming the browser receives the event.
// 3. Assignment push: creating a self-hosted session while a runner is connected
//    pushes work.assigned over the RunnerPool WebSocket without runner polling.
// 4. Live prompt: POST /sessions/{id}/messages for a running self-hosted session
//    sends a session.command to that runner and keeps live browser events on the
//    same session socket.

import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { asRunnerAuthorization, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

const CLAUDE_CODE_RUNTIME = 'claude-code'
const CLAUDE_CODE_MODEL = 'claude-opus-4-5'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, init.method ?? 'GET', path),
      ...init.headers,
    },
  })
}

async function createSelfHostedEnvironment(authorization: string) {
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      metadata: { name: `CLI relay workspace ${crypto.randomUUID()}` },
      spec: {
        type: 'self_hosted',
        networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
        packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] },
      },
    }),
  })
  if (res.status !== 201) throw new Error(`Environment creation failed: ${res.status} ${await res.text()}`)
  const environment = (await res.json()) as { metadata: { uid: string } }
  return { id: environment.metadata.uid }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      metadata: { name: `CLI relay agent ${crypto.randomUUID()}` },
      spec: {
        systemPrompt: 'Run via claude-code self-hosted.',
        skills: [],
        mcpConnectors: [],
        provider: 'workers-ai',
      },
    }),
  })
  if (res.status !== 201) throw new Error(`Agent creation failed: ${res.status} ${await res.text()}`)
  const agent = (await res.json()) as { metadata: { uid: string } }
  return { id: agent.metadata.uid }
}

async function createCliRelaySession(authorization: string, agentId: string, environmentId: string) {
  const res = await jsonFetch('/api/v1/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({
      spec: { agentId, environmentId, runtime: 'claude-code' },
      prompt: 'Run relay test',
    }),
  })
  if (res.status !== 201) throw new Error(`Session creation failed: ${res.status} ${await res.text()}`)
  const session = (await res.json()) as { metadata: { uid: string }; status: { phase: string } }
  return { ...session, id: session.metadata.uid, state: session.status.phase }
}

async function registerRunner(authorization: string, environmentId: string) {
  const res = await jsonFetch('/api/v1/runners', asRunnerAuthorization(authorization), {
    method: 'POST',
    body: JSON.stringify({
      name: `Relay test runner ${crypto.randomUUID()}`,
      environmentId,
      metadata: { commandAcknowledgement: true },
    }),
  })
  if (res.status !== 201) throw new Error(`Runner registration failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string }
}

async function heartbeatRunner(authorization: string, runnerId: string) {
  const res = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, asRunnerAuthorization(authorization), {
    method: 'PUT',
    body: JSON.stringify({
      state: 'active',
      runtimes: [{ runtime: CLAUDE_CODE_RUNTIME, models: [CLAUDE_CODE_MODEL], state: 'ready' }],
    }),
  })
  if (res.status !== 200) throw new Error(`Heartbeat failed: ${res.status} ${await res.text()}`)
}

// Claim the work item for this session so the session represents a self-hosted
// runner execution.
async function claimSessionLease(authorization: string, sessionId: string, runnerId: string) {
  const workRes = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${sessionId}`, authorization)
  if (workRes.status !== 200) throw new Error(`Work list failed: ${workRes.status}`)
  const work = (await workRes.json()) as { data: Array<{ id: string }> }
  if (work.data.length === 0) throw new Error('No available work items for session')
  const leaseRes = await jsonFetch('/api/v1/leases', asRunnerAuthorization(authorization), {
    method: 'POST',
    body: JSON.stringify({ workItemId: work.data[0].id, runnerId }),
  })
  if (leaseRes.status !== 201) throw new Error(`Lease claim failed: ${leaseRes.status} ${await leaseRes.text()}`)
  return (await leaseRes.json()) as { id: string; workItemId: string; runnerId: string }
}

async function completeLease(authorization: string, leaseId: string) {
  const res = await jsonFetch(`/api/v1/leases/${leaseId}`, asRunnerAuthorization(authorization), {
    method: 'PATCH',
    body: JSON.stringify({ state: 'completed', result: { smoke: true } }),
  })
  if (res.status !== 200) throw new Error(`Lease completion failed: ${res.status} ${await res.text()}`)
}

function runnerMessageFrame(
  sessionId: string,
  eventId: string,
  sequence: number,
  role: 'assistant' | 'user',
  text: string,
) {
  return JSON.stringify({
    type: 'runner.event',
    sessionId,
    record: {
      id: eventId,
      sessionId,
      sequence,
      createdAt: '2026-06-20T00:00:00.000Z',
      type: 'message.completed',
      payload: {
        message: {
          id: `msg_${eventId}`,
          role,
          content: [{ type: 'text', text }],
        },
      },
    },
  })
}

function frameIncludes(frame: Record<string, unknown>, text: string) {
  return JSON.stringify(frame).includes(text)
}

// Open the runner relay channel. Returns the accepted WebSocket and a
// waitForFrame helper, mirroring the sessions.test.ts socket helper pattern.
async function openRunnerChannel(authorization: string, runnerId: string) {
  const path = `/api/v1/runners/${runnerId}/channel`
  const runnerAuthorization = asRunnerAuthorization(authorization)
  const res = await SELF.fetch(`https://example.com${path}`, {
    headers: { ...dpopHeaders(runnerAuthorization, 'GET', path), upgrade: 'websocket' },
  })
  if (res.status !== 101 || !res.webSocket) throw new Error(`Runner channel upgrade failed: ${res.status}`)
  const ws = res.webSocket as WebSocket
  const frames: Array<Record<string, unknown>> = []
  let onFrame: (() => void) | null = null
  ws.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
    frames.push(JSON.parse(data) as Record<string, unknown>)
    onFrame?.()
  })
  ws.accept()

  async function waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, label = 'frame') {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = frames.find(predicate)
      if (found) return found
      await new Promise<void>((resolve) => {
        onFrame = resolve
        setTimeout(resolve, 20)
      })
    }
    throw new Error(`Expected ${label} never arrived; got ${JSON.stringify(frames)}`)
  }

  return { ws, frames, waitForFrame }
}

async function runnerSessionActive(environmentId: string, sessionId: string) {
  const stub = env.RUNNER_POOL.get(env.RUNNER_POOL.idFromName(environmentId))
  const response = await stub.fetch('https://runner-pool.test/status', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
  return ((await response.json()) as { active: boolean }).active
}

async function waitForRunnerSessionActive(environmentId: string, sessionId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await runnerSessionActive(environmentId, sessionId)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Runner session route for ${sessionId} never became active`)
}

// Open the browser WebSocket for a session. Browser sockets route to the
// per-session Session DO; RunnerPool writes relayed runner events into it.
async function openBrowserSocket(authorization: string, sessionId: string) {
  const path = `/api/v1/sessions/${sessionId}/socket`
  const sessionResponse = await SELF.fetch('https://example.com/api/v1/e2e/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: authorization.replace(/^Bearer /, '') }),
  })
  if (sessionResponse.status !== 204) throw new Error(`Browser session creation failed: ${sessionResponse.status}`)
  const sessionCookie = sessionResponse.headers.get('set-cookie')?.split(';')[0]
  if (!sessionCookie) throw new Error('Browser session creation omitted its cookie')
  const ticketResponse = await SELF.fetch(`https://example.com/api/v1/sessions/${sessionId}/socket-tickets`, {
    method: 'POST',
    headers: { cookie: sessionCookie, Origin: 'https://example.com' },
  })
  if (ticketResponse.status !== 201) throw new Error(`Browser ticket issuance failed: ${ticketResponse.status}`)
  const { ticket } = (await ticketResponse.json()) as { ticket: string }
  const res = await SELF.fetch(`https://example.com${path}`, {
    headers: {
      Upgrade: 'websocket',
      Origin: 'https://example.com',
      'Sec-WebSocket-Protocol': `enbor-ticket, enbor-ticket.${ticket}`,
    },
  })
  if (res.status !== 101 || !res.webSocket) throw new Error(`Browser socket upgrade failed: ${res.status}`)
  const ws = res.webSocket as WebSocket
  const frames: Array<Record<string, unknown>> = []
  let onFrame: (() => void) | null = null
  ws.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
    frames.push(JSON.parse(data) as Record<string, unknown>)
    onFrame?.()
  })
  ws.accept()

  async function waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, label = 'frame') {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = frames.find(predicate)
      if (found) return found
      await new Promise<void>((resolve) => {
        onFrame = resolve
        setTimeout(resolve, 20)
      })
    }
    throw new Error(`Expected ${label} never arrived; got ${JSON.stringify(frames)}`)
  }

  return { ws, frames, waitForFrame }
}

describe('[CF] per-runner relay end-to-end', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  it('fans a runner.event to the browser socket watching that CLI relay session [spec: runners/relay-fan-out]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    // Create session + claim lease to represent a self-hosted runner execution.
    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    expect(session.state).toBe('pending')
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    // Open the runner channel — RunnerPool is keyed by environmentId.
    const runnerCh = await openRunnerChannel(authorization, runner.id)
    const accepted = await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')
    expect(accepted).toMatchObject({ type: 'runner.channel.accepted', runnerId: runner.id })

    // Open the browser socket for S1. Browser traffic lands on the per-session
    // Session DO; RunnerPool writes relayed events into that same store.
    const browser = await openBrowserSocket(authorization, session.id)

    // Runner sends a runner.event for session S1.
    runnerCh.ws.send(
      JSON.stringify({
        type: 'runner.event',
        sessionId: session.id,
        record: {
          id: 'event_aaa',
          sessionId: session.id,
          sequence: 1,
          createdAt: '2026-06-20T00:00:00.000Z',
          type: 'message.completed',
          payload: { message: { id: 'msg_live', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
        },
      }),
    )

    // Browser must receive a fanned {type:'event'} frame with the canonical event.
    const live = await browser.waitForFrame(
      (f) => f.type === 'event' && ((f.record as { type?: string } | undefined)?.type ?? '') === 'message.completed',
      'event:message.completed',
    )
    expect((live.record as { type: string }).type).toBe('message.completed')

    runnerCh.ws.close()
    browser.ws.close()
  })

  it('relays browser socket and REST backfill requests to the runner local event log [spec: sessions/events-query]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    await heartbeatRunner(authorization, runner.id)
    const lease = await claimSessionLease(authorization, session.id, runner.id)

    const runnerCh = await openRunnerChannel(authorization, runner.id)
    await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')

    runnerCh.ws.send(JSON.stringify({ type: 'work.completed', sessionId: session.id }))
    await completeLease(authorization, lease.id)
    runnerCh.ws.close()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const reconnectedRunnerCh = await openRunnerChannel(authorization, runner.id)
    await reconnectedRunnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')

    const browser = await openBrowserSocket(authorization, session.id)
    const request = await reconnectedRunnerCh.waitForFrame(
      (f) => f.type === 'session.backfill_request' && f.sessionId === session.id,
      'session.backfill_request',
    )
    expect(request).toMatchObject({ type: 'session.backfill_request', sessionId: session.id, runnerId: runner.id })

    reconnectedRunnerCh.ws.send(
      JSON.stringify({
        type: 'session.backfill_response',
        eventId: request.eventId,
        sessionId: session.id,
        events: [
          {
            id: 'event_history',
            sessionId: session.id,
            sequence: 1,
            createdAt: '2026-06-20T00:00:00.000Z',
            type: 'message.completed',
            payload: {
              message: {
                id: 'msg_history',
                role: 'assistant',
                content: [{ type: 'text', text: 'history from runner' }],
              },
            },
          },
        ],
      }),
    )

    const backfill = await browser.waitForFrame(
      (f) =>
        f.type === 'backfill' &&
        (f.events as Array<{ type?: string }>).some((record) => record.type === 'message.completed'),
      'browser backfill from runner',
    )
    expect((backfill.events as Array<{ id: string }>)[0].id).toBe('event_history')

    const restEventsPromise = jsonFetch(`/api/v1/sessions/${session.id}/events`, authorization)
    const restRequest = await reconnectedRunnerCh.waitForFrame(
      (f) => f.type === 'session.backfill_request' && f.sessionId === session.id && f.eventId !== request.eventId,
      'REST session.backfill_request',
    )
    reconnectedRunnerCh.ws.send(
      JSON.stringify({
        type: 'session.backfill_response',
        eventId: restRequest.eventId,
        sessionId: session.id,
        events: [
          {
            id: 'event_rest_history',
            sessionId: session.id,
            sequence: 2,
            createdAt: '2026-06-20T00:00:01.000Z',
            type: 'message.completed',
            payload: {
              message: {
                id: 'msg_rest_history',
                role: 'assistant',
                content: [{ type: 'text', text: 'REST history from runner' }],
              },
            },
          },
        ],
      }),
    )
    const restEventsResponse = await restEventsPromise
    expect(restEventsResponse.status).toBe(200)
    expect(await restEventsResponse.json()).toMatchObject({
      data: [{ id: 'event_rest_history', sessionId: session.id, sequence: 2 }],
      pagination: { hasMore: false },
    })

    reconnectedRunnerCh.ws.close()
    browser.ws.close()
  })

  it('pushes self-hosted session work to an online runner without polling', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)
    await heartbeatRunner(authorization, runner.id)

    const runnerCh = await openRunnerChannel(authorization, runner.id)
    await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')

    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    const assigned = await runnerCh.waitForFrame((f) => f.type === 'work.assigned', 'work.assigned')
    expect(assigned).toMatchObject({
      type: 'work.assigned',
      runnerId: runner.id,
      lease: { runnerId: runner.id, state: 'active' },
      workItem: {
        sessionId: session.id,
        environmentId: environment.id,
        type: 'session.start',
        state: 'leased',
      },
    })

    const workItem = assigned.workItem as { id: string }
    const workRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    expect(workRes.status).toBe(200)
    await expect(workRes.json()).resolves.toMatchObject({
      id: workItem.id,
      sessionId: session.id,
      runnerId: runner.id,
      state: 'leased',
    })

    runnerCh.ws.close()
  })

  it('delivers API prompts to a live self-hosted runner channel [spec: runners/live-prompt]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)
    await heartbeatRunner(authorization, runner.id)

    const runnerCh = await openRunnerChannel(authorization, runner.id)
    await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')

    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    const assigned = await runnerCh.waitForFrame(
      (f) => f.type === 'work.assigned' && (f.workItem as { sessionId?: string } | undefined)?.sessionId === session.id,
      'work.assigned for live prompt session',
    )
    expect(assigned).toMatchObject({
      type: 'work.assigned',
      runnerId: runner.id,
      workItem: { sessionId: session.id, state: 'leased' },
    })

    const browser = await openBrowserSocket(authorization, session.id)
    const followUp = 'Reviewer rejected this task; resume it live.'
    const requestId = `reject_resume_${crypto.randomUUID()}`
    const messageResponsePromise = jsonFetch(`/api/v1/sessions/${session.id}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', requestId, content: followUp }),
    })
    const commandFrame = await runnerCh.waitForFrame(
      (f) =>
        f.type === 'session.command' &&
        f.sessionId === session.id &&
        (f.command as { type?: string; message?: string } | undefined)?.type === 'send' &&
        (f.command as { type?: string; message?: string } | undefined)?.message === followUp,
      'session.command live prompt',
    )
    expect(commandFrame).toMatchObject({ type: 'session.command', sessionId: session.id, runnerId: runner.id })
    expect(commandFrame.requestId).toBe(requestId)
    runnerCh.ws.send(
      JSON.stringify({
        type: 'session.command.result',
        requestId: commandFrame.requestId,
        sessionId: session.id,
        runnerId: runner.id,
        accepted: true,
      }),
    )

    const messageRes = await messageResponsePromise
    expect(messageRes.status).toBe(201)
    await expect(messageRes.json()).resolves.toMatchObject({
      sessionId: session.id,
      type: 'prompt',
      content: followUp,
      delivery: 'live',
      state: 'delivered',
    })

    runnerCh.ws.send(runnerMessageFrame(session.id, 'event_live_prompt_user', 2, 'user', followUp))
    runnerCh.ws.send(
      runnerMessageFrame(session.id, 'event_live_prompt_assistant', 3, 'assistant', 'live prompt response'),
    )

    await browser.waitForFrame(
      (f) => f.type === 'event' && frameIncludes(f, followUp),
      'browser live user prompt event',
    )
    await browser.waitForFrame(
      (f) => f.type === 'event' && frameIncludes(f, 'live prompt response'),
      'browser live assistant response event',
    )

    const availableRes = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${session.id}`, authorization)
    expect(availableRes.status).toBe(200)
    const available = (await availableRes.json()) as { data: Array<{ sessionId: string; state: string }> }
    expect(available.data).toEqual([])

    runnerCh.ws.close()
    browser.ws.close()
  })

  it('does not clobber the active channel when the runner reconnects [spec: runners/relay-reconnect]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    // Create session + claim lease so this is a self-hosted runner session.
    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    // Open the FIRST runner channel.
    const first = await openRunnerChannel(authorization, runner.id)
    await first.waitForFrame((f) => f.type === 'runner.channel.accepted', 'first runner.channel.accepted')

    // Open a SECOND runner channel for the same runnerId (reconnect). RunnerPool
    // supersedes the first socket: it closes the first and installs the second.
    // The first socket's 'close' handler must NOT tear down the second socket
    // (the guard checks socket identity, not runnerId).
    const second = await openRunnerChannel(authorization, runner.id)
    const secondAccepted = await second.waitForFrame(
      (f) => f.type === 'runner.channel.accepted',
      'second runner.channel.accepted',
    )
    expect(secondAccepted).toMatchObject({ type: 'runner.channel.accepted', runnerId: runner.id })

    // Open a browser socket — it routes to the per-session Session DO.
    const browser = await openBrowserSocket(authorization, session.id)

    // Exact-connection ownership prevents the replacement socket from inheriting
    // the old socket's route. Events are rejected until the runner advertises its
    // active sessions and the persisted latest assignment validates ownership.
    expect(await runnerSessionActive(environment.id, session.id)).toBe(false)
    second.ws.send(runnerMessageFrame(session.id, 'event_before_advertisement', 1, 'assistant', 'must not relay'))
    second.ws.send(JSON.stringify({ type: 'runner.sessions.active', runnerId: runner.id, sessionIds: [session.id] }))
    await waitForRunnerSessionActive(environment.id, session.id)

    // If reconnect teardown clobbered the new runner connection, this event
    // would never reach the Session DO and browser socket.
    second.ws.send(runnerMessageFrame(session.id, 'event_bbb', 2, 'assistant', 'reconnect works'))

    const live = await browser.waitForFrame(
      (f) => f.type === 'event' && ((f.record as { type?: string } | undefined)?.type ?? '') === 'message.completed',
      'event:message.completed after reconnect',
    )
    expect((live.record as { type: string }).type).toBe('message.completed')
    expect(browser.frames.some((frame) => frameIncludes(frame, 'must not relay'))).toBe(false)

    second.ws.close()
    browser.ws.close()
  })
})
