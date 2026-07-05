import { z } from '@hono/zod-openapi'
import { normalizeGitRepositoryUrl } from '../domain/git-repository'
import { MEMORY_STORE_ACCESS } from '../domain/memory-store'
import { RuntimeSchema } from './environment-contracts'

// Shared execution-spec building blocks that Session and Trigger both use
// (docs/api-v1-design.md §1.7). Volumes are the single mountable resource model:
// repository, memory, and secret inputs all declare a volume and are
// attached with volumeMounts.

const GitRepositoryUrlSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => normalizeGitRepositoryUrl(value) !== null, 'Use a safe HTTPS Git repository URL.')
const GitRefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\s\p{C}]/u.test(value) &&
      !value.includes('..') &&
      !value.includes('@{') &&
      !value.includes('\\') &&
      !value.startsWith('-') &&
      !value.endsWith('/') &&
      !value.endsWith('.lock'),
    'Use a safe branch, tag, or commit ref.',
  )
const MountPathSchema = z.string().min(1).max(200)
const SecretRefSchema = z.string().min(1).openapi({ example: 'ama://vaults/vault_abc123' })
const MemoryRefSchema = z.string().min(1).openapi({ example: 'ama://memories/memstore_abc123' })
const VolumeNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use a safe volume name.')
const SecretItemSchema = z
  .object({
    key: z.string().min(1).max(253).openapi({ example: 'GH_TOKEN' }),
    path: z
      .string()
      .min(1)
      .max(253)
      .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), 'Use a safe relative item path.')
      .openapi({ example: 'password' }),
  })
  .strict()
  .openapi('SecretItem')

export const GitRepositoryVolumeSchema = z
  .object({
    name: VolumeNameSchema.openapi({ example: 'source' }),
    type: z.literal('git_repository'),
    url: GitRepositoryUrlSchema.openapi({ example: 'https://github.com/saltbo/any-managed-agents.git' }),
    ref: GitRefSchema.optional(),
    secretRef: SecretRefSchema.optional(),
    items: z.array(SecretItemSchema).max(50).optional(),
  })
  .strict()
  .openapi('GitRepositoryVolume')

export const MemoryVolumeSchema = z
  .object({
    name: VolumeNameSchema.openapi({ example: 'team-memory' }),
    type: z.literal('memory'),
    memoryRef: MemoryRefSchema,
    access: z.enum(MEMORY_STORE_ACCESS).openapi({ example: 'read_only' }),
    storeName: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
  .openapi('MemoryVolume')

export const SecretVolumeSchema = z
  .object({
    name: VolumeNameSchema.openapi({ example: 'github-token' }),
    type: z.literal('secret'),
    secretRef: SecretRefSchema.openapi({
      example: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123',
    }),
    items: z.array(SecretItemSchema).max(50).optional(),
  })
  .strict()
  .openapi('SecretVolume')

export const VolumeSchema = z
  .discriminatedUnion('type', [SecretVolumeSchema, GitRepositoryVolumeSchema, MemoryVolumeSchema])
  .openapi('Volume')

export const VolumeMountSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: 'github-token' }),
    mountPath: MountPathSchema.openapi({ example: '/workspace/.ama/secrets/project' }),
    readOnly: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .openapi('VolumeMount')

export const EnvFromEntrySchema = z
  .object({
    type: z.literal('secret').openapi({ example: 'secret' }),
    name: z.string().min(1).max(120).optional().openapi({ example: 'API_TOKEN' }),
    secretRef: SecretRefSchema.openapi({
      example: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123',
    }),
    key: z.string().min(1).max(253).optional().openapi({ example: 'token' }),
  })
  .strict()
  .openapi('EnvFromEntry')

export const ExecutionEnvSchema = z
  .record(z.string().min(1).max(120), z.string().max(16_000))
  .openapi('ExecutionEnv', { example: { AK_API_URL: 'https://ak.example.com' } })

export const ExecutionSpecSchema = z
  .object({
    agentId: z.string().min(1).openapi({ example: 'agent_abc123' }),
    environmentId: z.string().min(1).nullable().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    env: ExecutionEnvSchema,
    envFrom: z.array(EnvFromEntrySchema).max(50),
    volumes: z.array(VolumeSchema).max(50),
    volumeMounts: z.array(VolumeMountSchema).max(50),
  })
  .strict()
  .openapi('ExecutionSpec')

export const ExecutionSpecInputSchema = ExecutionSpecSchema.extend({
  environmentId: z.string().min(1).nullable().optional().openapi({ example: 'env_abc123' }),
  env: ExecutionEnvSchema.optional(),
  envFrom: z.array(EnvFromEntrySchema).max(50).optional(),
  volumes: z.array(VolumeSchema).max(50).optional(),
  volumeMounts: z.array(VolumeMountSchema).max(50).optional(),
})
  .strict()
  .openapi('ExecutionSpecInput')

export type Volume = z.infer<typeof VolumeSchema>
export type VolumeMount = z.infer<typeof VolumeMountSchema>
