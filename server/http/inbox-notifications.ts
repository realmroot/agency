import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { logError } from '@server/logging'
import { type DepsEnv, ErrorResponseSchema } from '@server/openapi'
import {
  dispatchInboxActivation,
  InboxNotificationError,
  receiveInboxNotification,
} from '@server/usecases/inbox-activations'

type InboxNotificationRoutes = OpenAPIHono<DepsEnv>

const InboxNotificationSchema = z
  .object({
    eventId: z.string().trim().min(1).max(512),
    type: z.literal('message.created'),
    subscriptionId: z.string().regex(/^sub_[0-9a-f]{32}$/),
    agentId: z
      .string()
      .uuid()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    messageId: z.string().trim().min(1).max(512),
    routingKey: z.string().min(1).max(512).optional(),
    occurredAt: z.string().datetime(),
  })
  .strict()
  .openapi('InboxNotification')

const InboxNotificationReceiptSchema = z
  .object({
    eventId: z.string(),
    subscriptionId: z.string(),
    triggerRunId: z.string(),
    state: z.literal('accepted'),
  })
  .openapi('InboxNotificationReceipt')

const createInboxNotificationDefinition = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createInboxNotification',
  tags: ['Triggers'],
  summary: 'Reliably receive an Inbox notification',
  description:
    'Authenticates the per-Subscription callback token, persistently deduplicates by (subscriptionId, eventId), and accepts the Trigger Run before asynchronous Session delivery.',
  security: [{ inboxCallbackBearer: [] }],
  request: {
    body: { required: true, content: { 'application/json': { schema: InboxNotificationSchema } } },
  },
  responses: {
    202: {
      description: 'Notification durably accepted or previously accepted',
      content: { 'application/json': { schema: InboxNotificationReceiptSchema } },
    },
    400: { description: 'Invalid notification', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Invalid callback token', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: {
      description: 'Notification does not match the Subscription',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

function errorBody(type: string, message: string) {
  return { error: { type, message } } as const
}

export function registerInboxNotificationRoutes(routes: InboxNotificationRoutes) {
  return routes.openapi(createInboxNotificationDefinition, async (c) => {
    try {
      const body = c.req.valid('json')
      const accepted = await receiveInboxNotification(c.get('deps'), c.req.header('authorization'), {
        eventId: body.eventId,
        type: body.type,
        subscriptionId: body.subscriptionId,
        agentId: body.agentId,
        messageId: body.messageId,
        occurredAt: body.occurredAt,
        ...(body.routingKey !== undefined ? { routingKey: body.routingKey } : {}),
      })
      if (accepted.replayed) c.header('idempotency-replayed', 'true')
      c.executionCtx.waitUntil(
        dispatchInboxActivation(c.get('deps'), accepted.runId).catch((error) =>
          logError('inbox-notification.dispatch.failed', error, {
            triggerRunId: accepted.runId,
            subscriptionId: body.subscriptionId,
          }),
        ),
      )
      return c.json(
        {
          eventId: body.eventId,
          subscriptionId: body.subscriptionId,
          triggerRunId: accepted.runId,
          state: 'accepted' as const,
        },
        202,
      )
    } catch (error) {
      if (error instanceof InboxNotificationError) {
        if (error.status === 401) c.header('WWW-Authenticate', 'Bearer realm="inbox-callback"')
        return c.json(errorBody(error.code, error.message), error.status)
      }
      throw error
    }
  })
}
