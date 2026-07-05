import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Brain } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ConfirmAction,
  DescriptionCell,
  EmptyState,
  PageHeader,
  ResourceIdentityCell,
  StatusBadge,
  TablePagination,
  TableSurface,
} from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { CreateMemoryStoreSheet } from './MemoryStoreForms'

export function MemoryStoresPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const storesQuery = useQuery({
    queryKey: queryKeys.memoryStores.list(false),
    queryFn: () => api.listMemoryStores(),
  })
  const archiveStore = useMutation({
    mutationFn: (id: string) => api.archiveMemoryStore(id),
    onSuccess: () => {
      toast.success('Memory store archived')
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const stores = storesQuery.data?.data ?? []
  const pagination = useClientPagination(stores)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Memory Stores"
        description="Manage reusable session-mounted memory files."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Brain data-icon="inline-start" />
            Create store
          </Button>
        }
      />
      {stores.length === 0 ? (
        <EmptyState title="No memory stores" body="Create a memory store to attach reusable files to sessions." />
      ) : (
        <TableSurface
          tableId="memory-stores"
          viewportRef={pagination.viewportRef}
          footer={<TablePagination pagination={pagination} />}
        >
          <colgroup>
            <col className="w-[9rem] md:w-[14rem]" />
            <col />
            <col className="w-[6.5rem]" />
            <col className="hidden lg:table-column lg:w-[10rem]" />
            <col className="hidden md:table-column md:w-[10rem]" />
            <col className="w-[4.5rem]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
              <TableHead className="hidden md:table-cell">Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map((store) => (
              <TableRow key={store.metadata.uid}>
                <TableCell className="min-w-0">
                  <ResourceIdentityCell
                    name={store.metadata.name}
                    id={store.metadata.uid}
                    to={`/memory-stores/${store.metadata.uid}`}
                  />
                </TableCell>
                <TableCell className="min-w-0">
                  <DescriptionCell value={store.metadata.description} />
                </TableCell>
                <TableCell>
                  <StatusBadge value={archivedLabel(store)} />
                </TableCell>
                <TableCell className="hidden lg:table-cell">{formatDate(store.metadata.createdAt)}</TableCell>
                <TableCell className="hidden md:table-cell">{formatDate(store.metadata.updatedAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <ConfirmAction
                      title="Archive memory store?"
                      description={`Archive ${store.metadata.name}. Existing sessions keep their snapshots.`}
                      confirmLabel="Archive store"
                      destructive
                      onConfirm={() => archiveStore.mutate(store.metadata.uid)}
                    >
                      <Button type="button" variant="outline" size="icon" aria-label="Archive memory store">
                        <Archive data-icon="inline-start" />
                      </Button>
                    </ConfirmAction>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableSurface>
      )}
      <CreateMemoryStoreSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
