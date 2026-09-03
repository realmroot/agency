import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { DetailSection, EmptyState, Meta, MetaGrid, PageHeader, StatusBadge } from '@/console/components'
import { formatDate } from '@/console/format'
import { api } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { identityAssignmentLabel, identityStatusLabel } from './identity-display'

export function IdentityDetailPage() {
  const { identityId } = useParams()
  const query = useQuery({
    queryKey: queryKeys.identities.detail(identityId ?? ''),
    queryFn: () => api.readIdentity(identityId as string),
    enabled: Boolean(identityId),
  })
  const identity = query.data
  if (!identity && !query.isLoading)
    return <EmptyState title="Identity not found" body="The requested Identity is not in the current project." />
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Identity"
        title={identity?.metadata.name ?? 'Identity detail'}
        titleAccessory={
          identity ? <StatusBadge value={identity.status.state} label={identityStatusLabel(identity)} /> : null
        }
        description="Identity details are safe to view. Credentials remain protected."
      />
      {identity ? (
        <DetailSection
          title="Identity configuration"
          description="The username and runtime cannot be changed after creation."
        >
          <MetaGrid columns={4}>
            <Meta label="Username" value={identity.spec.username} />
            <Meta label="Runtime" value={identity.spec.runtime} />
            <Meta label="Status" value={identityStatusLabel(identity)} />
            <Meta label="Assigned agent" value={identityAssignmentLabel(identity)} />
            <Meta label="Updated" value={formatDate(identity.metadata.updatedAt)} />
          </MetaGrid>
        </DetailSection>
      ) : null}
    </div>
  )
}
