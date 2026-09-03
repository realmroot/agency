import { z } from '@hono/zod-openapi'
import { normalizeGitRepositoryUrl } from '../domain/git-repository'
import { RuntimeSchema } from './environment-contracts'

// Shared execution-spec building blocks that Session and Trigger both use
// ([spec: sessions/create-explicit-inputs]). Volumes are the single mountable resource model:
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
const SecretRefSchema = z.string().min(1).openapi({ example: 'enbor://vaults/0195f5d6-7c20-7000-8000-000000000007' })
const MemoryRefSchema = z.string().min(1).openapi({ example: 'enbor://memories/0195f5d6-7c20-7000-8000-00000000000a' })
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
    url: GitRepositoryUrlSchema.openapi({ example: 'https://github.com/realmroot/enbor.git' }),
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
  })
  .strict()
  .openapi('MemoryVolume')

export const SecretVolumeSchema = z
  .object({
    name: VolumeNameSchema.openapi({ example: 'github-token' }),
    type: z.literal('secret'),
    secretRef: SecretRefSchema.openapi({
      example: 'enbor://vaults/0195f5d6-7c20-7000-8000-000000000007/credentials/0195f5d6-7c20-7000-8000-000000000008',
    }),
    items: z.array(SecretItemSchema).max(50).optional(),
  })
  .strict()
  .openapi('SecretVolume')

export const SecretVolumeProjectionSchema = z
  .object({
    type: z.literal('secret'),
    secretRef: SecretRefSchema.openapi({
      example: 'enbor://vaults/0195f5d6-7c20-7000-8000-000000000007/credentials/0195f5d6-7c20-7000-8000-000000000008',
    }),
    items: z.array(SecretItemSchema).max(50).optional(),
  })
  .strict()
  .openapi('SecretVolumeProjection')

export const EmptyDirVolumeSchema = z
  .object({
    name: VolumeNameSchema.openapi({ example: 'runtime-state' }),
    type: z.literal('empty_dir'),
    seedFrom: z.array(SecretVolumeProjectionSchema).max(50).optional(),
  })
  .strict()
  .openapi('EmptyDirVolume')

export const VolumeSchema = z
  .discriminatedUnion('type', [SecretVolumeSchema, GitRepositoryVolumeSchema, MemoryVolumeSchema, EmptyDirVolumeSchema])
  .openapi('Volume')

export const VolumeMountSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: 'github-token' }),
    mountPath: MountPathSchema.openapi({ example: '/workspace/.enbor/secrets/project' }),
    readOnly: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .openapi('VolumeMount')

export const EnvFromEntrySchema = z
  .object({
    type: z.literal('secret').openapi({ example: 'secret' }),
    name: z.string().min(1).max(120).optional().openapi({ example: 'API_TOKEN' }),
    secretRef: SecretRefSchema.openapi({
      example: 'enbor://vaults/0195f5d6-7c20-7000-8000-000000000007/credentials/0195f5d6-7c20-7000-8000-000000000008',
    }),
    key: z.string().min(1).max(253).optional().openapi({ example: 'token' }),
  })
  .strict()
  .openapi('EnvFromEntry')

export const ExecutionEnvSchema = z
  .record(z.string().min(1).max(120), z.string().max(16_000))
  .openapi('ExecutionEnv', { example: { SERVICE_API_URL: 'https://service.example.com' } })

export const ExecutionSpecSchema = z
  .object({
    agentId: z.string().min(1).openapi({ example: '0195f5d6-7c20-7000-8000-000000000002' }),
    environmentId: z.string().min(1).nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000005' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    env: ExecutionEnvSchema,
    envFrom: z.array(EnvFromEntrySchema).max(50),
    volumes: z.array(VolumeSchema).max(50),
    volumeMounts: z.array(VolumeMountSchema).max(50),
  })
  .strict()
  .openapi('ExecutionSpec')

export const ExecutionSpecInputSchema = ExecutionSpecSchema.extend({
  environmentId: z.string().min(1).nullable().optional().openapi({ example: '0195f5d6-7c20-7000-8000-000000000005' }),
  env: ExecutionEnvSchema.optional(),
  envFrom: z.array(EnvFromEntrySchema).max(50).optional(),
  volumes: z.array(VolumeSchema).max(50).optional(),
  volumeMounts: z.array(VolumeMountSchema).max(50).optional(),
  runtime: RuntimeSchema.optional().openapi({ example: 'codex' }),
})
  .strict()
  .openapi('ExecutionSpecInput')

export type Volume = z.infer<typeof VolumeSchema>
export type VolumeMount = z.infer<typeof VolumeMountSchema>
