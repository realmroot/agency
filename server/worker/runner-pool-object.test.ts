import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { RunnerPoolObject } from './runner-pool-object'

type TestSocket = {
  readyState: number
  sent: Array<Record<string, unknown>>
  onSend?: (frame: Record<string, unknown>) => void
  send: (value: string) => void
  close: () => void
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
}

type RunnerPoolInternals = {
  runners: Map<string, TestConnection>
  sessionRunners: Map<string, string>
  sessionBackfillRunners: Map<string, string>
  pendingCommandRequests: Map<string, unknown>
  handleRunnerMessage: (connection: TestConnection, data: string) => Promise<void>
  closeRunner: (connection: TestConnection) => void
}

function createSocket(): TestSocket {
  const socket: TestSocket = {
    readyState: 1,
    sent: [],
    send(value) {
      const frame = JSON.parse(value) as Record<string, unknown>
      socket.sent.push(frame)
      socket.onSend?.(frame)
    },
    close() {
      socket.readyState = 3
    },
  }
  return socket
}

function createPool(commandAcknowledgement: boolean) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise.catch(() => undefined)
  })
  const pool = new RunnerPoolObject({ waitUntil } as unknown as DurableObjectState, {} as Env)
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
  }
  internals.runners.set('runner_1', connection)
  internals.sessionRunners.set('session_1', 'runner_1')
  internals.sessionBackfillRunners.set('session_1', 'runner_1')
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

describe('RunnerPoolObject session command acknowledgement [spec: runners/live-prompt]', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
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
    internals.sessionRunners.set('session_2', 'runner_1')
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
    expect(internals.sessionBackfillRunners.get('session_1')).toBe('runner_1')
    const response = await dispatch(pool)
    expect(response.status).toBe(409)
    expect(socket.sent).toEqual([])
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
