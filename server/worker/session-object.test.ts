import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { SessionObject } from './session-object'

type TicketScope = {
  sessionId: string
  organizationId: string
  projectId: string
  userId: string
}

type TicketRecord = { scope: TicketScope; origin: string; expiresAt: string }

function fixture() {
  const values = new Map<string, unknown>()
  let alarm: number | null = null
  const storage = {
    async put(key: string, value: unknown) {
      values.set(key, value)
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value: number) {
      alarm = value
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...values].filter(([key]) => key.startsWith(prefix))) as Map<string, T>
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key)
    },
    async transaction<T>(
      callback: (transaction: {
        get<U>(key: string): Promise<U | undefined>
        delete(key: string): Promise<void>
      }) => Promise<T>,
    ) {
      return await callback({
        async get<U>(key: string) {
          return values.get(key) as U | undefined
        },
        async delete(key: string) {
          values.delete(key)
        },
      })
    },
  }
  const state = {
    storage,
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
  const object = new SessionObject(state, {} as Env)
  const privateObject = object as unknown as {
    consumeBrowserTicket(ticket: string, sessionId: string, origin: string | null): Promise<TicketScope | null>
  }
  return { object, privateObject, values, alarm: () => alarm }
}

const scope: TicketScope = {
  sessionId: 'session_1',
  organizationId: 'org_1',
  projectId: 'project_1',
  userId: 'user_1',
}

async function issue(object: SessionObject, value: TicketScope = scope, origin = 'https://enbor.example.com') {
  const response = await object.fetch(
    new Request('https://session-object/browser-tickets', {
      method: 'POST',
      body: JSON.stringify({ scope: value, origin }),
    }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as { ticket: string; expiresAt: string }
}

describe('[spec: sessions/socket-ticket] SessionObject browser tickets', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('issues a random 32-byte ticket, stores only its hash, and schedules the 30-second expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T00:00:00.000Z')
    const subject = fixture()

    const first = await issue(subject.object)
    const second = await issue(subject.object)

    expect(first.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.ticket).not.toBe(first.ticket)
    expect(Date.parse(first.expiresAt) - Date.now()).toBe(30_000)
    expect(subject.alarm()).toBe(Date.parse(first.expiresAt))
    const stored = [...subject.values.entries()]
    expect(stored).toHaveLength(2)
    for (const [key, record] of stored as Array<[string, TicketRecord]>) {
      expect(key).toMatch(/^browser-ticket:[A-Za-z0-9_-]{43}$/)
      expect(key).not.toContain(first.ticket)
      expect(key).not.toContain(second.ticket)
      expect(record).toMatchObject({ scope, origin: 'https://enbor.example.com' })
    }
  })

  it('atomically consumes a valid ticket exactly once', async () => {
    const subject = fixture()
    const { ticket } = await issue(subject.object)

    await expect(
      subject.privateObject.consumeBrowserTicket(ticket, scope.sessionId, 'https://enbor.example.com'),
    ).resolves.toEqual(scope)
    await expect(
      subject.privateObject.consumeBrowserTicket(ticket, scope.sessionId, 'https://enbor.example.com'),
    ).resolves.toBeNull()
    expect(subject.values.size).toBe(0)
  })

  it.each([
    ['wrong session', 'session_other', 'https://enbor.example.com'],
    ['wrong Origin', scope.sessionId, 'https://evil.example.com'],
  ])('rejects a ticket with %s without consuming its valid binding', async (_case, sessionId, origin) => {
    const subject = fixture()
    const { ticket } = await issue(subject.object)

    await expect(subject.privateObject.consumeBrowserTicket(ticket, sessionId, origin)).resolves.toBeNull()
    await expect(
      subject.privateObject.consumeBrowserTicket(ticket, scope.sessionId, 'https://enbor.example.com'),
    ).resolves.toEqual(scope)
    await expect(
      subject.privateObject.consumeBrowserTicket(ticket, scope.sessionId, 'https://enbor.example.com'),
    ).resolves.toBeNull()
  })

  it('rejects an expired ticket and alarm cleanup removes expired records', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T00:00:00.000Z')
    const subject = fixture()
    const first = await issue(subject.object)
    vi.advanceTimersByTime(10_000)
    const second = await issue(subject.object, { ...scope, sessionId: 'session_2' })

    vi.advanceTimersByTime(20_001)
    await subject.object.alarm()
    expect(subject.values.size).toBe(1)
    expect(subject.alarm()).toBe(Date.parse(second.expiresAt))
    await expect(
      subject.privateObject.consumeBrowserTicket(first.ticket, scope.sessionId, 'https://enbor.example.com'),
    ).resolves.toBeNull()

    vi.advanceTimersByTime(10_000)
    await expect(
      subject.privateObject.consumeBrowserTicket(second.ticket, 'session_2', 'https://enbor.example.com'),
    ).resolves.toBeNull()
    expect(subject.values.size).toBe(0)
  })

  it('rejects a malformed enbor-ticket protocol with 401 instead of entering the trusted-scope path', async () => {
    const subject = fixture()
    const response = await subject.object.fetch(
      new Request('https://session-object/browser?sessionId=session_1', {
        headers: {
          upgrade: 'websocket',
          origin: 'https://enbor.example.com',
          'sec-websocket-protocol': 'enbor-ticket.not-a-valid-ticket',
        },
      }),
    )

    expect(response.status).toBe(401)
  })
})
