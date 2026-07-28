import type { RuntimeBridgeControlMessage, RuntimeProviderHandle } from './protocol'

export type RuntimeControlQueue = {
  attach(handle: RuntimeProviderHandle): Promise<void>
  dispatch(message: RuntimeBridgeControlMessage): Promise<void>
}

export function createRuntimeControlQueue(onPromptRejected: (reason: string) => void): RuntimeControlQueue {
  let handle: RuntimeProviderHandle | undefined
  const pending: RuntimeBridgeControlMessage[] = []
  let tail = Promise.resolve()

  const deliver = async (message: RuntimeBridgeControlMessage) => {
    if (message.type === 'abort') {
      await handle!.abort()
      return
    }
    if (message.type === 'permissionDecision') {
      await handle!.resolvePermission?.(message.permissionId, message.allowed, message.reason)
      return
    }
    try {
      await handle!.send(message.message)
    } catch (error) {
      onPromptRejected(error instanceof Error ? error.message : String(error))
    }
  }

  const schedule = (message: RuntimeBridgeControlMessage) => {
    const result = tail.then(() => deliver(message))
    tail = result.catch(() => {})
    return result
  }

  return {
    async attach(nextHandle) {
      handle = nextHandle
      const controls = pending.splice(0)
      await Promise.all(controls.map(schedule))
    },
    async dispatch(message) {
      if (!handle) {
        pending.push(message)
        return
      }
      await schedule(message)
    },
  }
}
