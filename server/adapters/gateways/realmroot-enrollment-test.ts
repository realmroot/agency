import type { RealmrootEnrollmentGateway } from '@server/usecases/ports'
import type { RuntimeName } from '@shared/runtime-types'

type EnrollmentInput = Pick<
  Parameters<RealmrootEnrollmentGateway['initialize']>[0],
  'origin' | 'nickname' | 'runtime' | 'idempotencyKey'
>

function state(input: EnrollmentInput, identity?: Record<string, unknown>) {
  return {
    version: 18,
    origin: input.origin,
    issuer: `${input.origin}/api/auth`,
    runtime: input.runtime,
    name: input.nickname,
    agent_id: `protocol-${input.idempotencyKey}`,
    host_id: 'ama-e2e-host',
    agent_key_id: 'ama-e2e-agent-key',
    agent_private_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    enrollment_idempotency_key: input.idempotencyKey,
    ...(identity ? { identity } : {}),
  }
}

export function createTestRealmrootEnrollmentGateway(): RealmrootEnrollmentGateway {
  return {
    async initialize(input) {
      return {
        stage: 'initialized',
        state: state(input),
      }
    },
    async prepare(input) {
      if (input.checkpoint?.stage === 'enrolled') return input.checkpoint
      const runtime = input.checkpoint?.state.runtime as RuntimeName
      const identity = {
        id: `identity-${input.username}`,
        issuer: `${input.origin}/api/auth`,
        subject: `agt_${input.username.replaceAll(/[^a-z0-9]/g, '_')}`,
        username: input.username,
        name: input.nickname,
        runtime,
      }
      const enrolled = { stage: 'enrolled' as const, state: state({ ...input, runtime }, identity), identity }
      await input.onCheckpoint(enrolled)
      return enrolled
    },
    async complete(input) {
      const runtime = input.checkpoint.state.runtime as RuntimeName
      if (input.checkpoint.stage === 'enrolled' && input.checkpoint.identity) {
        return { identity: input.checkpoint.identity, state: input.checkpoint.state }
      }
      const identity = {
        id: `identity-${input.username}`,
        issuer: `${input.origin}/api/auth`,
        subject: `agt_${input.username.replaceAll(/[^a-z0-9]/g, '_')}`,
        username: input.username,
        name: input.nickname,
        runtime,
      }
      const enrolled = state({ ...input, runtime }, identity)
      await input.onCheckpoint({
        stage: 'enrolled',
        state: enrolled,
        identity,
      })
      return { identity, state: enrolled }
    },
  }
}
