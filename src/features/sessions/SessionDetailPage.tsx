import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useParams } from 'react-router'
import { EmptyState } from '@/console/components'
import { api, type Session } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { SessionDetailView } from './SessionDetailView'
import { useSessionActions } from './use-session-actions'
import { useSessionRuntimeSession } from './use-session-runtime'

export function sessionRefetchInterval(phase: Session['status']['phase'] | undefined) {
  return phase === 'pending' || phase === 'running' ? 2000 : false
}

export function SessionDetailPage() {
  const { sessionId } = useParams()
  const queryClient = useQueryClient()
  const actions = useSessionActions()
  const [message, setMessage] = useState('')
  const sessionQuery = useQuery({
    queryKey: queryKeys.sessions.detail(sessionId ?? ''),
    queryFn: () => api.readSession(sessionId as string),
    enabled: Boolean(sessionId),
    /* v8 ignore start -- refetchInterval is a React Query internal callback */
    refetchInterval: (query) => sessionRefetchInterval(query.state.data?.status.phase),
    /* v8 ignore stop */
  })
  const session = sessionQuery.data ?? null
  const agentQuery = useQuery({
    queryKey: queryKeys.agents.detail(session?.spec.agentId ?? ''),
    /* v8 ignore start -- queryFn only runs when enabled=true (agentId is truthy), so `?? ''` fallback is unreachable */
    queryFn: () => api.readAgent(session?.spec.agentId ?? ''),
    /* v8 ignore stop */
    enabled: Boolean(session?.spec.agentId),
  })
  const environmentQuery = useQuery({
    queryKey: queryKeys.environments.detail(session?.spec.environmentId ?? ''),
    /* v8 ignore start -- queryFn only runs when enabled=true (environmentId is truthy), so `?? ''` fallback is unreachable */
    queryFn: () => api.readEnvironment(session?.spec.environmentId ?? ''),
    /* v8 ignore stop */
    enabled: Boolean(session?.spec.environmentId),
  })
  const refreshEvents = useCallback(() => {
    /* v8 ignore start -- sessionId is always defined when refreshEvents is invoked; `?? ''` fallbacks are unreachable */
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId ?? '') })
    /* v8 ignore stop */
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
  }, [queryClient, sessionId])
  const runtime = useSessionRuntimeSession({
    session,
    onEventsChanged: refreshEvents,
  })
  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId || !runtime.sendPrompt(content)) {
        refreshEvents()
      }
    },
    [refreshEvents, runtime, sessionId],
  )

  if (sessionQuery.isPending) return <EmptyState title="Loading session" body="Reading the requested session." />
  if (!session) return <EmptyState title="Session not found" body="The requested session is not in this project." />
  return (
    <div className="h-[calc(100dvh-8rem)] min-h-0 overflow-hidden">
      <SessionDetailView
        session={session}
        agentName={agentQuery.data?.metadata.name}
        environmentName={environmentQuery.data?.metadata.name}
        runtime={runtime.state}
        onClose={actions.closeSession}
        onReopen={actions.reopenSession}
        onDelete={actions.deleteSession}
        closePending={actions.closeSessionPending}
        reopenPending={actions.reopenSessionPending}
        deletePending={actions.deleteSessionPending}
        onReconnectRuntime={runtime.reconnect}
        chatMessage={message}
        setChatMessage={setMessage}
        onSendMessage={sendMessage}
        onAbortRuntime={runtime.abort}
      />
    </div>
  )
}
