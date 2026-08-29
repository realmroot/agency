import { z } from '@hono/zod-openapi'

const ALLOWED_HOST_PATTERN = /^[a-z0-9.-]+$/

export const EnvironmentHostingModeSchema = z.enum(['cloud', 'self_hosted']).openapi('EnvironmentHostingMode')
export const RuntimeSchema = z.enum(['ama', 'claude-code', 'codex', 'copilot']).openapi('RuntimeName')
export const EnvironmentScopeSchema = z.enum(['project', 'organization']).openapi('EnvironmentScope')
export const EnvironmentTypeSchema = z.enum(['cloud', 'self_hosted']).openapi('EnvironmentType')
export const EnvironmentPackageListSchema = z.array(z.string().min(1).max(160)).max(200)
export const EnvironmentWebiPackageListSchema = z
  .array(
    z
      .string()
      .min(3)
      .max(160)
      .regex(
        /^[a-z0-9][a-z0-9._-]*@v?[0-9][a-zA-Z0-9._-]*$/,
        'Webi packages must use a pinned name@version declaration.',
      ),
  )
  .max(200)
export const EnvironmentPackagesSchema = z
  .object({
    type: z.literal('packages'),
    apt: EnvironmentPackageListSchema,
    cargo: EnvironmentPackageListSchema,
    gem: EnvironmentPackageListSchema,
    go: EnvironmentPackageListSchema,
    npm: EnvironmentPackageListSchema,
    pip: EnvironmentPackageListSchema,
    webi: EnvironmentWebiPackageListSchema,
  })
  .strict()
  .openapi('EnvironmentPackages')

export const EnvironmentNetworkPolicySchema = z
  .object({
    mode: z.enum(['offline', 'restricted', 'unrestricted']),
    allowedHosts: z
      .array(
        z
          .string()
          .min(1)
          .max(253)
          .regex(ALLOWED_HOST_PATTERN, 'Allowed hosts must be lowercase hostnames without ports or protocols.'),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.mode === 'restricted' && (!policy.allowedHosts || policy.allowedHosts.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedHosts'],
        message: 'Restricted network policy requires at least one allowed host.',
      })
    }
    if (policy.mode !== 'restricted' && policy.allowedHosts !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedHosts'],
        message: 'Allowed hosts are only valid when network policy is restricted.',
      })
    }
  })
  .openapi('EnvironmentNetworkPolicy')

export const EnvironmentNetworkingSchema = z
  .object({
    type: z.enum(['closed', 'limited', 'open']),
    allowMcpServers: z.boolean(),
    allowPackageManagers: z.boolean(),
    allowedHosts: z
      .array(
        z
          .string()
          .min(1)
          .max(253)
          .regex(ALLOWED_HOST_PATTERN, 'Allowed hosts must be lowercase hostnames without ports or protocols.'),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((networking, ctx) => {
    if (networking.type === 'limited' && (!networking.allowedHosts || networking.allowedHosts.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedHosts'],
        message: 'Limited networking requires at least one allowed host.',
      })
    }
    if (networking.type !== 'limited' && networking.allowedHosts !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedHosts'],
        message: 'Allowed hosts are only valid when networking is limited.',
      })
    }
  })
  .openapi('EnvironmentNetworking')

export type EnvironmentHostingMode = z.infer<typeof EnvironmentHostingModeSchema>
export type RuntimeName = z.infer<typeof RuntimeSchema>
export type EnvironmentNetworkPolicy = z.infer<typeof EnvironmentNetworkPolicySchema>
export type EnvironmentNetworking = z.infer<typeof EnvironmentNetworkingSchema>

export function normalizeEnvironmentNetworkPolicy(value: unknown): EnvironmentNetworkPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { mode: 'unrestricted' }
  }
  const policy = value as Record<string, unknown>
  if (policy.mode === 'offline') {
    return { mode: 'offline' }
  }
  const allowedHosts = Array.isArray(policy.allowedHosts)
    ? policy.allowedHosts.filter((host): host is string => typeof host === 'string' && ALLOWED_HOST_PATTERN.test(host))
    : []
  if (policy.mode === 'restricted' && allowedHosts.length > 0) {
    return { mode: 'restricted', allowedHosts }
  }
  return { mode: 'unrestricted' }
}
