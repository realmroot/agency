import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Session } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useSessionActions() {
  const queryClient = useQueryClient()

  const closeSession = useMutation({
    mutationFn: api.closeSession,
    onSuccess: (session: Session) => {
      queryClient.setQueryData(queryKeys.sessions.detail(session.metadata.uid), session)
      toast.success('Session closed')
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const reopenSession = useMutation({
    mutationFn: api.reopenSession,
    onSuccess: (session: Session) => {
      queryClient.setQueryData(queryKeys.sessions.detail(session.metadata.uid), session)
      toast.success('Session reopened')
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const deleteSession = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: () => {
      toast.success('Session deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    closeSession: (id: string) => closeSession.mutate(id),
    reopenSession: (id: string) => reopenSession.mutate(id),
    deleteSession: (id: string) => deleteSession.mutate(id),
    closeSessionPending: closeSession.isPending,
    reopenSessionPending: reopenSession.isPending,
    deleteSessionPending: deleteSession.isPending,
  }
}
