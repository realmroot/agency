// Per-session event store and browser socket hub. Cloud-loop events and relayed
// runner events are written into this DO's SQLite store, then fanned out to the
// browser sockets watching the same session.

import type { SessionSocketClientMessage } from '@enbor/runtime-contracts/session-socket'
import { sessionSocketClientMessageFrom } from '@enbor/runtime-contracts/session-socket'
import type { EnborEvent } from '@shared/session-events'
import { createDeps } from '../composition'
import type { Env } from '../env'
import type { AuthScope, EventPage, EventQuery } from '../usecases/ports'
import { closeSession, dispatchSessionPrompt } from '../usecases/runtime'
import {
  appendCanonicalEventToSql,
  countSessionEvents,
  type EventWriteContext,
  ensureSessionEventSchema,
  exportSessionEventsJsonl,
  queryEventsFromSql,
  type RelayedRunnerEvent,
  serializeRow,
  stepRelayEvent,
  streamSessionEvents,
} from './session-event-store-sql'

type AppendBody = {
  scope: EventWriteContext
  canonicalEvent: EnborEvent
}

type RelayAppendBody = {
  scope: EventWriteContext
  raw: RelayedRunnerEvent
}

type BrowserTicketRecord = {
  scope: BrowserScope
  origin: string
  expiresAt: string
}

const BROWSER_TICKET_TTL_MS = 30_000
const BROWSER_TICKET_PREFIX = 'browser-ticket:'

export class SessionObject implements DurableObject {
  private eventSchemaReady = false

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/browser') {
      return this.connectBrowser(request, url)
    }
    if (url.pathname === '/browser-tickets' && request.method === 'POST') {
      return this.issueBrowserTicket((await request.json()) as { scope: BrowserScope; origin: string })
    }
    if (url.pathname.startsWith('/events/') && request.method === 'POST') {
      return this.handleEvents(url.pathname, await request.json())
    }
    return new Response('Not found', { status: 404 })
  }

  async alarm() {
    await this.deleteExpiredBrowserTickets()
  }

  // The cloud event store routes. Appends are serialised by the DO single-thread,
  // so the in-DO sequence is allocated race-free. The worker-side gateway owns
  // usage accounting; this DO owns the rows (and, once wired, browser fan-out).
  private handleEvents(pathname: string, body: unknown): Response | Promise<Response> {
    if (pathname === '/events/append') {
      const sql = this.eventSql()
      const { scope, canonicalEvent } = body as AppendBody
      const appended = appendCanonicalEventToSql(sql, scope, canonicalEvent)
      // Fan the freshly-appended event out to every connected browser socket so
      // live chat updates without polling. Backfill (history) is served on request.
      this.fanOutToBrowsers({ type: 'event', record: appended.record }, scope.sessionId)
      return Response.json(appended)
    }
    if (pathname === '/events/relay-live') {
      const { scope, raw } = body as RelayAppendBody
      const record = serializeRow(stepRelayEvent(raw, scope))
      this.fanOutToBrowsers({ type: 'event', record }, scope.sessionId)
      return Response.json({ ok: true, record })
    }
    if (pathname === '/events/query') {
      const sql = this.eventSql()
      const { sessionId, query } = body as { sessionId: string; query: EventQuery }
      return Response.json(queryEventsFromSql(sql, sessionId, query))
    }
    if (pathname === '/events/count') {
      const sql = this.eventSql()
      const { sessionId } = body as { sessionId: string }
      return Response.json({ count: countSessionEvents(sql, sessionId) })
    }
    if (pathname === '/events/stream') {
      const sql = this.eventSql()
      const { sessionId } = body as { sessionId: string }
      return Response.json({ events: streamSessionEvents(sql, sessionId) })
    }
    if (pathname === '/events/archive') {
      return this.archiveEvents(this.eventSql(), body as { scope: EventWriteContext })
    }
    return new Response('Not found', { status: 404 })
  }

  private async archiveEvents(sql: SqlStorage, body: { scope: EventWriteContext }): Promise<Response> {
    const jsonl = exportSessionEventsJsonl(sql, body.scope.sessionId)
    const key = `sessions/${body.scope.sessionId}/events.jsonl`
    await this.env.SESSION_EVENTS.put(key, jsonl, {
      customMetadata: { organizationId: body.scope.organizationId, projectId: body.scope.projectId },
    })
    return Response.json({ archived: true, key, bytes: jsonl.length })
  }

  private eventSql(): SqlStorage {
    const sql = this.durableState.storage.sql
    if (!this.eventSchemaReady) {
      ensureSessionEventSchema(sql)
      this.eventSchemaReady = true
    }
    return sql
  }

  // ── browser transport ───────────────────────────────────────────────────────
  // One hibernatable WebSocket per browser tab. Console clients consume a
  // single-use ticket issued after HTTP auth and tenancy checks; DPoP-native SDK
  // clients arrive with the already-authorised scope stamped by the HTTP layer.
  // The DO stores the scope on the socket (surviving hibernation). The socket
  // carries live events (server→browser, fanned out on append), a backfill replay
  // on request, and inbound prompt/abort messages over the same socket.
  private async issueBrowserTicket(body: { scope: BrowserScope; origin: string }) {
    const ticket = randomTicket()
    const expiresAt = new Date(Date.now() + BROWSER_TICKET_TTL_MS).toISOString()
    await this.durableState.storage.put(ticketStorageKey(await ticketHash(ticket)), {
      scope: body.scope,
      origin: body.origin,
      expiresAt,
    } satisfies BrowserTicketRecord)
    const alarm = await this.durableState.storage.getAlarm()
    const expiry = Date.parse(expiresAt)
    if (alarm === null || alarm > expiry) await this.durableState.storage.setAlarm(expiry)
    return Response.json({ ticket, expiresAt })
  }

  private async connectBrowser(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const ticketProtocol = browserTicketProtocol(request)
    const ticket = browserTicketFromProtocol(ticketProtocol)
    if (ticketProtocol && !ticket) return new Response('Invalid or expired browser socket ticket', { status: 401 })
    const scope = ticket
      ? await this.consumeBrowserTicket(ticket, requiredParam(url, 'sessionId'), request.headers.get('origin'))
      : browserScopeFromUrl(url)
    if (!scope) return new Response('Invalid or expired browser socket ticket', { status: 401 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.durableState.acceptWebSocket(server, ['browser'])
    server.serializeAttachment(scope)
    // Push history immediately on connect so the chat renders from the socket alone
    // — events never travel over HTTP. Live events follow via fanOutToBrowsers.
    this.durableState.waitUntil(this.sendBackfill(server, scope.sessionId, { order: 'asc', limit: 200 }))
    const protocols = request.headers.get('sec-websocket-protocol') ?? ''
    const selectedProtocol = ticket ? 'ama-ticket' : protocols.includes('ama-dpop') ? 'ama-dpop' : null
    const headers = selectedProtocol ? { 'Sec-WebSocket-Protocol': selectedProtocol } : undefined
    return new Response(null, { status: 101, webSocket: client, ...(headers ? { headers } : {}) })
  }

  private async consumeBrowserTicket(ticket: string, sessionId: string, origin: string | null) {
    const key = ticketStorageKey(await ticketHash(ticket))
    return await this.durableState.storage.transaction(async (transaction) => {
      const stored = await transaction.get<BrowserTicketRecord>(key)
      if (!stored) return null
      if (Date.parse(stored.expiresAt) <= Date.now()) {
        await transaction.delete(key)
        return null
      }
      if (stored.scope.sessionId !== sessionId || stored.origin !== origin) return null
      await transaction.delete(key)
      return stored.scope
    })
  }

  private async deleteExpiredBrowserTickets() {
    const tickets = await this.durableState.storage.list<BrowserTicketRecord>({ prefix: BROWSER_TICKET_PREFIX })
    const now = Date.now()
    const expired = [...tickets].filter(([, record]) => Date.parse(record.expiresAt) <= now).map(([key]) => key)
    if (expired.length) await this.durableState.storage.delete(expired)
    const nextExpiry = [...tickets]
      .filter(([key]) => !expired.includes(key))
      .map(([, record]) => Date.parse(record.expiresAt))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0]
    if (nextExpiry !== undefined) await this.durableState.storage.setAlarm(nextExpiry)
  }

  // Fan a frame to every browser socket watching `sessionId`.
  private fanOutToBrowsers(frame: Record<string, unknown>, sessionId: string): void {
    const payload = JSON.stringify(frame)
    for (const ws of this.durableState.getWebSockets('browser')) {
      const scope = ws.deserializeAttachment() as BrowserScope | null
      if (scope?.sessionId !== sessionId) {
        continue
      }
      try {
        ws.send(payload)
      } catch {
        // A socket that errors on send is closing; hibernation reaps it.
      }
    }
  }

  // Hibernation message handler for browser sockets.
  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const scope = ws.deserializeAttachment() as BrowserScope | null
    if (!scope) {
      return
    }
    let message: SessionSocketClientMessage | null
    try {
      const text = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage)
      const parsed: unknown = JSON.parse(text)
      message = sessionSocketClientMessageFrom(parsed)
      if (!message) {
        this.sendSocketError(ws, undefined, 'Invalid session socket message')
        return
      }
    } catch {
      this.sendSocketError(ws, undefined, 'Invalid session socket JSON')
      return
    }
    if (message.type === 'backfill') {
      this.durableState.waitUntil(this.sendBackfill(ws, scope.sessionId, message))
      return
    }
    if (message.type === 'prompt') {
      this.durableState.waitUntil(this.handlePromptMessage(ws, scope, message))
      return
    }
    if (message.type === 'abort') {
      this.durableState.waitUntil(this.handleAbortMessage(ws, scope, message))
      return
    }
    this.sendSocketError(ws, requestIdFor(message), 'Session steer messages are not supported')
  }

  // Hibernation close handler. Hibernation reaps the socket; nothing to clean up.
  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  private async sendBackfill(ws: WebSocket, sessionId: string, frame: Record<string, unknown>): Promise<void> {
    const scope = ws.deserializeAttachment() as BrowserScope | null
    const requestId = requestIdFor(frame)
    const query: EventQuery = {
      order: 'asc',
      limit: typeof frame.limit === 'number' ? frame.limit : 200,
      ...(typeof frame.cursor === 'number' ? { cursor: frame.cursor } : {}),
      ...(typeof frame.eventType === 'string' ? { type: frame.eventType } : {}),
    }
    const runnerEnvironmentId = scope?.runnerEnvironmentId
    let page: EventPage & { runnerUnavailable?: boolean }
    try {
      page =
        runnerEnvironmentId !== undefined && scope !== null
          ? await this.requestRunnerBackfill({ ...scope, runnerEnvironmentId }, sessionId, query)
          : queryEventsFromSql(this.eventSql(), sessionId, query)
    } catch (error) {
      this.sendSocketError(ws, requestId, error instanceof Error ? error.message : 'Session backfill failed')
      return
    }
    if (ws.readyState !== WebSocket.OPEN) return
    if (page.runnerUnavailable) {
      ws.send(JSON.stringify({ type: 'runner_unavailable', message: 'Runner is unavailable for this session' }))
      return
    }
    const last = page.rows.at(-1)
    ws.send(
      JSON.stringify({
        type: 'backfill',
        requestId,
        events: page.rows,
        nextCursor: page.hasMore && last ? last.sequence : null,
        hasMore: page.hasMore,
      }),
    )
  }

  private async requestRunnerBackfill(
    scope: BrowserScope & { runnerEnvironmentId: string },
    sessionId: string,
    query: EventQuery,
  ): Promise<EventPage & { runnerUnavailable?: boolean }> {
    const stub = this.env.RUNNER_POOL.get(this.env.RUNNER_POOL.idFromName(scope.runnerEnvironmentId))
    const response = await stub.fetch('https://runner-pool/backfill', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        sessionId,
        query,
      }),
      headers: { 'content-type': 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`RunnerPool backfill failed with HTTP ${response.status}`)
    }
    return (await response.json()) as EventPage & { runnerUnavailable?: boolean }
  }

  private async handlePromptMessage(
    ws: WebSocket,
    scope: BrowserScope,
    message: Extract<SessionSocketClientMessage, { type: 'prompt' }>,
  ): Promise<void> {
    const requestId = requestIdFor(message)
    const outcome = await dispatchSessionPrompt(
      createDeps(this.env),
      browserAuthScope(scope),
      scope.sessionId,
      message.content,
    )
    if (!outcome.ok) {
      this.sendSocketError(ws, requestId, outcome.message)
      return
    }
    this.sendSocketAck(ws, requestId)
  }

  private async handleAbortMessage(
    ws: WebSocket,
    scope: BrowserScope,
    message: Extract<SessionSocketClientMessage, { type: 'abort' }>,
  ): Promise<void> {
    const requestId = requestIdFor(message)
    const outcome = await closeSession(
      createDeps(this.env),
      browserAuthScope(scope),
      scope.sessionId,
      requestId,
      message.reason,
    )
    if (!outcome.ok) {
      this.sendSocketError(ws, requestId, outcome.error.message)
      return
    }
    this.sendSocketAck(ws, requestId)
  }

  private sendSocketAck(ws: WebSocket, requestId: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ack', requestId }))
    }
  }

  private sendSocketError(ws: WebSocket, requestId: string | undefined, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', ...(requestId ? { requestId } : {}), message }))
    }
  }
}

function requestIdFor(message: Record<string, unknown>): string {
  return typeof message.requestId === 'string' ? message.requestId : crypto.randomUUID()
}

function requiredParam(url: URL, name: string) {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new Error(`Missing runner channel parameter ${name}`)
  }
  return value
}

// The owning-user scope the HTTP layer stamps onto a browser socket at upgrade
// (after it has authorised ownership). userId scopes inbound write frames.
type BrowserScope = {
  sessionId: string
  organizationId: string
  projectId: string
  userId: string
  runnerEnvironmentId?: string
}

function browserScopeFromUrl(url: URL): BrowserScope {
  return {
    sessionId: requiredParam(url, 'sessionId'),
    organizationId: requiredParam(url, 'organizationId'),
    projectId: requiredParam(url, 'projectId'),
    userId: requiredParam(url, 'userId'),
    ...(url.searchParams.get('runnerEnvironmentId')
      ? { runnerEnvironmentId: url.searchParams.get('runnerEnvironmentId') as string }
      : {}),
  }
}

function browserTicketProtocol(request: Request) {
  return (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => value.startsWith('ama-ticket.'))
}

function browserTicketFromProtocol(protocol: string | undefined) {
  const ticket = protocol?.slice('ama-ticket.'.length)
  return ticket && /^[A-Za-z0-9_-]{43}$/.test(ticket) ? ticket : null
}

function randomTicket() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function ticketHash(ticket: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket))))
}

function ticketStorageKey(hash: string) {
  return `${BROWSER_TICKET_PREFIX}${hash}`
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function browserAuthScope(scope: BrowserScope): AuthScope {
  return {
    organization: { id: scope.organizationId, name: scope.organizationId },
    project: { id: scope.projectId, name: scope.projectId, organizationId: scope.organizationId },
    user: { id: scope.userId },
    roles: [],
    permissions: [],
  }
}
