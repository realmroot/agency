import { describe, expect, it, vi } from 'vitest'

// The router records usage through the usage-write repo on the DO path; mock it
// so the unit suite needs no D1, while still asserting the "record exactly once"
// invariant fires for cloud-loop appends.
const recordProviderSignals = vi.fn()
vi.mock('../repos/usage-write', () => ({ createUsageWriteRepo: () => ({ recordProviderSignals }) }))

import type { EnborEvent } from '@shared/session-events'
import { createCloudLoopChecker, createEventStore } from './session-event-store'

function fakeStampDb(
  row:
    | {
        metadata: string | null
        organizationId?: string | null
        projectId?: string
        environmentId?: string | null
      }
    | undefined,
) {
  const get = vi.fn().mockResolvedValue(row)
  const db = { select: vi.fn(() => ({ from: () => ({ where: () => ({ get }) }) })), _get: get }
  return db
}

describe('createCloudLoopChecker', () => {
  it('returns true for a session stamped session-do and caches the lookup', async () => {
    const db = fakeStampDb({ metadata: JSON.stringify({ eventStore: 'session-do' }) })
    const check = createCloudLoopChecker(db as never)
    expect(await check('sess_1')).toBe(true)
    expect(await check('sess_1')).toBe(true)
    expect(db._get).toHaveBeenCalledTimes(1)
  })

  it('returns false when the session is unstamped, missing, or has no metadata', async () => {
    expect(
      await createCloudLoopChecker(fakeStampDb({ metadata: JSON.stringify({ runtime: 'ama' }) }) as never)('s'),
    ).toBe(false)
    expect(await createCloudLoopChecker(fakeStampDb({ metadata: null }) as never)('s')).toBe(false)
    expect(await createCloudLoopChecker(fakeStampDb(undefined) as never)('s')).toBe(false)
  })
})

function fakeDoStore() {
  return {
    append: vi.fn().mockResolvedValue({ id: 'do_event', sequence: 1, record: { id: 'do_event' } }),
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'do_event' }], hasMore: false }),
    relayQuery: vi.fn().mockResolvedValue({ rows: [{ id: 'relay_event' }], hasMore: false }),
    stream: vi.fn().mockResolvedValue([{ type: 'turn.completed', payload: '{}' }]),
    count: vi.fn().mockResolvedValue(1),
    archive: vi.fn().mockResolvedValue(undefined),
  }
}

const scope = { organizationId: 'org_1', projectId: 'project_1', sessionId: 'sess_1' }
const event: EnborEvent = { type: 'turn.completed', payload: {} }
const query = { order: 'asc' as const, limit: 50 }

// Every non-cloud session now relays over the per-runner channel. The isCloudLoop
// checker is the only branch; the separate relay checker is gone.
function makeStore(inDo: boolean, environmentId: string | null = 'env_1') {
  const doStore = fakeDoStore()
  const db = fakeStampDb({
    metadata: null,
    organizationId: 'org_1',
    projectId: 'project_1',
    environmentId,
  })
  const store = createEventStore(db as never, async () => inDo, doStore as never)
  return { store, doStore }
}

describe('createEventStore — storage follows the loop', () => {
  it('cloud-loop append goes to the DO and records usage exactly once', async () => {
    recordProviderSignals.mockClear()
    const { store, doStore } = makeStore(true)
    const id = await store.appendEvent(scope, event)
    expect(id).toBe('do_event')
    expect(doStore.append).toHaveBeenCalledWith(scope, event)
    expect(recordProviderSignals).toHaveBeenCalledTimes(1)
  })

  it('non-cloud append is a relay no-op — the runner store-and-serves it', async () => {
    recordProviderSignals.mockClear()
    const { store, doStore } = makeStore(false)
    const id = await store.appendEvent(scope, event)
    expect(id).toBe('relay')
    expect(doStore.append).not.toHaveBeenCalled()
    expect(recordProviderSignals).not.toHaveBeenCalled()
  })

  it('cloud-loop queryEvents goes to the DO', async () => {
    const cloud = makeStore(true)
    expect((await cloud.store.queryEvents('sess_1', query)).rows[0]).toEqual({ id: 'do_event' })
    expect(cloud.doStore.query).toHaveBeenCalledWith('sess_1', query)
  })

  it('non-cloud queryEvents relays to the runner and does not fall back to cloud storage', async () => {
    const relay = makeStore(false)
    expect((await relay.store.queryEvents('sess_1', query)).rows[0]).toEqual({ id: 'relay_event' })
    expect(relay.doStore.relayQuery).toHaveBeenCalledWith('sess_1', query, {
      organizationId: 'org_1',
      projectId: 'project_1',
      environmentId: 'env_1',
    })

    const offline = makeStore(false)
    offline.doStore.relayQuery.mockResolvedValue({ rows: [], hasMore: false, runnerUnavailable: true })
    expect(await offline.store.queryEvents('sess_1', query)).toEqual({
      rows: [],
      hasMore: false,
      runnerUnavailable: true,
    })
  })

  it('routes eventStream to the DO for cloud-loop and returns no cloud transcript for relay sessions', async () => {
    const cloud = makeStore(true)
    expect(await cloud.store.eventStream('sess_1')).toEqual([{ type: 'turn.completed', payload: '{}' }])
    expect(cloud.doStore.stream).toHaveBeenCalledWith('sess_1')

    const local = makeStore(false)
    expect(await local.store.eventStream('sess_1')).toEqual([])
  })

  it('archives only cloud-loop sessions (no-op on relay)', async () => {
    const cloud = makeStore(true)
    await cloud.store.archive(scope)
    expect(cloud.doStore.archive).toHaveBeenCalledWith(scope)

    const relay = makeStore(false)
    await relay.store.archive(scope)
    expect(relay.doStore.archive).not.toHaveBeenCalled()
  })

  it('insertEvents canonicalises each event and routes it through append', async () => {
    const { store, doStore } = makeStore(true)
    const count = await store.insertEvents(scope, [
      { type: 'turn.completed', payload: {} },
      { type: 'runtime.error', payload: { message: 'x' } },
    ])
    expect(count).toBe(2)
    expect(doStore.append).toHaveBeenCalledTimes(2)
  })
})
