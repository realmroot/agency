import { createApp } from './app'
import { createDeps } from './composition'
import type { Env } from './env'
import { type LogContext, logError } from './logging'
import { dispatchDueScheduledTriggers } from './scheduled-dispatch'
import {
  consumeSerialHttpTriggerWake,
  recoverSerialHttpTriggers,
  wakeSerialHttpTriggerForSettledSession,
} from './usecases/dispatch-triggers'
import { recoverInboxActivations } from './usecases/inbox-activations'
import { reconcileInboxSubscriptions } from './usecases/inbox-subscriptions'
import type { CloudTurnQueueMessage, TriggerDispatchQueueMessage } from './usecases/ports'
import { refreshPlatformCatalog } from './usecases/providers'
import { consumeCloudTurnQueueMessage, markCloudTurnDeadLettered, markStalledCloudSessions } from './usecases/runtime'

export { Sandbox } from '@cloudflare/sandbox'
export { RunnerPoolObject } from './worker/runner-pool-object'
export { SessionObject } from './worker/session-object'

const app = createApp()

function waitUntilLogged(ctx: ExecutionContext, event: string, promise: Promise<unknown>, context = {}) {
  ctx.waitUntil(promise.catch((error) => logError(event, error, context)))
}

function queueMessageContext(message: unknown): LogContext {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { cloudTurnType: 'unknown' }
  }
  const record = message as Partial<CloudTurnQueueMessage>
  return {
    cloudTurnType: record.type ?? 'unknown',
    sessionId: record.sessionId,
    organizationId: record.organizationId,
    projectId: record.projectId,
    requestId: record.requestId,
  }
}

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    const scheduledAt = new Date(event.scheduledTime).toISOString()
    waitUntilLogged(
      ctx,
      'scheduled.triggers.failed',
      dispatchDueScheduledTriggers(env, ctx, { heartbeatAt: scheduledAt }),
      {
        scheduledAt,
      },
    )
    waitUntilLogged(ctx, 'scheduled.stalled-sessions.failed', markStalledCloudSessions(createDeps(env)), {
      scheduledAt,
    })
    waitUntilLogged(ctx, 'scheduled.serial-http-triggers.failed', recoverSerialHttpTriggers(createDeps(env)), {
      scheduledAt,
    })
    waitUntilLogged(ctx, 'scheduled.inbox-subscriptions.failed', reconcileInboxSubscriptions(createDeps(env)), {
      scheduledAt,
    })
    waitUntilLogged(ctx, 'scheduled.inbox-activations.failed', recoverInboxActivations(createDeps(env)), {
      scheduledAt,
    })
    // The model catalog changes slowly; refresh once an hour (the cron fires
    // every minute, so gate on minute 0) rather than every tick.
    if (new Date(event.scheduledTime).getUTCMinutes() === 0) {
      waitUntilLogged(ctx, 'scheduled.provider-catalog-refresh.failed', refreshPlatformCatalog(createDeps(env)), {
        scheduledAt,
      })
    }
  },
  async queue(batch, env, ctx) {
    // Messages that exhausted their retries arrive on the dead-letter queue; mark
    // the stranded session errored instead of re-running the turn.
    const deadLetter = batch.queue.endsWith('-dlq')
    const deps = createDeps(env)
    for (const message of batch.messages) {
      const body = message.body as CloudTurnQueueMessage | TriggerDispatchQueueMessage
      try {
        if (body.type === 'trigger.dispatch') {
          await consumeSerialHttpTriggerWake(deps, body)
          message.ack()
          continue
        }
        const cloudTurn = body as CloudTurnQueueMessage
        if (deadLetter) {
          await markCloudTurnDeadLettered(deps, cloudTurn)
        } else {
          await consumeCloudTurnQueueMessage(deps, cloudTurn)
        }
        message.ack()
        waitUntilLogged(
          ctx,
          'cloud-turn.serial-http-trigger-wake.failed',
          wakeSerialHttpTriggerForSettledSession(deps, cloudTurn.projectId, cloudTurn.sessionId),
          queueMessageContext(cloudTurn),
        )
      } catch (error) {
        logError(`cloud-turn.${deadLetter ? 'dead-letter' : 'consumer'}.failed`, error, {
          queue: batch.queue,
          messageId: message.id,
          deadLetter,
          ...queueMessageContext(body),
        })
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env>
