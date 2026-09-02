import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scheduledMocks = vi.hoisted(() => ({
  maintainCloudSessionLifecycle: vi.fn(async () => undefined),
  reconcileInboxSubscriptions: vi.fn(async () => undefined),
}))

vi.mock('./app', () => ({ createApp: () => ({ fetch: vi.fn() }) }))
vi.mock('@cloudflare/sandbox', () => ({ Sandbox: class Sandbox {} }))
vi.mock('./worker/runner-pool-object', () => ({ RunnerPoolObject: class RunnerPoolObject {} }))
vi.mock('./worker/session-object', () => ({ SessionObject: class SessionObject {} }))
vi.mock('./composition', () => ({ createDeps: () => ({}) }))
vi.mock('./scheduled-dispatch', () => ({ dispatchDueScheduledTriggers: vi.fn(async () => undefined) }))
vi.mock('./usecases/dispatch-triggers', () => ({
  consumeSerialHttpTriggerWake: vi.fn(),
  recoverSerialHttpTriggers: vi.fn(async () => undefined),
  wakeSerialHttpTriggerForSettledSession: vi.fn(),
}))
vi.mock('./usecases/inbox-activations', () => ({ recoverInboxActivations: vi.fn(async () => undefined) }))
vi.mock('./usecases/inbox-subscriptions', () => scheduledMocks)
vi.mock('./usecases/providers', () => ({ refreshPlatformCatalog: vi.fn(async () => undefined) }))
vi.mock('./usecases/runtime', () => ({
  consumeCloudTurnQueueMessage: vi.fn(),
  maintainCloudSessionLifecycle: scheduledMocks.maintainCloudSessionLifecycle,
  markCloudTurnDeadLettered: vi.fn(),
}))

import worker from './worker'

describe('Worker scheduled entry', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('[spec: sessions/idle-timeout] schedules one unified cloud Session lifecycle maintenance pass', async () => {
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) } as ExecutionContext

    worker.scheduled?.(
      { scheduledTime: Date.parse('2026-08-31T01:01:00.000Z') } as ScheduledController,
      {} as never,
      ctx,
    )
    await Promise.all(pending)

    expect(scheduledMocks.maintainCloudSessionLifecycle).toHaveBeenCalledOnce()
  })

  it('redacts callback and Basic credentials from scheduled failure logs', async () => {
    const callbackToken = 'B'.repeat(43)
    const basicCredential = 'Basic c2VydmljZS1jbGllbnQ6c2VydmljZS1zZWNyZXQ='
    scheduledMocks.reconcileInboxSubscriptions.mockRejectedValueOnce(
      new Error(`upstream body ${callbackToken}; authorization ${basicCredential}`),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) } as ExecutionContext

    worker.scheduled?.(
      { scheduledTime: Date.parse('2026-08-31T01:01:00.000Z') } as ScheduledController,
      {} as never,
      ctx,
    )
    await Promise.all(pending)

    expect(consoleError).toHaveBeenCalledOnce()
    const logged = String(consoleError.mock.calls[0]?.[0])
    expect(logged).toContain('scheduled.inbox-subscriptions.failed')
    expect(logged).not.toContain(callbackToken)
    expect(logged).not.toContain('c2VydmljZS1jbGllbnQ6c2VydmljZS1zZWNyZXQ')
    expect(logged).toContain('[redacted]')
  })
})
