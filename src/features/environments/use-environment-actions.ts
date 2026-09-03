import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useEnvironmentActions() {
  const queryClient = useQueryClient()
  const deleteEnvironment = useMutation({
    mutationFn: api.deleteEnvironment,
    onSuccess: () => {
      toast.success('Environment deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    deleteEnvironment: (id: string) => deleteEnvironment.mutate(id),
    deleteEnvironmentPending: deleteEnvironment.isPending,
  }
}
