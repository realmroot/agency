import { createDeps } from './composition'
import type { Env } from './env'
import { dispatchDueScheduledTriggers as runDispatch, type ScheduleDispatchResult } from './usecases/dispatch-triggers'

export type { ScheduleDispatchResult }

// Background trigger dispatcher entry (cron scheduled + e2e fixture). Builds the
// composition root and hands off to the dispatch-triggers usecase. The
// ExecutionContext is unused by the orchestration but kept in the signature so
// the worker scheduled handler can pass it through.
export function dispatchDueScheduledTriggers(
  env: Env,
  _ctx: { waitUntil(promise: Promise<unknown>): void },
  options: { heartbeatAt?: string; projectId?: string; limit?: number } = {},
): Promise<ScheduleDispatchResult> {
  return runDispatch(createDeps(env), options)
}
