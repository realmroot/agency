import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { CreateIdentitySheet } from './CreateIdentitySheet'
import { IdentitiesView } from './IdentitiesView'

export function IdentitiesPage() {
  const [creating, setCreating] = useState(false)
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: queryKeys.identities.list(false), queryFn: () => api.listIdentities() })
  const pagination = useClientPagination(query.data?.data ?? [])
  const archive = useMutation({
    mutationFn: api.archiveIdentity,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.identities.all }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Identities"
        description="Create and assign stable identities to agents."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <BadgeCheck data-icon="inline-start" />
            Create identity
          </Button>
        }
      />
      <IdentitiesView identities={pagination.items} pagination={pagination} onArchive={(id) => archive.mutate(id)} />
      <CreateIdentitySheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
