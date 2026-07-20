import type { Env } from '@server/env'
import { describe, expect, it, vi } from 'vitest'
import { createTriggerDispatchQueue } from './trigger-dispatch-queue'

function queueEnv(send?: ReturnType<typeof vi.fn>): Env {
  return {
    ...(send ? { TRIGGER_DISPATCHES: { send } as unknown as Queue<unknown> } : {}),
  } as Env
}

describe('trigger dispatch queue gateway', () => {
  it('reports an absent binding and safely skips enqueue', async () => {
    const queue = createTriggerDispatchQueue(queueEnv())

    expect(queue.configured()).toBe(false)
    await expect(
      queue.enqueue({ type: 'trigger.dispatch', triggerId: 'trigger_1', projectId: 'project_1' }),
    ).resolves.toBeUndefined()
  })

  it('sends immediate wake messages without queue options', async () => {
    const send = vi.fn(async () => {})
    const queue = createTriggerDispatchQueue(queueEnv(send))
    const message = { type: 'trigger.dispatch' as const, triggerId: 'trigger_1', projectId: 'project_1' }

    expect(queue.configured()).toBe(true)
    await queue.enqueue(message)

    expect(send).toHaveBeenCalledWith(message, undefined)
  })

  it('forwards delayed wake options to Cloudflare Queues', async () => {
    const send = vi.fn(async () => {})
    const queue = createTriggerDispatchQueue(queueEnv(send))
    const message = { type: 'trigger.dispatch' as const, triggerId: 'trigger_1', projectId: 'project_1' }

    await queue.enqueue(message, { delaySeconds: 5 })

    expect(send).toHaveBeenCalledWith(message, { delaySeconds: 5 })
  })
})
