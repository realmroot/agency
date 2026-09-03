import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { DetailSection, EmptyState, Meta, MetaGrid, PageHeader, StatusBadge } from '@/console/components'
import { formatDate, stringifyJson } from '@/console/format'
import { JsonBlock } from '@/features/console/json-block'
import type { AuditRecord } from '@/lib/enborrpc'
import { api } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'

const RESOURCE_ROUTES: Record<string, string> = {
  agent: '/agents',
  environment: '/environments',
  session: '/sessions',
  provider: '/settings/providers',
  vault: '/vaults',
}

function resourcePath(record: AuditRecord) {
  const base = RESOURCE_ROUTES[record.resourceType]
  return base && record.resourceId ? `${base}/${record.resourceId}` : null
}

export function AuditRecordPage() {
  const { recordId } = useParams()
  const recordQuery = useQuery({
    queryKey: queryKeys.audit.record(recordId as string),
    queryFn: () => api.readAuditRecord(recordId as string),
    enabled: Boolean(recordId),
  })
  if (recordQuery.error) {
    return (
      <EmptyState
        title="Audit record unavailable"
        body={recordQuery.error instanceof Error ? recordQuery.error.message : String(recordQuery.error)}
        action={
          <Link to="/audit" className={buttonVariants({ variant: 'outline' })}>
            Back to audit log
          </Link>
        }
      />
    )
  }
  if (recordQuery.isPending) {
    return <EmptyState title="Loading audit record" body="Reading the audit record for this organization." />
  }
  const record = recordQuery.data
  const link = resourcePath(record)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Audit record"
        title={record.action}
        titleAccessory={<StatusBadge value={record.outcome} />}
        description="Actor, request correlation, and change detail for one audit record."
        actions={
          <Link to="/audit" className={buttonVariants({ variant: 'outline' })}>
            Back to audit log
          </Link>
        }
      />
      <DetailSection title="Record" description="Who acted, on what, and how the request correlates.">
        <MetaGrid>
          <Meta label="Record id" value={record.id} />
          <Meta label="Actor" value={record.actorUserId ?? record.actorType} />
          <Meta label="Actor type" value={record.actorType} />
          <Meta label="Controller" value={record.controllerUserId ?? 'None'} />
          <Meta label="Created" value={formatDate(record.createdAt)} />
          <Meta label="Request id" value={record.requestId ?? 'None'} />
          <Meta label="Correlation id" value={record.correlationId ?? 'None'} />
          <Meta label="Session" value={record.sessionId ?? 'None'} />
          <Meta label="Policy category" value={record.policyCategory ?? 'None'} />
          <Meta label="Project" value={record.projectId ?? 'None'} />
        </MetaGrid>
      </DetailSection>
      <DetailSection
        title="Resource"
        description="The control-plane resource this record describes."
        actions={
          link ? (
            <Link to={link} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Open {record.resourceType}
            </Link>
          ) : undefined
        }
      >
        <MetaGrid>
          <Meta label="Resource type" value={record.resourceType} />
          <Meta label="Resource id" value={record.resourceId ?? 'None'} />
        </MetaGrid>
      </DetailSection>
      <DetailSection title="Change" description="Before and after snapshots recorded for this event.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Before</h3>
            <JsonBlock value={stringifyJson(record.before)} />
          </div>
          <div className="min-w-0">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">After</h3>
            <JsonBlock value={stringifyJson(record.after)} />
          </div>
        </div>
      </DetailSection>
      <DetailSection title="Metadata" description="Request metadata recorded with this event.">
        <JsonBlock value={stringifyJson(record.metadata)} />
      </DetailSection>
    </div>
  )
}
