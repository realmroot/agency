import { isAmaSessionEventType } from '@shared/session-events'
import { createDeps } from '../composition'
import type { Env } from '../env'
import { claimLease, materializeWorkItemPayload } from '../usecases/leases'
import type { AuthScope, EventQuery, LeaseRecord, RunnerAuthRecord, WorkItemRecord } from '../usecases/ports'
import { type EventWriteContext, pageRelayedEvents, type RelayedRunnerEvent } from './session-event-store-sql'

type RunnerScope = {
  runnerId: string
  organizationId: string
  projectId: string
  environmentId: string
  commandAcknowledgement: boolean
}

type RunnerConnection = {
  scope: RunnerScope
  socket: WebSocket
  assigned: number
  sessionsAdvertised: boolean
}

type PendingSandboxRequest = {
  connection: RunnerConnection
  sessionId: string
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type PendingCommandRequest = {
  connection: RunnerConnection
  sessionId: string
  requestId: string
  commandJson: string
  resolve: (accepted: boolean) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type PendingBackfillRequest = {
  connection: RunnerConnection
  sessionId: string
  resolve: (events: RelayedRunnerEvent[]) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const MAX_ADVERTISED_SESSIONS = 1_000

export class RunnerPoolObject implements DurableObject {
  private readonly runners = new Map<string, RunnerConnection>()
  private readonly sessionRunners = new Map<string, RunnerConnection>()
  private readonly sessionBackfillRunners = new Map<string, RunnerConnection>()
  private readonly pendingCommandRequests = new Map<string, PendingCommandRequest>()
  private readonly pendingSandboxRequests = new Map<string, PendingSandboxRequest>()
  private readonly pendingBackfillRequests = new Map<string, PendingBackfillRequest>()

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/runner-connect') {
      return this.connectRunner(request, url)
    }
    if (url.pathname === '/assign' && request.method === 'POST') {
      return this.assignWork(await request.json())
    }
    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return this.dispatch(await request.json())
    }
    if (url.pathname === '/request' && request.method === 'POST') {
      return this.requestRunnerSandbox(await request.json())
    }
    if (url.pathname === '/backfill' && request.method === 'POST') {
      return this.requestRunnerBackfill(await request.json())
    }
    if (url.pathname === '/status' && request.method === 'POST') {
      return this.status(await request.json())
    }
    return new Response('Not found', { status: 404 })
  }

  private connectRunner(request: Request, url: URL) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const scope = runnerScopeFromUrl(url)
    const previous = this.runners.get(scope.runnerId)
    if (previous) {
      this.rejectPendingCommands(previous, 'runner channel superseded')
      this.rejectPendingSandbox(previous, 'runner channel superseded')
    }
    if (previous?.socket.readyState === WebSocket.OPEN) {
      previous.socket.close(4000, 'Superseded runner channel')
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()
    const connection: RunnerConnection = { scope, socket: server, assigned: 0, sessionsAdvertised: false }
    this.runners.set(scope.runnerId, connection)
    server.send(
      JSON.stringify({ type: 'runner.channel.accepted', runnerId: scope.runnerId, environmentId: scope.environmentId }),
    )
    server.addEventListener('message', (event) => {
      this.durableState.waitUntil(this.handleRunnerMessage(connection, event.data))
    })
    server.addEventListener('close', () => {
      this.closeRunner(connection)
    })
    this.durableState.waitUntil(
      (async () => {
        await this.restoreActiveSessions(connection)
        await this.dispatchAvailableWork(scope)
      })(),
    )
    return new Response(null, { status: 101, webSocket: client })
  }

  private closeRunner(connection: RunnerConnection) {
    this.rejectPendingCommands(connection, 'runner channel closed')
    this.rejectPendingSandbox(connection, 'runner channel closed')
    if (this.runners.get(connection.scope.runnerId) !== connection) {
      return
    }
    this.runners.delete(connection.scope.runnerId)
    for (const [sessionId, owner] of this.sessionRunners) {
      if (owner === connection) {
        this.sessionRunners.delete(sessionId)
      }
    }
    for (const [sessionId, owner] of this.sessionBackfillRunners) {
      if (owner === connection) {
        this.sessionBackfillRunners.delete(sessionId)
      }
    }
    for (const [requestId, pending] of this.pendingBackfillRequests) {
      if (pending.connection !== connection) {
        continue
      }
      pending.reject(new Error('runner channel closed'))
      clearTimeout(pending.timer)
      this.pendingBackfillRequests.delete(requestId)
    }
  }

  private rejectPendingSandbox(connection: RunnerConnection, message: string) {
    for (const [requestId, pending] of this.pendingSandboxRequests) {
      if (pending.connection !== connection) {
        continue
      }
      pending.reject(new Error(message))
      clearTimeout(pending.timer)
      this.pendingSandboxRequests.delete(requestId)
    }
  }

  private rejectPendingCommands(connection: RunnerConnection, message: string) {
    for (const [requestId, pending] of this.pendingCommandRequests) {
      if (pending.connection !== connection) {
        continue
      }
      pending.reject(new Error(message))
      clearTimeout(pending.timer)
      this.pendingCommandRequests.delete(requestId)
    }
  }

  private failRunnerConnection(connection: RunnerConnection, code: number, reason: string): void {
    this.closeRunner(connection)
    connection.socket.close(code, reason)
  }

  private status(body: { sessionId?: string }): Response {
    const connection = typeof body.sessionId === 'string' ? this.connectionForSession(body.sessionId) : null
    return Response.json({ active: Boolean(connection?.socket.readyState === WebSocket.OPEN) })
  }

  private async assignWork(body: unknown): Promise<Response> {
    const request = body as { organizationId?: string; projectId?: string; environmentId?: string; workItemId?: string }
    if (!request.organizationId || !request.projectId || !request.environmentId || !request.workItemId) {
      return Response.json({ ok: false, error: 'Invalid runner pool assignment request' }, { status: 400 })
    }
    const result = await this.dispatchOne(
      request.organizationId,
      request.projectId,
      request.environmentId,
      request.workItemId,
    )
    return Response.json(result, { status: result.ok ? 202 : 409 })
  }

  private async dispatchAvailableWork(scope: RunnerScope): Promise<void> {
    const deps = createDeps(this.env)
    const page = await deps.workItems.list({
      projectId: scope.projectId,
      state: 'available',
      limit: 20,
      cursor: null,
    })
    for (const workItem of page.rows) {
      if (workItem.environmentId !== scope.environmentId) {
        continue
      }
      await this.dispatchOne(scope.organizationId, scope.projectId, scope.environmentId, workItem.id)
    }
  }

  private async restoreActiveSessions(connection: RunnerConnection): Promise<void> {
    const { scope } = connection
    const deps = createDeps(this.env)
    const page = await deps.workItems.list({
      projectId: scope.projectId,
      runnerId: scope.runnerId,
      state: 'leased',
      limit: 100,
      cursor: null,
    })
    if (this.runners.get(scope.runnerId) !== connection || connection.sessionsAdvertised) {
      return
    }
    for (const workItem of page.rows) {
      if (workItem.environmentId !== scope.environmentId || !workItem.sessionId) {
        continue
      }
      const owner = this.sessionRunners.get(workItem.sessionId)
      if (!owner || owner === connection) {
        this.sessionRunners.set(workItem.sessionId, connection)
        this.sessionBackfillRunners.set(workItem.sessionId, connection)
      }
    }
  }

  private async dispatchOne(organizationId: string, projectId: string, environmentId: string, workItemId: string) {
    const deps = createDeps(this.env)
    const candidates = [...this.runners.values()]
      .filter(
        (runner) =>
          runner.scope.organizationId === organizationId &&
          runner.scope.projectId === projectId &&
          runner.scope.environmentId === environmentId &&
          runner.socket.readyState === WebSocket.OPEN,
      )
      .sort((a, b) => a.assigned - b.assigned || a.scope.runnerId.localeCompare(b.scope.runnerId))

    for (const connection of candidates) {
      const runner = await deps.runners.find(projectId, connection.scope.runnerId)
      if (!runner || runner.environmentId !== environmentId || runner.state !== 'active') {
        continue
      }
      if (connection.assigned >= runner.maxConcurrent) {
        continue
      }
      const auth = runnerAuthScope(organizationId, projectId, runner)
      try {
        const lease = await claimLease(deps, auth, runner, {
          workItemId,
          leaseDurationSeconds: undefined,
        })
        const workItem = await deps.workItems.find(projectId, workItemId)
        if (!workItem) {
          continue
        }
        const payload = await materializeWorkItemPayload(deps, { organizationId, projectId }, workItem)
        this.sendAssignedWork(connection, lease, { ...workItem, payload })
        connection.assigned += 1
        if (workItem.sessionId) {
          this.sessionRunners.set(workItem.sessionId, connection)
          this.sessionBackfillRunners.set(workItem.sessionId, connection)
        }
        return { ok: true, runnerId: connection.scope.runnerId, leaseId: lease.id }
      } catch {}
    }
    return { ok: false, error: 'No online runner has capacity for this work item' }
  }

  private sendAssignedWork(connection: RunnerConnection, lease: LeaseRecord, workItem: WorkItemRecord) {
    connection.socket.send(
      JSON.stringify({
        type: 'work.assigned',
        runnerId: connection.scope.runnerId,
        lease: serializeLease(lease),
        workItem: serializeWorkItem(workItem),
      }),
    )
  }

  private async dispatch(body: { sessionId?: string; command?: unknown; requestId?: unknown }): Promise<Response> {
    if (typeof body.sessionId !== 'string') {
      return Response.json({ active: false }, { status: 409 })
    }
    const connection = this.connectionForSession(body.sessionId)
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ active: false }, { status: 409 })
    }
    if (!connection.scope.commandAcknowledgement) {
      return Response.json(
        { active: false, error: 'Runner must be upgraded to accept acknowledged commands' },
        { status: 409 },
      )
    }
    try {
      const requestId =
        typeof body.requestId === 'string' && body.requestId.length > 0 && body.requestId.length <= 160
          ? body.requestId
          : `command_${crypto.randomUUID()}`
      const accepted = await this.sendCommandRequest(connection, body.sessionId, body.command, requestId)
      return Response.json({ active: accepted }, { status: accepted ? 202 : 409 })
    } catch {
      return Response.json({ active: false }, { status: 409 })
    }
  }

  private sendCommandRequest(
    connection: RunnerConnection,
    sessionId: string,
    command: unknown,
    requestId: string,
  ): Promise<boolean> {
    const pendingKey = commandRequestKey(sessionId, requestId)
    const commandJson = JSON.stringify(command)
    const existing = this.pendingCommandRequests.get(pendingKey)
    if (existing) {
      const reason =
        existing.commandJson === commandJson ? 'runner command is already pending' : 'runner command id conflict'
      return Promise.reject(new Error(reason))
    }
    return new Promise<boolean>((resolve, reject) => {
      let pending: PendingCommandRequest
      const timer = setTimeout(() => {
        if (this.pendingCommandRequests.get(pendingKey) === pending) {
          this.pendingCommandRequests.delete(pendingKey)
        }
        reject(new Error('runner command acknowledgement timed out'))
      }, 5_000)
      pending = { connection, sessionId, requestId, commandJson, resolve, reject, timer }
      this.pendingCommandRequests.set(pendingKey, pending)
      try {
        connection.socket.send(
          JSON.stringify({
            type: 'session.command',
            requestId,
            sessionId,
            runnerId: connection.scope.runnerId,
            command,
          }),
        )
      } catch (error) {
        clearTimeout(timer)
        if (this.pendingCommandRequests.get(pendingKey) === pending) {
          this.pendingCommandRequests.delete(pendingKey)
        }
        reject(error instanceof Error ? error : new Error('runner command send failed'))
      }
    })
  }

  private async requestRunnerSandbox(body: {
    sessionId?: string
    request?: unknown
    timeoutMs?: number
  }): Promise<Response> {
    if (typeof body.sessionId !== 'string' || !body.request || typeof body.request !== 'object') {
      return Response.json({ ok: false, error: 'Runner sandbox channel is unavailable' }, { status: 409 })
    }
    const connection = this.connectionForSession(body.sessionId)
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ ok: false, error: 'Runner sandbox channel is unavailable' }, { status: 409 })
    }
    try {
      const result = await this.sendSandboxRequest(
        connection,
        body.sessionId,
        body.request as Record<string, unknown>,
        typeof body.timeoutMs === 'number' ? body.timeoutMs : 120_000,
      )
      return Response.json({ ok: true, result })
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : 'Runner sandbox request failed' },
        { status: 502 },
      )
    }
  }

  private sendSandboxRequest(
    connection: RunnerConnection,
    sessionId: string,
    request: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const requestId = `sandbox_${crypto.randomUUID()}`
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pendingSandboxRequests.delete(requestId)
          reject(new Error('runner sandbox request timed out'))
        },
        Math.max(1, timeoutMs),
      )
      this.pendingSandboxRequests.set(requestId, {
        connection,
        sessionId,
        resolve,
        reject,
        timer,
      })
      connection.socket.send(
        JSON.stringify({
          type: 'sandbox.request',
          requestId,
          sessionId,
          runnerId: connection.scope.runnerId,
          request,
        }),
      )
    })
  }

  private async requestRunnerBackfill(body: {
    organizationId?: string
    projectId?: string
    sessionId?: string
    query?: EventQuery
    timeoutMs?: number
  }): Promise<Response> {
    if (typeof body.sessionId !== 'string' || typeof body.projectId !== 'string' || !body.query) {
      return Response.json({ rows: [], hasMore: false, runnerUnavailable: true })
    }
    const connection =
      this.connectionForBackfill(body.sessionId) ??
      (await this.restoreBackfillConnection(body.projectId, body.sessionId))
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ rows: [], hasMore: false, runnerUnavailable: true })
    }
    try {
      const events = await this.sendBackfillRequest(
        connection,
        body.sessionId,
        typeof body.timeoutMs === 'number' ? body.timeoutMs : 30_000,
      )
      const page = pageRelayedEvents(
        events,
        {
          organizationId: connection.scope.organizationId,
          projectId: connection.scope.projectId,
          sessionId: body.sessionId,
        },
        body.query,
      )
      return Response.json(page)
    } catch {
      return Response.json({ rows: [], hasMore: false, runnerUnavailable: true })
    }
  }

  private async restoreBackfillConnection(projectId: string, sessionId: string): Promise<RunnerConnection | null> {
    const deps = createDeps(this.env)
    const page = await deps.workItems.list({
      projectId,
      sessionId,
      limit: 20,
      cursor: null,
    })
    for (const workItem of page.rows) {
      if (!workItem.runnerId || workItem.environmentId === null) {
        continue
      }
      const connection = this.runners.get(workItem.runnerId)
      if (
        connection?.socket.readyState === WebSocket.OPEN &&
        connection.scope.projectId === projectId &&
        connection.scope.environmentId === workItem.environmentId
      ) {
        this.sessionBackfillRunners.set(sessionId, connection)
        return connection
      }
    }
    return null
  }

  private sendBackfillRequest(
    connection: RunnerConnection,
    sessionId: string,
    timeoutMs: number,
  ): Promise<RelayedRunnerEvent[]> {
    const requestId = `backfill_${crypto.randomUUID()}`
    return new Promise<RelayedRunnerEvent[]>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pendingBackfillRequests.delete(requestId)
          reject(new Error('runner backfill request timed out'))
        },
        Math.max(1, timeoutMs),
      )
      this.pendingBackfillRequests.set(requestId, { connection, sessionId, resolve, reject, timer })
      connection.socket.send(
        JSON.stringify({
          type: 'session.backfill_request',
          eventId: requestId,
          sessionId,
          runnerId: connection.scope.runnerId,
        }),
      )
    })
  }

  private connectionForSession(sessionId: string): RunnerConnection | null {
    const connection = this.sessionRunners.get(sessionId)
    if (!connection || this.runners.get(connection.scope.runnerId) !== connection) {
      return null
    }
    return connection
  }

  private connectionForBackfill(sessionId: string): RunnerConnection | null {
    const connection = this.sessionBackfillRunners.get(sessionId)
    if (!connection || this.runners.get(connection.scope.runnerId) !== connection) {
      return null
    }
    return connection
  }

  private async handleRunnerMessage(connection: RunnerConnection, data: unknown) {
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : JSON.parse(String(data))
      if (!parsed || typeof parsed !== 'object') {
        return
      }
      frame = parsed as Record<string, unknown>
    } catch {
      return
    }
    if (this.runners.get(connection.scope.runnerId) !== connection) {
      return
    }
    if (frame.type === 'session.command.result') {
      this.resolveCommandResponse(connection, frame)
      return
    }
    if (frame.type === 'sandbox.response') {
      this.resolveSandboxResponse(connection, frame)
      return
    }
    if (frame.type === 'session.backfill_response') {
      this.resolveBackfillResponse(connection, frame)
      return
    }
    if (frame.type === 'runner.sessions.active') {
      await this.replaceRunnerSessions(connection, frame)
      return
    }
    if (frame.type === 'runner.session.inactive') {
      this.retireRunnerSession(connection, frame)
      return
    }
    if (frame.type === 'work.completed' || frame.type === 'work.failed' || frame.type === 'work.cancelled') {
      connection.assigned = Math.max(0, connection.assigned - 1)
      const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null
      if (sessionId) {
        const owner = this.sessionRunners.get(sessionId)
        if (frame.sessionActive === true && owner === connection) {
          this.sessionRunners.set(sessionId, connection)
          this.sessionBackfillRunners.set(sessionId, connection)
        } else if (frame.sessionActive !== true && owner === connection) {
          this.sessionRunners.delete(sessionId)
        }
      }
      this.durableState.waitUntil(this.dispatchAvailableWork(connection.scope))
      return
    }
    if (frame.type !== 'runner.event') {
      return
    }
    await this.handleRunnerEvent(connection, frame)
  }

  private resolveCommandResponse(connection: RunnerConnection, record: Record<string, unknown>): void {
    const requestId = typeof record.requestId === 'string' ? record.requestId : null
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
    const runnerId = typeof record.runnerId === 'string' ? record.runnerId : null
    if (!requestId || !sessionId || runnerId !== connection.scope.runnerId) {
      return
    }
    const pendingKey = commandRequestKey(sessionId, requestId)
    const pending = this.pendingCommandRequests.get(pendingKey)
    if (
      !pending ||
      pending.connection !== connection ||
      pending.sessionId !== sessionId ||
      pending.requestId !== requestId
    ) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingCommandRequests.delete(pendingKey)
    pending.resolve(record.accepted === true)
  }

  private async replaceRunnerSessions(connection: RunnerConnection, record: Record<string, unknown>): Promise<void> {
    if (record.runnerId !== connection.scope.runnerId || !Array.isArray(record.sessionIds)) {
      return
    }
    if (record.sessionIds.length > MAX_ADVERTISED_SESSIONS) {
      this.failRunnerConnection(connection, 1009, 'Too many active sessions advertised')
      return
    }
    const advertisedSessionIds = [
      ...new Set(
        record.sessionIds.filter(
          (sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0,
        ),
      ),
    ]
    connection.sessionsAdvertised = true
    let assignments: WorkItemRecord[]
    try {
      assignments = await createDeps(this.env).workItems.findLatestBySessions(
        connection.scope.projectId,
        advertisedSessionIds,
      )
    } catch (error) {
      if (this.runners.get(connection.scope.runnerId) === connection) {
        connection.sessionsAdvertised = false
        this.failRunnerConnection(connection, 1011, 'Session ownership validation failed')
      }
      throw error
    }
    if (this.runners.get(connection.scope.runnerId) !== connection) {
      return
    }
    const validatedSessionIds = advertisedSessionIds.filter((sessionId) =>
      assignments.some(
        (assignment) =>
          assignment.sessionId === sessionId &&
          assignment.runnerId === connection.scope.runnerId &&
          assignment.environmentId === connection.scope.environmentId,
      ),
    )
    for (const [sessionId, owner] of this.sessionRunners) {
      if (owner === connection) {
        this.sessionRunners.delete(sessionId)
      }
    }
    for (const sessionId of validatedSessionIds) {
      this.sessionRunners.set(sessionId, connection)
      this.sessionBackfillRunners.set(sessionId, connection)
    }
  }

  private retireRunnerSession(connection: RunnerConnection, record: Record<string, unknown>): void {
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
    if (record.runnerId !== connection.scope.runnerId || !sessionId) {
      return
    }
    if (this.sessionRunners.get(sessionId) === connection) {
      this.sessionRunners.delete(sessionId)
    }
  }

  private resolveSandboxResponse(connection: RunnerConnection, record: Record<string, unknown>): void {
    const requestId = typeof record.requestId === 'string' ? record.requestId : null
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
    if (!requestId || !sessionId || record.runnerId !== connection.scope.runnerId) {
      return
    }
    const pending = this.pendingSandboxRequests.get(requestId)
    if (!pending || pending.connection !== connection || pending.sessionId !== sessionId) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingSandboxRequests.delete(requestId)
    if (record.ok === false) {
      pending.reject(new Error(typeof record.error === 'string' ? record.error : 'runner sandbox request failed'))
      return
    }
    pending.resolve(
      record.result && typeof record.result === 'object' && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : {},
    )
  }

  private resolveBackfillResponse(connection: RunnerConnection, record: Record<string, unknown>): void {
    const requestId = typeof record.eventId === 'string' ? record.eventId : null
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
    if (!requestId || !sessionId) {
      return
    }
    const pending = this.pendingBackfillRequests.get(requestId)
    if (!pending || pending.connection !== connection || pending.sessionId !== sessionId) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingBackfillRequests.delete(requestId)
    if (typeof record.error === 'string') {
      pending.reject(new Error(record.error))
      return
    }
    const events = Array.isArray(record.events)
      ? record.events.flatMap((value) => {
          const event = relayedRunnerEventFrom(value)
          return event?.sessionId === sessionId ? [event] : []
        })
      : []
    pending.resolve(events)
  }

  private async handleRunnerEvent(connection: RunnerConnection, frame: Record<string, unknown>) {
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null
    if (!sessionId || this.sessionRunners.get(sessionId) !== connection) {
      return
    }
    const raw = relayedRunnerEventFrom(frame.record)
    if (!raw || raw.sessionId !== sessionId) {
      return
    }
    await fanOutRelayedEvent(this.env, {
      scope: {
        organizationId: connection.scope.organizationId,
        projectId: connection.scope.projectId,
        sessionId,
      },
      raw,
    })
  }
}

function runnerAuthScope(organizationId: string, projectId: string, runner: RunnerAuthRecord): AuthScope {
  return {
    organization: { id: organizationId, name: organizationId },
    project: { id: projectId, name: projectId, organizationId },
    user: { id: `runner:${runner.id}` },
    roles: [],
    permissions: [],
  }
}

function serializeLease(lease: LeaseRecord) {
  return {
    id: lease.id,
    workItemId: lease.workItemId,
    runnerId: lease.runnerId,
    state: lease.state,
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
    resumeToken: lease.resumeToken,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  }
}

function serializeWorkItem(workItem: WorkItemRecord) {
  return {
    id: workItem.id,
    projectId: workItem.projectId,
    sessionId: workItem.sessionId,
    environmentId: workItem.environmentId,
    runnerId: workItem.runnerId,
    leaseId: workItem.leaseId,
    type: workItem.type,
    state: workItem.state,
    priority: workItem.priority,
    attempts: workItem.attempts,
    maxAttempts: workItem.maxAttempts,
    payload: workItem.payload,
    result: workItem.result,
    error: workItem.error,
    availableAt: workItem.availableAt,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  }
}

async function fanOutRelayedEvent(env: Env, body: { scope: EventWriteContext; raw: RelayedRunnerEvent }) {
  const stub = env.SESSION.get(env.SESSION.idFromName(body.scope.sessionId))
  await stub.fetch('https://session-object/events/relay-live', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function relayedRunnerEventFrom(value: unknown): RelayedRunnerEvent | null {
  const record = objectRecord(value)
  const payload = objectRecord(record?.payload)
  if (
    !record ||
    !payload ||
    typeof record.id !== 'string' ||
    typeof record.sessionId !== 'string' ||
    typeof record.sequence !== 'number' ||
    typeof record.createdAt !== 'string' ||
    typeof record.type !== 'string' ||
    !isAmaSessionEventType(record.type)
  ) {
    return null
  }
  return {
    id: record.id,
    sessionId: record.sessionId,
    sequence: record.sequence,
    createdAt: record.createdAt,
    type: record.type,
    payload,
  }
}

function requiredParam(url: URL, name: string) {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new Error(`Missing runner pool parameter ${name}`)
  }
  return value
}

function commandRequestKey(sessionId: string, requestId: string) {
  return `${sessionId}\u0000${requestId}`
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function runnerScopeFromUrl(url: URL): RunnerScope {
  return {
    runnerId: requiredParam(url, 'runnerId'),
    organizationId: requiredParam(url, 'organizationId'),
    projectId: requiredParam(url, 'projectId'),
    environmentId: requiredParam(url, 'environmentId'),
    commandAcknowledgement: url.searchParams.get('commandAcknowledgement') === 'true',
  }
}
