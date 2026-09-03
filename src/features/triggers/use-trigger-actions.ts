import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useTriggerActions() {
  const queryClient = useQueryClient()
  const pauseTrigger = useMutation({
    mutationFn: (id: string) => api.updateTrigger(id, { spec: { suspend: true } }),
    onSuccess: () => {
      toast.success('Trigger paused')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const resumeTrigger = useMutation({
    mutationFn: (id: string) => api.updateTrigger(id, { spec: { suspend: false } }),
    onSuccess: () => {
      toast.success('Trigger resumed')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const deleteTrigger = useMutation({
    mutationFn: (id: string) => api.deleteTrigger(id),
    onSuccess: () => {
      toast.success('Trigger deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    pauseTrigger: (id: string) => pauseTrigger.mutate(id),
    pauseTriggerPending: pauseTrigger.isPending,
    resumeTrigger: (id: string) => resumeTrigger.mutate(id),
    resumeTriggerPending: resumeTrigger.isPending,
    deleteTrigger: (id: string) => deleteTrigger.mutate(id),
    deleteTriggerPending: deleteTrigger.isPending,
  }
}
