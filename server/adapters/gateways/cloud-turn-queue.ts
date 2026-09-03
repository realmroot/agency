import type { CloudTurnQueue, CloudTurnQueueMessage } from '@server/usecases/ports'
import type { Env } from '../../env'

// Wraps the CLOUD_TURNS queue binding behind the CloudTurnQueue port. The
// consumer invocation owns the wall-clock budget for cloud session work that
// outlives an HTTP request. Test mode (and local setups without the queue
// binding) run turns inline so existing synchronous semantics keep working.
export function createCloudTurnQueue(env: Env): CloudTurnQueue {
  return {
    runsInline(): boolean {
      return env.RUNTIME_MODE === 'test' || !env.CLOUD_TURNS
    },

    async enqueue(message: CloudTurnQueueMessage, opts?: { delaySeconds?: number }): Promise<void> {
      if (!env.CLOUD_TURNS) {
        throw new Error('CLOUD_TURNS queue binding is not configured')
      }
      await env.CLOUD_TURNS.send(
        message,
        opts?.delaySeconds !== undefined ? { delaySeconds: opts.delaySeconds } : undefined,
      )
    },
  }
}
