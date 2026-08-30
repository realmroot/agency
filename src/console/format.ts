import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'
import { ENVIRONMENT_PACKAGE_MANAGERS, type EnvironmentPackageFormEntry } from './types'

dayjs.extend(localizedFormat)
dayjs.extend(relativeTime)

export function formatDate(value: string | null) {
  return value ? dayjs(value).format('lll') : 'None'
}

export function formatTime(value: string | null) {
  return value ? dayjs(value).format('HH:mm:ss') : 'None'
}

export function formatRelativeTime(value: string | null) {
  return value ? dayjs(value).fromNow() : 'None'
}

export function formatDuration(start: string | null, end: string | null) {
  if (!start) return 'None'
  const startAt = dayjs(start)
  const endAt = end ? dayjs(end) : dayjs()
  const seconds = Math.max(0, endAt.diff(startAt, 'second'))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatMillis(value: number) {
  const millis = Math.max(0, Math.round(value))
  if (millis < 1000) return `${millis}ms`
  return `${(millis / 1000).toFixed(1)}s`
}

export function parsePackages(value: EnvironmentPackageFormEntry[]) {
  const packages = {
    type: 'packages' as const,
    apt: [] as string[],
    cargo: [] as string[],
    gem: [] as string[],
    go: [] as string[],
    npm: [] as string[],
    pip: [] as string[],
    webi: [] as string[],
  }
  for (const item of value) {
    const name = item.name.trim()
    if (name) packages[item.manager].push(name)
  }
  return packages
}

export function stringifyPackages(value: Partial<Record<(typeof ENVIRONMENT_PACKAGE_MANAGERS)[number], string[]>>) {
  return ENVIRONMENT_PACKAGE_MANAGERS.flatMap((manager) =>
    (value[manager] ?? []).map((name, index) => ({ id: `pkg-${manager}-${index}-${name}`, manager, name })),
  ) satisfies EnvironmentPackageFormEntry[]
}

export function parseVariables(value: string) {
  return Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, description] = line.split('=')
        return [key ?? line, { description: description ?? '', required: false }]
      }),
  )
}

// Spread into an agent create/update body. Empty means the selected runtime
// owns provider/model resolution.
export function providerPatch(provider: string): { provider: string } | Record<string, never> {
  const trimmed = provider.trim()
  return trimmed ? { provider: trimmed } : {}
}

export function parseTools(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function parseJsonObject(value: string, label: string) {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

export function parseJsonObjectArray(value: string, label: string) {
  const parsed = JSON.parse(value || '[]') as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => !item || Array.isArray(item) || typeof item !== 'object')) {
    throw new Error(`${label} must be a JSON array of objects.`)
  }
  return parsed as Record<string, unknown>[]
}

export function formatCostMicros(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 1_000_000)
}

export function matchesSearch(fields: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase()
  return !normalized || fields.some((field) => field?.toLowerCase().includes(normalized))
}

type ArchivableResource = { archivedAt: string | null } | { metadata: { archivedAt: string | null } }

function archivedAt(resource: ArchivableResource) {
  return 'archivedAt' in resource ? resource.archivedAt : resource.metadata.archivedAt
}

export function isArchived(resource: ArchivableResource) {
  return archivedAt(resource) !== null
}

export function archivedLabel(resource: ArchivableResource) {
  return archivedAt(resource) === null ? 'active' : 'archived'
}
