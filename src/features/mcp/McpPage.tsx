import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState, PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api, type ConnectorListOptions } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { McpView } from './McpView'

const FILTER_KEYS = ['search', 'category', 'trustLevel', 'capability'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

export function McpPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters: ConnectorListOptions = {}
  for (const key of FILTER_KEYS) {
    const value = searchParams.get(key)
    if (value) {
      filters[key] = value
    }
  }
  const connectorsQuery = useQuery({
    queryKey: queryKeys.connectors.list(filters as Record<string, string>),
    queryFn: () => api.listConnectors(filters),
  })
  // Unfiltered catalog backs the filter options so narrowing one facet does not
  // erase the remaining choices.
  const facetsQuery = useQuery({
    queryKey: queryKeys.connectors.list(),
    queryFn: () => api.listConnectors(),
  })
  const connectors = useClientPagination(connectorsQuery.data?.data ?? [])
  const facetConnectors = facetsQuery.data?.data ?? []
  const categories = [...new Set(facetConnectors.map((connector) => connector.category))].sort()
  const trustLevels = [...new Set(facetConnectors.map((connector) => connector.trustLevel))].sort()
  const capabilities = [...new Set(facetConnectors.flatMap((connector) => connector.capabilities))].sort()

  const setFilter = (key: FilterKey, value: string) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) {
          next.set(key, value)
        } else {
          next.delete(key)
        }
        return next
      },
      { replace: true },
    )
  }

  const error = connectorsQuery.error
  if (error) {
    return <EmptyState title="MCP unavailable" body={errorMessage(error)} />
  }
  if (connectorsQuery.isPending) {
    return <EmptyState title="Loading MCP" body="Reading connector catalog." />
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="MCP"
        description="Browse the platform MCP server catalog. Agents reference these connector ids directly."
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          type="search"
          aria-label="Search connectors"
          placeholder="Search connectors"
          className="w-full sm:w-56"
          value={filters.search ?? ''}
          onChange={(event) => setFilter('search', event.target.value)}
        />
        <FacetSelect
          label="Category"
          allLabel="All categories"
          value={filters.category ?? ''}
          options={categories}
          onChange={(value) => setFilter('category', value)}
        />
        <FacetSelect
          label="Trust level"
          allLabel="All trust levels"
          value={filters.trustLevel ?? ''}
          options={trustLevels}
          onChange={(value) => setFilter('trustLevel', value)}
        />
        <FacetSelect
          label="Capability"
          allLabel="All capabilities"
          value={filters.capability ?? ''}
          options={capabilities}
          onChange={(value) => setFilter('capability', value)}
        />
      </div>
      <McpView connectors={connectors.items} connectorPagination={connectors} />
    </div>
  )
}

const FACET_ALL = 'all'

function FacetSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value || FACET_ALL} onValueChange={(next) => onChange(next === FACET_ALL ? '' : next)}>
      <SelectTrigger aria-label={label} className="w-full sm:w-44">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={FACET_ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
