import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useVaultActions() {
  const queryClient = useQueryClient()
  const deleteVault = useMutation({
    mutationFn: api.deleteVault,
    onSuccess: () => {
      toast.success('Vault deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    deleteVault: (id: string) => deleteVault.mutate(id),
    deleteVaultPending: deleteVault.isPending,
  }
}
