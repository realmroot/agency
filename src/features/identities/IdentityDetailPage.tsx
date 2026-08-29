import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { DetailSection, EmptyState, Meta, MetaGrid, PageHeader, StatusBadge } from '@/console/components'
import { formatDate } from '@/console/format'
import { api } from '@/lib/amarpc'
import { queryKeys } from '@/lib/query-keys'

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
        titleAccessory={identity ? <StatusBadge value={identity.status.state} /> : null}
        description="Safe Realmroot identity metadata. Private state and tokens remain inside the managed Vault."
      />
      {identity ? (
        <DetailSection
          title="Identity configuration"
          description="Runtime and Realmroot identity attributes are immutable after provisioning."
        >
          <MetaGrid columns={4}>
            <Meta label="Username" value={identity.spec.username} />
            <Meta label="Runtime" value={identity.spec.runtime} />
            <Meta label="State" value={identity.status.state} />
            <Meta label="Remote Agent" value={identity.status.descriptor?.agentId ?? 'Pending'} />
            <Meta label="Bound AMA Agent" value={identity.status.boundAgentId ?? 'Unbound'} />
            <Meta label="Updated" value={formatDate(identity.metadata.updatedAt)} />
          </MetaGrid>
        </DetailSection>
      ) : null}
    </div>
  )
}
