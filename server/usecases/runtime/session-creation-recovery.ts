import type { CloudTurnQueue, SessionOrchestrationStore } from '../ports'

export async function recoverSessionCreations(deps: {
  sessionOrchestration: Pick<
    SessionOrchestrationStore,
    'pendingCloudSessionCreations' | 'acknowledgeCloudSessionCreation'
  > & { findSession(projectId: string, sessionId: string): Promise<{ state: string } | null> }
  cloudTurnQueue: Pick<CloudTurnQueue, 'enqueue'>
}): Promise<void> {
  const pending = await deps.sessionOrchestration.pendingCloudSessionCreations(50)
  const failures: unknown[] = []
  for (const message of pending) {
    try {
      const session = await deps.sessionOrchestration.findSession(message.projectId, message.sessionId)
      if (session?.state === 'pending') await deps.cloudTurnQueue.enqueue(message)
      await deps.sessionOrchestration.acknowledgeCloudSessionCreation(message.projectId, message.sessionId)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Session creation delivery recovery failed')
}
