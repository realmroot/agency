import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { RunnerPoolObject } from './runner-pool-object'

const { createDepsMock } = vi.hoisted(() => ({ createDepsMock: vi.fn() }))

vi.mock('../composition', () => ({ createDeps: createDepsMock }))

type TestSocket = {
  readyState: number
  sent: Array<Record<string, unknown>>
  closedWith: Array<{ code: number | undefined; reason: string | undefined }>
  onSend?: (frame: Record<string, unknown>) => void
  send: (value: string) => void
  close: (code?: number, reason?: string) => void
}

type TestConnection = {
  scope: {
    runnerId: string
    organizationId: string
    projectId: string
    environmentId: string
    commandAcknowledgement: boolean
  }
  socket: TestSocket
  assigned: number
  sessionsAdvertised: boolean
}

type RunnerPoolInternals = {
  runners: Map<string, TestConnection>
  sessionRunners: Map<string, TestConnection>
  sessionBackfillRunners: Map<string, TestConnection>
  pendingCommandRequests: Map<string, unknown>
  pendingSandboxRequests: Map<string, unknown>
  pendingBackfillRequests: Map<string, unknown>
  handleRunnerMessage: (connection: TestConnection, data: string) => Promise<void>
  closeRunner: (connection: TestConnection) => void
  restoreActiveSessions: (connection: TestConnection) => Promise<void>
}

function createSocket(): TestSocket {
  const socket: TestSocket = {
    readyState: 1,
    sent: [],
    closedWith: [],
    send(value) {
      const frame = JSON.parse(value) as Record<string, unknown>
      socket.sent.push(frame)
      socket.onSend?.(frame)
    },
    close(code, reason) {
      socket.closedWith.push({ code, reason })
      socket.readyState = 3
    },
  }
  return socket
}

function createPool(commandAcknowledgement: boolean, env: Partial<Env> = {}) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise.catch(() => undefined)
  })
  const pool = new RunnerPoolObject({ waitUntil } as unknown as DurableObjectState, env as Env)
  const internals = pool as unknown as RunnerPoolInternals
  const socket = createSocket()
  const connection: TestConnection = {
    scope: {
      runnerId: 'runner_1',
      organizationId: 'org_1',
      projectId: 'project_1',
      environmentId: 'env_1',
      commandAcknowledgement,
    },
    socket,
    assigned: 1,
    sessionsAdvertised: false,
  }
  internals.runners.set('runner_1', connection)
  internals.sessionRunners.set('session_1', connection)
  internals.sessionBackfillRunners.set('session_1', connection)
  return { pool, internals, connection, socket }
}

function dispatch(pool: RunnerPoolObject, requestId?: string, options: { sessionId?: string; message?: string } = {}) {
  return pool.fetch(
    new Request('https://runner-pool.test/dispatch', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: options.sessionId ?? 'session_1',
        command: { type: 'send', message: options.message ?? 'resume' },
        requestId,
      }),
    }),
  )
}

function retryAvailableWork(pool: RunnerPoolObject) {
  return pool.fetch(
    new Request('https://runner-pool.test/retry', {
      method: 'POST',
      body: JSON.stringify({
        runnerId: 'runner_1',
        organizationId: 'org_1',
        projectId: 'project_1',
        environmentId: 'env_1',
      }),
    }),
  )
}

function requestSandbox(pool: RunnerPoolObject, sessionId = 'session_1') {
  return pool.fetch(
    new Request('https://runner-pool.test/request', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        request: { type: 'sandbox.execute', toolCallId: 'call_1', toolName: 'bash', input: { command: 'printf ok' } },
      }),
    }),
  )
}

function sessionStatus(pool: RunnerPoolObject, sessionId: string) {
  return pool.fetch(
    new Request('https://runner-pool.test/status', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  )
}

function requestBackfill(pool: RunnerPoolObject, sessionId = 'session_1') {
  return pool.fetch(
    new Request('https://runner-pool.test/backfill', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org_1',
        projectId: 'project_1',
        sessionId,
        query: { limit: 50, cursor: null },
      }),
    }),
  )
}

function runnerEvent(sessionId: string, recordSessionId = sessionId) {
  return JSON.stringify({
    type: 'runner.event',
    sessionId,
    record: relayedEventRecord(recordSessionId),
  })
}

function relayedEventRecord(sessionId: string, sequence = 1) {
  return {
    id: `event_${sessionId}_${sequence}`,
    sessionId,
    sequence,
    createdAt: '2026-09-02T00:00:00.000Z',
    type: 'runtime.started',
    payload: {},
  }
}

function relayEnv() {
  const relay = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
  return {
    env: {
      SESSION: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: relay })),
      },
    } as unknown as Env,
    relay,
  }
}

function seedPendingRequests(internals: RunnerPoolInternals, connection: TestConnection) {
  const rejects = [vi.fn(), vi.fn(), vi.fn()]
  internals.pendingCommandRequests.set('command', {
    connection,
    reject: rejects[0],
    timer: setTimeout(() => undefined, 60_000),
  })
  internals.pendingSandboxRequests.set('sandbox', {
    connection,
    reject: rejects[1],
    timer: setTimeout(() => undefined, 60_000),
  })
  internals.pendingBackfillRequests.set('backfill', {
    connection,
    reject: rejects[2],
    timer: setTimeout(() => undefined, 60_000),
  })
  return rejects
}

describe('RunnerPoolObject session command acknowledgement [spec: runners/live-prompt]', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    createDepsMock.mockReset()
    createDepsMock.mockReturnValue({
      workItems: {
        list: vi.fn().mockResolvedValue({ rows: [] }),
        findLatestBySessions: vi.fn().mockResolvedValue([]),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('[spec: runners/heartbeat-load-recovery] retries available work on an existing connection after capacity recovers', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    const workItem = {
      id: 'work_available',
      organizationId: 'org_1',
      projectId: 'project_1',
      sessionId: 'session_2',
      environmentId: 'env_1',
      runnerId: null,
      leaseId: null,
      type: 'session.start',
      state: 'available',
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      payload: { type: 'session.start', runtimeRequirement: { runtime: 'enbor' } },
      result: null,
      error: null,
      availableAt: '2020-01-01T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    }
    createDepsMock.mockReturnValue({
      runners: {
        find: vi.fn().mockResolvedValue({
          id: 'runner_1',
          organizationId: 'org_1',
          projectId: 'project_1',
          name: 'Runner',
          environmentId: 'env_1',
          secretRef: null,
          authMode: 'realmroot',
          state: 'active',
          currentLoad: 0,
          maxConcurrent: 1,
          runtimeUsage: [],
          runtimes: [{ runtime: 'enbor', models: [], state: 'ready' }],
          metadata: {},
          oidcSubject: 'runner-subject',
          oidcClientId: 'runner-client',
          lastHeartbeatAt: '2020-01-01T00:00:00.000Z',
          deletedAt: null,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        }),
      },
      workItems: {
        list: vi.fn().mockResolvedValue({ rows: [workItem], hasMore: false }),
        find: vi.fn().mockResolvedValue({ ...workItem, runnerId: 'runner_1', state: 'leased' }),
        rawPayload: vi.fn().mockResolvedValue(workItem.payload),
      },
      leases: {
        expireStale: vi.fn().mockResolvedValue(0),
        claimCandidate: vi.fn().mockResolvedValue({
          state: 'available',
          availableAt: workItem.availableAt,
          environmentId: 'env_1',
          sessionId: 'session_2',
          rawPayload: workItem.payload,
        }),
        claim: vi.fn().mockResolvedValue({
          lease: {
            id: 'lease_2',
            workItemId: workItem.id,
            runnerId: 'runner_1',
            state: 'active',
            expiresAt: '2099-01-01T00:00:00.000Z',
            renewedAt: null,
            resumeToken: null,
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-01T00:00:00.000Z',
          },
          sessionId: 'session_2',
        }),
      },
    })

    expect(connection.assigned).toBe(1)
    const response = await retryAvailableWork(pool)

    expect(response.status).toBe(202)
    await vi.waitFor(() => expect(socket.sent).toContainEqual(expect.objectContaining({ type: 'work.assigned' })))
    expect(internals.runners.get('runner_1')).toBe(connection)
    expect(connection.assigned).toBe(1)
  })

  it('[spec: runners/enbor-sandbox-channel] rejects live events forged for a session owned by another runner', async () => {
    const { env, relay } = relayEnv()
    const { internals, connection } = createPool(true, env)
    const runnerB: TestConnection = {
      ...connection,
      scope: { ...connection.scope, runnerId: 'runner_2' },
      socket: createSocket(),
    }
    internals.runners.set('runner_2', runnerB)

    await internals.handleRunnerMessage(runnerB, runnerEvent('session_1'))

    expect(relay).not.toHaveBeenCalled()
  })

  it('[spec: runners/enbor-sandbox-channel] rejects live events whose inner session differs from the envelope', async () => {
    const { env, relay } = relayEnv()
    const { internals, connection } = createPool(true, env)

    await internals.handleRunnerMessage(connection, runnerEvent('session_1', 'session_2'))

    expect(relay).not.toHaveBeenCalled()
  })

  it('[spec: runners/enbor-sandbox-channel] binds backfill responses to the exact connection and session', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    const responsePromise = requestBackfill(pool)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    const eventId = socket.sent[0]?.eventId
    const replacement: TestConnection = { ...connection, socket: createSocket() }
    internals.runners.set('runner_1', replacement)

    await internals.handleRunnerMessage(
      replacement,
      JSON.stringify({
        type: 'session.backfill_response',
        eventId,
        sessionId: 'session_1',
        events: [relayedEventRecord('session_1')],
      }),
    )
    expect(internals.pendingBackfillRequests.size).toBe(1)

    internals.runners.set('runner_1', connection)
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.backfill_response',
        eventId,
        sessionId: 'session_2',
        events: [relayedEventRecord('session_2')],
      }),
    )
    expect(internals.pendingBackfillRequests.size).toBe(1)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.backfill_response',
        eventId,
        sessionId: 'session_1',
        events: [relayedEventRecord('session_2'), relayedEventRecord('session_1', 2)],
      }),
    )

    const response = await responsePromise
    expect(internals.pendingBackfillRequests.size).toBe(0)
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ id: 'event_session_1_2', sessionId: 'session_1' }],
      hasMore: false,
    })
  })

  it.each([
    { accepted: true, status: 202 },
    { accepted: false, status: 409 },
  ])('waits for an acknowledgement before returning $status', async ({ accepted, status }) => {
    const { pool, internals, connection, socket } = createPool(true)
    socket.onSend = (frame) => {
      queueMicrotask(() => {
        void internals.handleRunnerMessage(
          connection,
          JSON.stringify({
            type: 'session.command.result',
            requestId: frame.requestId,
            sessionId: 'session_1',
            runnerId: 'runner_1',
            accepted,
          }),
        )
      })
    }

    const response = await dispatch(pool, 'stable_command_1')

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ active: accepted })
    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]).toMatchObject({
      type: 'session.command',
      sessionId: 'session_1',
      runnerId: 'runner_1',
      command: { type: 'send', message: 'resume' },
    })
    expect(socket.sent[0]?.requestId).toBe('stable_command_1')
  })

  it('returns 409 when an acknowledgement times out', async () => {
    vi.useFakeTimers()
    const { pool } = createPool(true)
    const responsePromise = dispatch(pool)

    await vi.advanceTimersByTimeAsync(5_000)

    const response = await responsePromise
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ active: false })
  })

  it('returns 409 when the runner closes while an acknowledgement is pending', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    socket.onSend = () => queueMicrotask(() => internals.closeRunner(connection))

    const response = await dispatch(pool)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ active: false })
    expect(internals.pendingCommandRequests.size).toBe(0)
  })

  it('does not overwrite a pending command with the same session and request id', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    let notifySent: (() => void) | undefined
    const sent = new Promise<void>((resolve) => {
      notifySent = resolve
    })
    socket.onSend = () => notifySent?.()
    const firstResponsePromise = dispatch(pool, 'shared_command_id', { message: 'original command' })
    await sent

    const duplicateResponse = await dispatch(pool, 'shared_command_id', { message: 'conflicting command' })

    expect(duplicateResponse.status).toBe(409)
    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]?.command).toEqual({ type: 'send', message: 'original command' })
    expect(internals.pendingCommandRequests.size).toBe(1)
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.command.result',
        requestId: 'shared_command_id',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        accepted: true,
      }),
    )
    expect((await firstResponsePromise).status).toBe(202)
    expect(internals.pendingCommandRequests.size).toBe(0)
  })

  it('tracks the same request id independently across sessions', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    internals.sessionRunners.set('session_2', connection)
    let notifyBothSent: (() => void) | undefined
    const bothSent = new Promise<void>((resolve) => {
      notifyBothSent = resolve
    })
    socket.onSend = () => {
      if (socket.sent.length === 2) notifyBothSent?.()
    }
    const firstResponsePromise = dispatch(pool, 'same_request_id', { sessionId: 'session_1' })
    const secondResponsePromise = dispatch(pool, 'same_request_id', { sessionId: 'session_2' })
    await bothSent

    expect(internals.pendingCommandRequests.size).toBe(2)
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.command.result',
        requestId: 'same_request_id',
        sessionId: 'session_2',
        runnerId: 'runner_1',
        accepted: true,
      }),
    )
    expect(internals.pendingCommandRequests.size).toBe(1)
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.command.result',
        requestId: 'same_request_id',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        accepted: true,
      }),
    )

    expect((await firstResponsePromise).status).toBe(202)
    expect((await secondResponsePromise).status).toBe(202)
    expect(internals.pendingCommandRequests.size).toBe(0)
  })

  it('rejects an acknowledgement pending on a superseded connection and safely reuses the same request id', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    let replacement: TestConnection | null = null
    socket.onSend = () => {
      queueMicrotask(() => {
        const replacementSocket = createSocket()
        replacement = { ...connection, socket: replacementSocket }
        internals.runners.set('runner_1', replacement)
        internals.closeRunner(connection)
      })
    }

    const supersededResponse = await dispatch(pool, 'command_across_reconnect')

    expect(supersededResponse.status).toBe(409)
    expect(internals.pendingCommandRequests.size).toBe(0)
    expect(replacement).not.toBeNull()
    const activeConnection = replacement as unknown as TestConnection
    internals.sessionRunners.set('session_1', activeConnection)
    let notifyReplacementSent: (() => void) | undefined
    const replacementSent = new Promise<void>((resolve) => {
      notifyReplacementSent = resolve
    })
    activeConnection.socket.onSend = () => notifyReplacementSent?.()
    const replacementResponsePromise = dispatch(pool, 'command_across_reconnect')
    await replacementSent
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.command.result',
        requestId: 'command_across_reconnect',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        accepted: true,
      }),
    )
    expect(internals.pendingCommandRequests.size).toBe(1)
    await internals.handleRunnerMessage(
      activeConnection,
      JSON.stringify({
        type: 'session.command.result',
        requestId: 'command_across_reconnect',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        accepted: true,
      }),
    )

    const replacementResponse = await replacementResponsePromise
    expect(replacementResponse.status).toBe(202)
    expect(activeConnection.socket.sent[0]?.requestId).toBe('command_across_reconnect')
    expect(internals.pendingCommandRequests.size).toBe(0)
  })

  it('does not resolve a pending command from an acknowledgement with the wrong context', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    let notifySent: (() => void) | undefined
    const sent = new Promise<void>((resolve) => {
      notifySent = resolve
    })
    socket.onSend = () => notifySent?.()
    const responsePromise = dispatch(pool, 'context_bound_command')
    await sent

    const wrongConnection: TestConnection = { ...connection, socket: createSocket() }
    for (const [ackConnection, sessionId, runnerId] of [
      [connection, 'session_2', 'runner_1'],
      [connection, 'session_1', 'runner_2'],
      [wrongConnection, 'session_1', 'runner_1'],
    ] as const) {
      await internals.handleRunnerMessage(
        ackConnection,
        JSON.stringify({
          type: 'session.command.result',
          requestId: 'context_bound_command',
          sessionId,
          runnerId,
          accepted: true,
        }),
      )
      expect(internals.pendingCommandRequests.size).toBe(1)
    }

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'session.command.result',
        requestId: 'context_bound_command',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        accepted: true,
      }),
    )
    expect((await responsePromise).status).toBe(202)
    expect(internals.pendingCommandRequests.size).toBe(0)
  })

  it('cleans up a pending acknowledgement when socket.send throws', async () => {
    const { pool, internals, socket } = createPool(true)
    socket.send = () => {
      throw new Error('socket is closed')
    }

    const response = await dispatch(pool, 'command_send_failure')

    expect(response.status).toBe(409)
    expect(internals.pendingCommandRequests.size).toBe(0)
  })

  it('does not dispatch through a completed session retained only for backfill', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'work.completed', sessionId: 'session_1', runnerId: 'runner_1' }),
    )

    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect(internals.sessionBackfillRunners.get('session_1')).toBe(connection)
    const response = await dispatch(pool)
    expect(response.status).toBe(409)
    expect(socket.sent).toEqual([])
  })

  it('[spec: runners/enbor-sandbox-channel] routes sandbox requests after Enbor startup but retires normal completions', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'work.completed',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        sessionActive: true,
      }),
    )

    expect(internals.sessionRunners.get('session_1')).toBe(connection)
    const responsePromise = requestSandbox(pool)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(socket.sent[0]).toMatchObject({
      type: 'sandbox.request',
      sessionId: 'session_1',
      runnerId: 'runner_1',
      request: { type: 'sandbox.execute' },
    })
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'sandbox.response',
        requestId: socket.sent[0]?.requestId,
        sessionId: 'session_1',
        runnerId: 'runner_1',
        ok: true,
        result: { stdout: 'ok' },
      }),
    )
    const response = await responsePromise
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, result: { stdout: 'ok' } })

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'work.completed', sessionId: 'session_1', runnerId: 'runner_1' }),
    )
    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect((await requestSandbox(pool)).status).toBe(409)
  })

  it('[spec: runners/enbor-sandbox-channel] does not create an absent Enbor route from active completion alone', async () => {
    const { pool, internals, connection } = createPool(true)
    internals.sessionRunners.delete('session_1')
    internals.sessionBackfillRunners.delete('session_1')

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'work.completed',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        sessionActive: true,
      }),
    )

    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect(internals.sessionBackfillRunners.has('session_1')).toBe(false)
    expect((await requestSandbox(pool)).status).toBe(409)
  })

  it('[spec: runners/enbor-sandbox-channel] does not overwrite another runner owner from active completion', async () => {
    const { internals, connection } = createPool(true)
    const runnerB: TestConnection = {
      ...connection,
      scope: { ...connection.scope, runnerId: 'runner_2' },
      socket: createSocket(),
    }
    internals.runners.set('runner_2', runnerB)
    internals.sessionRunners.set('session_1', runnerB)
    internals.sessionBackfillRunners.set('session_1', runnerB)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'work.completed',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        sessionActive: true,
      }),
    )

    expect(internals.sessionRunners.get('session_1')).toBe(runnerB)
    expect(internals.sessionBackfillRunners.get('session_1')).toBe(runnerB)
  })

  it('[spec: runners/enbor-sandbox-channel] restores completed Enbor sandbox routing after runner reconnect', async () => {
    const { pool, internals, connection } = createPool(true)
    internals.closeRunner(connection)
    const replacement: TestConnection = { ...connection, socket: createSocket() }
    internals.runners.set('runner_1', replacement)
    createDepsMock.mockReturnValueOnce({
      workItems: {
        findLatestBySessions: vi
          .fn()
          .mockResolvedValue([{ runnerId: 'runner_1', environmentId: 'env_1', sessionId: 'session_1' }]),
      },
    })

    await internals.handleRunnerMessage(
      replacement,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_1'] }),
    )

    expect(internals.sessionRunners.get('session_1')).toBe(replacement)
    expect(internals.sessionBackfillRunners.get('session_1')).toBe(replacement)
    const responsePromise = requestSandbox(pool)
    await vi.waitFor(() => expect(replacement.socket.sent).toHaveLength(1))
    await internals.handleRunnerMessage(
      replacement,
      JSON.stringify({
        type: 'sandbox.response',
        requestId: replacement.socket.sent[0]?.requestId,
        sessionId: 'session_1',
        runnerId: 'runner_1',
        ok: true,
        result: { restored: true },
      }),
    )
    await expect((await responsePromise).json()).resolves.toEqual({ ok: true, result: { restored: true } })
  })

  it('[spec: runners/enbor-sandbox-channel] does not restore stale sessions after the runner advertises its authoritative set', async () => {
    const { internals, connection } = createPool(true)
    let resolveRestore!: (page: { rows: Array<{ environmentId: string; sessionId: string }> }) => void
    const restorePage = new Promise<{ rows: Array<{ environmentId: string; sessionId: string }> }>((resolve) => {
      resolveRestore = resolve
    })
    const list = vi.fn().mockReturnValue(restorePage)
    createDepsMock.mockReturnValueOnce({ workItems: { list } })

    const restore = internals.restoreActiveSessions(connection)
    expect(list).toHaveBeenCalledOnce()
    createDepsMock.mockReturnValueOnce({
      workItems: {
        findLatestBySessions: vi
          .fn()
          .mockResolvedValue([{ runnerId: 'runner_1', environmentId: 'env_1', sessionId: 'session_live' }]),
      },
    })
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_live'] }),
    )
    resolveRestore({ rows: [{ environmentId: 'env_1', sessionId: 'session_stale' }] })
    await restore

    expect(connection.sessionsAdvertised).toBe(true)
    expect(internals.sessionRunners.get('session_live')).toBe(connection)
    expect(internals.sessionRunners.has('session_stale')).toBe(false)
    expect(internals.sessionBackfillRunners.has('session_stale')).toBe(false)
  })

  it('[spec: runners/enbor-sandbox-channel] rejects an advertised session without a matching persisted assignment', async () => {
    const { internals, connection } = createPool(true)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_arbitrary'] }),
    )

    expect(connection.sessionsAdvertised).toBe(true)
    expect(internals.sessionRunners.has('session_arbitrary')).toBe(false)
    expect(internals.sessionBackfillRunners.has('session_arbitrary')).toBe(false)
  })

  it('[spec: runners/enbor-sandbox-channel] rejects historical runner ownership when the latest assignment belongs to another runner', async () => {
    const { pool, internals, connection } = createPool(true)
    const findLatestBySessions = vi
      .fn()
      .mockResolvedValue([{ runnerId: 'runner_2', environmentId: 'env_1', sessionId: 'session_1' }])
    createDepsMock.mockReturnValueOnce({ workItems: { findLatestBySessions } })

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_1'] }),
    )

    expect(findLatestBySessions).toHaveBeenCalledWith('project_1', ['session_1'])
    expect(internals.sessionRunners.has('session_1')).toBe(false)
    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: false })
  })

  it('[spec: runners/enbor-sandbox-channel] closes the runner without a leased-route fallback when ownership validation fails', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    const pendingRejects = seedPendingRequests(internals, connection)
    const list = vi.fn().mockResolvedValue({ rows: [] })
    createDepsMock.mockReturnValueOnce({
      workItems: {
        findLatestBySessions: vi.fn().mockRejectedValue(new Error('D1 unavailable')),
        list,
      },
    })

    await expect(
      internals.handleRunnerMessage(
        connection,
        JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_1'] }),
      ),
    ).rejects.toThrow('D1 unavailable')

    expect(connection.sessionsAdvertised).toBe(false)
    expect(internals.runners.has('runner_1')).toBe(false)
    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect(internals.sessionBackfillRunners.has('session_1')).toBe(false)
    expect(internals.pendingCommandRequests.size).toBe(0)
    expect(internals.pendingSandboxRequests.size).toBe(0)
    expect(internals.pendingBackfillRequests.size).toBe(0)
    for (const reject of pendingRejects) expect(reject).toHaveBeenCalledOnce()
    expect(list).not.toHaveBeenCalled()
    expect(socket.closedWith).toEqual([{ code: 1011, reason: 'Session ownership validation failed' }])
    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: false })
    expect((await dispatch(pool)).status).toBe(409)
    await expect((await requestBackfill(pool)).json()).resolves.toMatchObject({ runnerUnavailable: true, rows: [] })
  })

  it('[spec: runners/enbor-sandbox-channel] closes oversized advertisements before querying ownership or changing routes', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    const pendingRejects = seedPendingRequests(internals, connection)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'runner.sessions.active',
        runnerId: 'runner_1',
        sessionIds: Array.from({ length: 1_001 }, () => 'session_1'),
      }),
    )

    expect(connection.sessionsAdvertised).toBe(false)
    expect(createDepsMock).not.toHaveBeenCalled()
    expect(internals.runners.has('runner_1')).toBe(false)
    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect(internals.sessionBackfillRunners.has('session_1')).toBe(false)
    expect(internals.pendingCommandRequests.size).toBe(0)
    expect(internals.pendingSandboxRequests.size).toBe(0)
    expect(internals.pendingBackfillRequests.size).toBe(0)
    for (const reject of pendingRejects) expect(reject).toHaveBeenCalledOnce()
    expect(socket.closedWith).toEqual([{ code: 1009, reason: 'Too many active sessions advertised' }])
    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: false })
    expect((await dispatch(pool)).status).toBe(409)
    expect(createDepsMock).not.toHaveBeenCalled()
    await expect((await requestBackfill(pool)).json()).resolves.toMatchObject({ runnerUnavailable: true, rows: [] })
  })

  it('[spec: runners/enbor-sandbox-channel] keeps existing routes available until every advertised session is validated', async () => {
    const { pool, internals, connection } = createPool(true)
    let resolveValidation!: (rows: Array<{ runnerId: string; environmentId: string; sessionId: string }>) => void
    const validation = new Promise<Array<{ runnerId: string; environmentId: string; sessionId: string }>>((resolve) => {
      resolveValidation = resolve
    })
    const findLatestBySessions = vi.fn().mockReturnValue(validation)
    createDepsMock.mockReturnValueOnce({ workItems: { findLatestBySessions } })

    const advertisement = internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_2'] }),
    )
    expect(findLatestBySessions).toHaveBeenCalledOnce()

    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: true })
    expect(internals.sessionRunners.get('session_1')).toBe(connection)
    expect(internals.sessionRunners.has('session_2')).toBe(false)

    resolveValidation([{ runnerId: 'runner_1', environmentId: 'env_1', sessionId: 'session_2' }])
    await advertisement

    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: false })
    await expect((await sessionStatus(pool, 'session_2')).json()).resolves.toEqual({ active: true })
    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect(internals.sessionRunners.get('session_2')).toBe(connection)
  })

  it('[spec: runners/enbor-sandbox-channel] keeps omitted sessions inactive while a replacement connection validates its advertisement', async () => {
    const { pool, internals, connection } = createPool(true)
    internals.sessionRunners.set('session_2', connection)
    internals.sessionBackfillRunners.set('session_2', connection)
    const replacement: TestConnection = {
      ...connection,
      socket: createSocket(),
      sessionsAdvertised: false,
    }
    internals.runners.set('runner_1', replacement)
    let resolveValidation!: (rows: Array<{ runnerId: string; environmentId: string; sessionId: string }>) => void
    const validation = new Promise<Array<{ runnerId: string; environmentId: string; sessionId: string }>>((resolve) => {
      resolveValidation = resolve
    })
    const findLatestBySessions = vi.fn().mockReturnValue(validation)
    createDepsMock.mockReturnValueOnce({ workItems: { findLatestBySessions } })

    const advertisement = internals.handleRunnerMessage(
      replacement,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_1'] }),
    )
    expect(findLatestBySessions).toHaveBeenCalledOnce()

    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: false })
    await expect((await sessionStatus(pool, 'session_2')).json()).resolves.toEqual({ active: false })
    expect((await requestSandbox(pool, 'session_1')).status).toBe(409)
    expect((await requestSandbox(pool, 'session_2')).status).toBe(409)
    expect(replacement.socket.sent).toEqual([])

    resolveValidation([{ runnerId: 'runner_1', environmentId: 'env_1', sessionId: 'session_1' }])
    await advertisement

    await expect((await sessionStatus(pool, 'session_1')).json()).resolves.toEqual({ active: true })
    await expect((await sessionStatus(pool, 'session_2')).json()).resolves.toEqual({ active: false })
    expect(internals.sessionRunners.get('session_1')).toBe(replacement)
    expect(internals.sessionRunners.get('session_2')).toBe(connection)
  })

  it('[spec: runners/enbor-sandbox-channel] ignores an asynchronous restore from a superseded connection', async () => {
    const { internals, connection } = createPool(true)
    let resolveRestore!: (page: { rows: Array<{ environmentId: string; sessionId: string }> }) => void
    const restorePage = new Promise<{ rows: Array<{ environmentId: string; sessionId: string }> }>((resolve) => {
      resolveRestore = resolve
    })
    const list = vi.fn().mockReturnValue(restorePage)
    createDepsMock.mockReturnValueOnce({ workItems: { list } })

    const restore = internals.restoreActiveSessions(connection)
    expect(list).toHaveBeenCalledOnce()
    const replacement: TestConnection = { ...connection, socket: createSocket() }
    internals.runners.set('runner_1', replacement)
    resolveRestore({ rows: [{ environmentId: 'env_1', sessionId: 'session_stale' }] })
    await restore

    expect(internals.sessionRunners.has('session_stale')).toBe(false)
    expect(internals.sessionBackfillRunners.has('session_stale')).toBe(false)
  })

  it('[spec: runners/enbor-sandbox-channel] does not overwrite another runner owner while restoring leased sessions', async () => {
    const { internals, connection } = createPool(true)
    const runnerB: TestConnection = {
      ...connection,
      scope: { ...connection.scope, runnerId: 'runner_2' },
      socket: createSocket(),
    }
    internals.runners.set('runner_2', runnerB)
    internals.sessionRunners.set('session_foreign', runnerB)
    internals.sessionBackfillRunners.set('session_foreign', runnerB)
    createDepsMock.mockReturnValueOnce({
      workItems: {
        list: vi.fn().mockResolvedValue({ rows: [{ environmentId: 'env_1', sessionId: 'session_foreign' }] }),
      },
    })

    await internals.restoreActiveSessions(connection)

    expect(internals.sessionRunners.get('session_foreign')).toBe(runnerB)
    expect(internals.sessionBackfillRunners.get('session_foreign')).toBe(runnerB)
  })

  it('[spec: runners/enbor-sandbox-channel] ignores route replacement and retirement from an invalid runner context', async () => {
    const { internals, connection } = createPool(true)
    const replacement: TestConnection = { ...connection, socket: createSocket() }
    internals.runners.set('runner_1', replacement)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['stale_session'] }),
    )
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.session.inactive', runnerId: 'runner_1', sessionId: 'session_1' }),
    )

    expect(internals.sessionRunners.get('session_1')).toBe(connection)
    expect(internals.sessionRunners.has('stale_session')).toBe(false)
    expect(internals.sessionBackfillRunners.get('session_1')).toBe(connection)
  })

  it('[spec: runners/enbor-sandbox-channel] retires an inactive live route while preserving backfill', async () => {
    const { pool, internals, connection } = createPool(true)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.session.inactive', runnerId: 'runner_1', sessionId: 'session_1' }),
    )

    expect(internals.sessionRunners.has('session_1')).toBe(false)
    expect(internals.sessionBackfillRunners.get('session_1')).toBe(connection)
    expect((await requestSandbox(pool)).status).toBe(409)
  })

  it('[spec: runners/enbor-sandbox-channel] preserves a route owned by another runner across late terminal and active frames', async () => {
    const { internals, connection } = createPool(true)
    const runnerB: TestConnection = {
      ...connection,
      scope: { ...connection.scope, runnerId: 'runner_2' },
      socket: createSocket(),
    }
    internals.runners.set('runner_2', runnerB)
    internals.sessionRunners.set('session_1', runnerB)

    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'work.completed', sessionId: 'session_1', runnerId: 'runner_1' }),
    )
    expect(internals.sessionRunners.get('session_1')).toBe(runnerB)

    createDepsMock.mockReturnValueOnce({
      workItems: {
        findLatestBySessions: vi
          .fn()
          .mockResolvedValue([{ runnerId: 'runner_2', environmentId: 'env_1', sessionId: 'session_1' }]),
      },
    })
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({ type: 'runner.sessions.active', runnerId: 'runner_1', sessionIds: ['session_1'] }),
    )
    expect(internals.sessionRunners.get('session_1')).toBe(runnerB)
  })

  it('[spec: runners/enbor-sandbox-channel] binds pending sandbox requests to the exact connection across replacement', async () => {
    const { pool, internals, connection, socket } = createPool(true)
    const supersededResponsePromise = requestSandbox(pool)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))

    const replacement: TestConnection = { ...connection, socket: createSocket() }
    internals.runners.set('runner_1', replacement)
    internals.closeRunner(connection)

    const supersededResponse = await supersededResponsePromise
    expect(supersededResponse.status).toBe(502)
    await expect(supersededResponse.json()).resolves.toEqual({ ok: false, error: 'runner channel closed' })
    expect(internals.pendingSandboxRequests.size).toBe(0)

    internals.sessionRunners.set('session_1', replacement)
    const replacementResponsePromise = requestSandbox(pool)
    await vi.waitFor(() => expect(replacement.socket.sent).toHaveLength(1))
    const replacementRequest = replacement.socket.sent[0]
    await internals.handleRunnerMessage(
      connection,
      JSON.stringify({
        type: 'sandbox.response',
        requestId: replacementRequest?.requestId,
        sessionId: 'session_1',
        runnerId: 'runner_1',
        ok: true,
        result: { from: 'stale' },
      }),
    )
    expect(internals.pendingSandboxRequests.size).toBe(1)

    await internals.handleRunnerMessage(
      replacement,
      JSON.stringify({
        type: 'sandbox.response',
        requestId: replacementRequest?.requestId,
        sessionId: 'session_1',
        runnerId: 'runner_1',
        ok: true,
        result: { from: 'replacement' },
      }),
    )
    await expect((await replacementResponsePromise).json()).resolves.toEqual({
      ok: true,
      result: { from: 'replacement' },
    })
    expect(internals.pendingSandboxRequests.size).toBe(0)
  })

  it('rejects legacy runners that cannot acknowledge command delivery', async () => {
    const { pool, socket } = createPool(false)

    const response = await dispatch(pool)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      active: false,
      error: 'Runner must be upgraded to accept acknowledged commands',
    })
    expect(socket.sent).toHaveLength(0)
  })
})
