import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { useUrlFilter } from '@/console/use-list-filters'
import { type AuditRecordListOptions, api } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { AuditView } from './AuditView'

const OUTCOMES = ['success', 'failure', 'denied']

export function AuditPage() {
  const [action, setAction] = useUrlFilter('action')
  const [resourceType, setResourceType] = useUrlFilter('resourceType')
  const [outcome, setOutcome] = useUrlFilter('outcome', 'all')
  const [actorId, setActorId] = useUrlFilter('actorId')
  const [createdFrom, setCreatedFrom] = useUrlFilter('createdFrom')
  const [createdTo, setCreatedTo] = useUrlFilter('createdTo')
  const [projectId] = useUrlFilter('projectId')
  const filters = useMemo<AuditRecordListOptions>(
    () => ({
      ...(action ? { action } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(outcome !== 'all' ? { outcome } : {}),
      ...(actorId ? { actorId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(createdFrom ? { from: new Date(createdFrom).toISOString() } : {}),
      ...(createdTo ? { to: new Date(createdTo).toISOString() } : {}),
    }),
    [action, resourceType, outcome, actorId, projectId, createdFrom, createdTo],
  )
  const auditQuery = useQuery({
    queryKey: queryKeys.audit.records(filters),
    queryFn: () => api.listAuditRecords(filters),
  })
  const records = auditQuery.data?.data ?? []
  const pagination = useClientPagination(records)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit" description="Review security-relevant control-plane activity and policy decisions." />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Filter by action"
          aria-label="Filter by action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="w-full sm:w-48"
        />
        <Input
          type="search"
          placeholder="Filter by resource type"
          aria-label="Filter by resource type"
          value={resourceType}
          onChange={(event) => setResourceType(event.target.value)}
          className="w-full sm:w-48"
        />
        <Input
          type="search"
          placeholder="Filter by actor"
          aria-label="Filter by actor"
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
          className="w-full sm:w-48"
        />
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All outcomes</SelectItem>
              {OUTCOMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          type="datetime-local"
          aria-label="Audit from"
          value={createdFrom}
          onChange={(event) => setCreatedFrom(event.target.value)}
          className="w-full sm:w-56"
        />
        <Input
          type="datetime-local"
          aria-label="Audit to"
          value={createdTo}
          onChange={(event) => setCreatedTo(event.target.value)}
          className="w-full sm:w-56"
        />
      </div>
      <AuditView records={pagination.items} pagination={pagination} />
    </div>
  )
}
