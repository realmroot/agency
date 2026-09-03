import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useAgentActions() {
  const queryClient = useQueryClient()
  const deleteAgent = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => {
      toast.success('Agent deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    deleteAgent: (id: string) => deleteAgent.mutate(id),
    deleteAgentPending: deleteAgent.isPending,
  }
}
