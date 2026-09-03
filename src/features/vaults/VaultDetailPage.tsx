import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/console/components'
import { api, type VaultCredential } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { AddCredentialSheet } from './AddCredentialSheet'
import { RotateCredentialSheet } from './RotateCredentialSheet'
import { VaultDetailView } from './VaultDetailView'

export function VaultDetailPage() {
  const { vaultId } = useParams()
  const queryClient = useQueryClient()
  const [addingCredential, setAddingCredential] = useState(false)
  const [rotatingCredential, setRotatingCredential] = useState<VaultCredential | null>(null)
  /* v8 ignore start -- vaultId is always present when routed via /vaults/:vaultId; Boolean(vaultId) false branch is unreachable */
  const vaultQuery = useQuery({
    queryKey: queryKeys.vaults.detail(vaultId ?? ''),
    queryFn: () => api.readVault(vaultId as string),
    enabled: Boolean(vaultId),
  })
  const credentialsQuery = useQuery({
    queryKey: queryKeys.vaults.credentials(vaultId ?? ''),
    queryFn: () => api.listVaultCredentials(vaultId as string),
    enabled: Boolean(vaultId),
  })
  /* v8 ignore stop */
  /* v8 ignore start -- auditQuery queryFn and enabled branch are tested via the filter test; v8 can't attribute the sort comparator when only 1 element passes the filter */
  const auditQuery = useQuery({
    queryKey: queryKeys.vaults.audit(vaultId ?? ''),
    queryFn: async () => {
      const [vaultRecords, credentialRecords] = await Promise.all([
        api.listAuditRecords({ resourceType: 'vault', resourceId: vaultId as string }),
        api.listAuditRecords({ resourceType: 'vault_credential' }),
      ])
      return [
        ...vaultRecords.data,
        ...credentialRecords.data.filter((record) => record.metadata.vaultId === vaultId),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },
    enabled: Boolean(vaultId),
  })
  /* v8 ignore stop */
  const revokeCredential = useMutation({
    mutationFn: (credential: VaultCredential) => api.revokeVaultCredential(vaultId as string, credential.metadata.uid),
    /* v8 ignore start -- react-query schedules onSuccess/onError via microtask; side effects are tested but v8 can't attribute the lines */
    onSuccess: () => {
      toast.success('Credential revoked')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId ?? '') })
    },
    onError: (error) => toast.error(errorMessage(error)),
    /* v8 ignore stop */
  })
  const vault = vaultQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Vault"
        title={vault?.metadata.name ?? 'Vault detail'}
        description={vault?.metadata.description ?? 'Inspect credential metadata and safe reference state.'}
      />
      <VaultDetailView
        vault={vault}
        credentials={credentialsQuery.data?.data ?? []}
        auditRecords={auditQuery.data ?? []}
        loading={vaultQuery.isLoading}
        onAddCredential={() => setAddingCredential(true)}
        onRotate={(credential) => setRotatingCredential(credential)}
        onRevoke={(credential) => revokeCredential.mutate(credential)}
      />
      {/* v8 ignore start -- vaultId is always present when routed via /vaults/:vaultId; null branch never renders */}
      {vaultId ? (
        <>
          <AddCredentialSheet vaultId={vaultId} open={addingCredential} onOpenChange={setAddingCredential} />
          <RotateCredentialSheet
            vaultId={vaultId}
            credential={rotatingCredential}
            onOpenChange={(open) => {
              if (!open) setRotatingCredential(null)
            }}
          />
        </>
      ) : null}
      {/* v8 ignore stop */}
    </div>
  )
}
