import { describe, expect, it, vi } from 'vitest'
import type { CloudTurnQueueStartMessage } from '../ports'
import { recoverSessionCreations } from './session-creation-recovery'

const message: CloudTurnQueueStartMessage = {
  type: 'session.start',
  sessionId: 'session',
  organizationId: 'org',
  projectId: 'project',
  runtime: 'enbor',
  runtimeConfig: {},
  env: {},
  envFrom: [],
  volumes: [],
  volumeMounts: [],
  prompt: 'Start once',
}

function fixture(state: string | null = 'pending') {
  let pending = true
  const enqueue = vi.fn(async () => undefined)
  const store = {
    pendingCloudSessionCreations: vi.fn(async () => (pending ? [message] : [])),
    findSession: vi.fn(async () => (state ? { state } : null)),
    acknowledgeCloudSessionCreation: vi.fn(async () => {
      pending = false
    }),
  }
  return { store, enqueue, deps: { sessionOrchestration: store, cloudTurnQueue: { enqueue } } }
}

describe('[spec: sessions/create-idempotency] durable cloud startup recovery', () => {
  it('delivers persisted work after interruption and clears only its delivery intent', async () => {
    const { deps, enqueue, store } = fixture()
    await recoverSessionCreations(deps)
    await recoverSessionCreations(deps)
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(message)
    expect(store.acknowledgeCloudSessionCreation).toHaveBeenCalledExactlyOnceWith('project', 'session')
  })
  it('retains work after a delivery failure for the next recovery pass', async () => {
    const { deps, enqueue, store } = fixture()
    enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    await expect(recoverSessionCreations(deps)).rejects.toThrow('recovery failed')
    expect(store.acknowledgeCloudSessionCreation).not.toHaveBeenCalled()
    await recoverSessionCreations(deps)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })
  it.each(['closed', 'error', 'idle', null])('does not restart a %s Session', async (state) => {
    const { deps, enqueue, store } = fixture(state)
    await recoverSessionCreations(deps)
    expect(enqueue).not.toHaveBeenCalled()
    expect(store.acknowledgeCloudSessionCreation).toHaveBeenCalledOnce()
  })
})
