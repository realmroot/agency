import type { AmaRuntimeEvent } from '@ama/runtime-contracts/bridge-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeProviderHandle } from './protocol'
import { createRuntimeControlQueue } from './runtime-controls'

function runtimeHandle(overrides: Partial<RuntimeProviderHandle> = {}): RuntimeProviderHandle {
  return {
    events: (async function* (): AsyncGenerator<AmaRuntimeEvent> {})(),
    abort: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('createRuntimeControlQueue', () => {
  it('queues startup controls until the provider handle is ready [spec: runtime/startup-controls]', async () => {
    const calls: string[] = []
    const handle = runtimeHandle({
      send: vi.fn(async (message) => {
        calls.push(`send:${message}`)
      }),
      abort: vi.fn(async () => {
        calls.push('abort')
      }),
      resolvePermission: vi.fn(async (permissionId, allowed) => {
        calls.push(`permission:${permissionId}:${allowed}`)
      }),
    })
    const rejected: string[] = []
    const controls = createRuntimeControlQueue((reason) => rejected.push(reason))

    await controls.dispatch({ type: 'send', requestId: 'run_1', message: 'follow up' })
    await controls.dispatch({
      type: 'permissionDecision',
      requestId: 'run_1',
      permissionId: 'permission_1',
      allowed: true,
    })
    await controls.dispatch({ type: 'abort', requestId: 'run_1' })

    expect(calls).toEqual([])

    await controls.attach(handle)

    expect(calls).toEqual(['send:follow up', 'permission:permission_1:true', 'abort'])
    expect(rejected).toEqual([])
  })

  it('reports a rejected prompt without blocking later controls', async () => {
    const calls: string[] = []
    const handle = runtimeHandle({
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('runtime is busy'))
        .mockImplementationOnce(async (message) => {
          calls.push(message)
        }),
    })
    const rejected: string[] = []
    const controls = createRuntimeControlQueue((reason) => rejected.push(reason))
    await controls.attach(handle)

    await controls.dispatch({ type: 'send', requestId: 'run_1', message: 'first' })
    await controls.dispatch({ type: 'send', requestId: 'run_1', message: 'second' })

    expect(rejected).toEqual(['runtime is busy'])
    expect(calls).toEqual(['second'])
  })
})
