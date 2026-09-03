export interface ResourceMetadata {
  uid: string
  pid: string | null
  name: string
  description: string | null
  labels: Record<string, string>
  annotations: Record<string, string>
  createdBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ResourcePhase = 'active'

export function resourceMetadata(values: {
  uid: string
  pid: string | null
  name: string
  description?: string | null
  labels?: Record<string, string>
  annotations?: Record<string, string>
  createdBy?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}): ResourceMetadata {
  return {
    uid: values.uid,
    pid: values.pid,
    name: values.name,
    description: values.description ?? null,
    labels: values.labels ?? {},
    annotations: values.annotations ?? {},
    createdBy: values.createdBy ?? null,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt,
    deletedAt: values.deletedAt ?? null,
  }
}

export function resourcePhase(_deletedAt: string | null): ResourcePhase {
  return 'active'
}
