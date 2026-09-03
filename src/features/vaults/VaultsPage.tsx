import { useQuery } from '@tanstack/react-query'
import { Vault } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { CreateVaultSheet } from './CreateVaultSheet'
import { useVaultActions } from './use-vault-actions'
import { VaultsView } from './VaultsView'

export function VaultsPage() {
  const [creating, setCreating] = useState(false)
  const actions = useVaultActions()
  const vaultsQuery = useQuery({
    queryKey: queryKeys.vaults.list(),
    queryFn: () => api.listVaults(),
  })
  const vaults = vaultsQuery.data?.data ?? []
  const pagination = useClientPagination(vaults)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vaults"
        description="Track safe credential-reference metadata for providers, MCP connectors, and runtime use."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Vault data-icon="inline-start" />
            Create vault
          </Button>
        }
      />
      <VaultsView vaults={pagination.items} pagination={pagination} onDelete={actions.deleteVault} />
      <CreateVaultSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
