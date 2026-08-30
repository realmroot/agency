import { z } from '@hono/zod-openapi'
import type { ResourceMetadata } from '@server/domain/resource'

export const ResourcePhaseSchema = z.enum(['active', 'archived']).openapi('ResourcePhase')

export const ResourceMetadataSchema = z
  .object({
    uid: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000017' }),
    projectId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000001' }),
    name: z.string().openapi({ example: 'Default resource' }),
    description: z.string().nullable().openapi({ example: 'Default project resource.' }),
    labels: z.record(z.string(), z.string()),
    annotations: z.record(z.string(), z.string()),
    createdBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .openapi('ResourceMetadata')

export const ResourceCreateMetadataSchema = z
  .object({
    name: z.string().min(1).max(160).openapi({ example: 'Default resource' }),
    description: z.string().max(1000).nullable().optional().openapi({ example: 'Default project resource.' }),
  })
  .strict()
  .openapi('ResourceCreateMetadata')

export const ResourceUpdateMetadataSchema = z
  .object({
    name: z.string().min(1).max(160).optional().openapi({ example: 'Default resource' }),
    description: z.string().max(1000).nullable().optional().openapi({ example: 'Default project resource.' }),
  })
  .strict()
  .openapi('ResourceUpdateMetadata')

export function serializeResourceMetadata(metadata: ResourceMetadata): z.infer<typeof ResourceMetadataSchema> {
  return {
    uid: metadata.uid,
    projectId: metadata.pid,
    name: metadata.name,
    description: metadata.description,
    labels: metadata.labels,
    annotations: metadata.annotations,
    createdBy: metadata.createdBy,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    archivedAt: metadata.archivedAt,
  }
}

export function serializeResource<T extends { metadata: ResourceMetadata }>(
  resource: T,
): Omit<T, 'metadata'> & {
  metadata: z.infer<typeof ResourceMetadataSchema>
} {
  return { ...resource, metadata: serializeResourceMetadata(resource.metadata) }
}
