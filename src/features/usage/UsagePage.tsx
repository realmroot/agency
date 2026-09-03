import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { useUrlFilter } from '@/console/use-list-filters'
import { api, type UsageSummaryOptions } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { UsageView } from './UsageView'

const DEFAULT_GROUP_BY = 'provider'
const GROUP_PRESETS = [
  { value: 'provider', label: 'Provider' },
  { value: 'model', label: 'Model' },
  { value: 'agent', label: 'Agent' },
]

export function UsagePage() {
  const [groupBy, setGroupBy] = useUrlFilter('groupBy', DEFAULT_GROUP_BY)
  const [createdFrom, setCreatedFrom] = useUrlFilter('createdFrom')
  const [createdTo, setCreatedTo] = useUrlFilter('createdTo')
  const filters = useMemo<UsageSummaryOptions>(
    () => ({
      groupBy,
      ...(createdFrom ? { from: new Date(createdFrom).toISOString() } : {}),
      ...(createdTo ? { to: new Date(createdTo).toISOString() } : {}),
    }),
    [groupBy, createdFrom, createdTo],
  )
  const usageQuery = useQuery({
    queryKey: queryKeys.usage.summary(filters),
    queryFn: () => api.readUsageSummary(filters),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Usage"
        description="Track provider usage, token totals, duration, and cost attribution for the current project."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Group usage by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {GROUP_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          type="datetime-local"
          aria-label="Usage from"
          value={createdFrom}
          onChange={(event) => setCreatedFrom(event.target.value)}
          className="w-full sm:w-56"
        />
        <Input
          type="datetime-local"
          aria-label="Usage to"
          value={createdTo}
          onChange={(event) => setCreatedTo(event.target.value)}
          className="w-full sm:w-56"
        />
      </div>
      <UsageView summary={usageQuery.data ?? null} />
    </div>
  )
}
