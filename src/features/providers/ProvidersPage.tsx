import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DescriptionCell,
  EmptyState,
  PageHeader,
  ResourceIdentityCell,
  StatusBadge,
  TablePagination,
  TableSurface,
} from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

// Read-only view of the platform's GLOBAL model catalog: the vendors and models
// discovered from Workers AI + models.dev that agents can pin. There is no
// per-tenant provider config anymore — the catalog is refreshed by discovery.
export function ProvidersPage() {
  const queryClient = useQueryClient()
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.models,
    queryFn: () => api.listModels(),
  })
  const models = modelsQuery.data?.data ?? []
  const pagination = useClientPagination(models)
  const refresh = useMutation({
    mutationFn: () => api.refreshCatalog(),
    onSuccess: (result) => {
      if (result.outcome === 'failed') {
        toast.error(`Catalog refresh failed${result.category ? ` (${result.category})` : ''}`)
        return
      }
      toast.success(`Catalog refreshed — ${result.discoveredCount} models across ${result.vendors} vendors`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Providers"
        title="Model catalog"
        description="The platform's global model vendors and models, discovered from Workers AI and models.dev. Pin one on an agent to run it."
        actions={
          <Button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw data-icon="inline-start" />
            Refresh catalog
          </Button>
        }
      />
      {modelsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : models.length === 0 ? (
        <EmptyState
          title="No models yet"
          body="The catalog is empty. Refresh to discover models from Workers AI and models.dev."
        />
      ) : (
        <TableSurface
          tableId="provider-catalog"
          viewportRef={pagination.viewportRef}
          footer={<TablePagination pagination={pagination} />}
        >
          <colgroup>
            <col className="w-[8rem] md:w-[16rem]" />
            <col />
            <col className="hidden md:table-column md:w-[10rem]" />
            <col className="hidden md:table-column md:w-[6.5rem]" />
            <col className="w-[7rem]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="hidden md:table-cell">Vendor</TableHead>
              <TableHead className="hidden md:table-cell">Context</TableHead>
              <TableHead>Availability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="min-w-0">
                  <ResourceIdentityCell name={model.displayName} id={model.modelId} />
                </TableCell>
                <TableCell className="min-w-0">
                  <DescriptionCell value={`Catalog model from ${model.providerId}`} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{model.providerId}</TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{model.contextWindow ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge value={model.availability} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableSurface>
      )}
    </div>
  )
}
