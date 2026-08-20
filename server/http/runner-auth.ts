import type { AuthContext } from '@server/auth/session'
import { isRunnerOidcAuth } from '@server/auth/session'
import type { RunnerOidcContext } from '@server/domain/runner-queue'
import type { Env } from '@server/env'
import { errorResponse } from '@server/errors'
import type { RunnerAuthRecord } from '@server/usecases/ports'
import type { Context } from 'hono'

// Runner-token authorization is auth-context based, so it lives in the http
// layer alongside requireAuth. A console (non-runner) identity may operate any
// runner in its project; a Realmroot runner token may only operate the
// Realmroot runner row its claims are bound to.
export function runnerOperationAuthorized(env: Env, auth: AuthContext, runner: RunnerAuthRecord): boolean {
  if (runner.authMode !== 'realmroot') return false
  if (!isRunnerOidcAuth(env, auth)) return true
  return runnerRuntimeAuthorized(env, auth, runner)
}

export function runnerRuntimeAuthorized(env: Env, auth: AuthContext, runner: RunnerAuthRecord): boolean {
  return (
    isRunnerOidcAuth(env, auth) &&
    runner.authMode === 'realmroot' &&
    runner.oidcSubject === auth.oidc.subject &&
    !!runner.oidcClientId &&
    runner.oidcClientId === auth.oidc.clientId
  )
}

export function runnerForbidden(c: Context) {
  return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this runner')
}

// Projects the request auth context's OIDC claims into the binding descriptor
// the runner-registration usecase reasons over.
export function runnerOidcContext(env: Env, auth: AuthContext): RunnerOidcContext {
  return {
    isRunnerToken: isRunnerOidcAuth(env, auth),
    subject: auth.oidc.subject,
    clientId: auth.oidc.clientId,
  }
}
