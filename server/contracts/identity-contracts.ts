import { z } from '@hono/zod-openapi'
import { IDENTITY_RUNTIME_PATTERN } from '@server/domain/identity'

export const IdentityRuntimeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(IDENTITY_RUNTIME_PATTERN)
  .openapi('IdentityRuntime', {
    description:
      'Canonical runtime identifier asserted by Realmroot. Binding to an Agent additionally requires a registered Enbor runtime driver.',
    example: 'codex',
  })
