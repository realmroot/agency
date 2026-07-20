import type { TriggerDispatchQueue, TriggerDispatchQueueMessage } from '@server/usecases/ports'
import type { Env } from '../../env'

export function createTriggerDispatchQueue(env: Env): TriggerDispatchQueue {
  return {
    configured() {
      return Boolean(env.TRIGGER_DISPATCHES)
    },

    async enqueue(message: TriggerDispatchQueueMessage, options?: { delaySeconds?: number }) {
      if (!env.TRIGGER_DISPATCHES) {
        return
      }
      await env.TRIGGER_DISPATCHES.send(
        message,
        options?.delaySeconds !== undefined ? { delaySeconds: options.delaySeconds } : undefined,
      )
    },
  }
}
