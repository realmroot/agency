import { describe, expect, it } from 'vitest'
import {
  EnborRuntimeEventSchema,
  RuntimeBridgeControlMessageSchema,
  RuntimeBridgeErrorSchema,
  RuntimeBridgeInputMessageSchema,
  RuntimeBridgeInventoryResultSchema,
  RuntimeBridgeOutputMessageSchema,
} from './bridge-protocol'

describe('RuntimeBridgeInputMessageSchema', () => {
  it('accepts run, inventory, and typed control envelopes', () => {
    expect(
      RuntimeBridgeInputMessageSchema.safeParse({
        type: 'run',
        requestId: 'run_1',
        runtime: 'codex',
        sessionId: 'session_1',
        cwd: '/workspace',
        env: { HOME: '/tmp' },
        prompt: 'build',
        provider: 'openai',
        model: 'gpt',
        agentSnapshot: { metadata: { uid: 'agent_1' } },
        runtimeConfig: { allowedTools: ['bash'] },
        resume: true,
        resumeToken: 'thread_1',
      }).success,
    ).toBe(true)
    expect(
      RuntimeBridgeInputMessageSchema.safeParse({
        type: 'inventory',
        requestId: 'inv_1',
        env: {},
        includeUsage: true,
        usageOnly: true,
      }).success,
    ).toBe(true)
    expect(
      RuntimeBridgeControlMessageSchema.safeParse({ type: 'send', requestId: 'run_1', message: 'continue' }).success,
    ).toBe(true)
    expect(
      RuntimeBridgeControlMessageSchema.safeParse({ type: 'abort', requestId: 'run_1', reason: 'stop' }).success,
    ).toBe(true)
    expect(
      RuntimeBridgeControlMessageSchema.safeParse({
        type: 'permissionDecision',
        requestId: 'run_1',
        permissionId: 'perm_1',
        allowed: false,
        reason: 'denied',
      }).success,
    ).toBe(true)
  })

  it('rejects invalid control envelopes before they reach the bridge', () => {
    expect(RuntimeBridgeControlMessageSchema.safeParse({ type: 'send', requestId: 'run_1' }).success).toBe(false)
    expect(
      RuntimeBridgeControlMessageSchema.safeParse({
        type: 'permissionDecision',
        requestId: 'run_1',
        permissionId: 'perm_1',
      }).success,
    ).toBe(false)
    expect(
      RuntimeBridgeControlMessageSchema.safeParse({ type: 'abort', requestId: 'run_1', message: 'not allowed' })
        .success,
    ).toBe(false)
  })
})

describe('RuntimeBridgeOutputMessageSchema', () => {
  it('accepts each output envelope and keeps runtime events opaque', () => {
    const outputs = [
      { type: 'ready' },
      { type: 'ready', requestId: 'run_1' },
      {
        type: 'runtime.event',
        requestId: 'run_1',
        event: { type: 'provider.custom', payload: { nested: { kept: true } } },
      },
      {
        type: 'provider.event',
        requestId: 'run_1',
        runtime: 'codex',
        event: { type: 'item.completed', item: { type: 'collab_tool_call' } },
      },
      { type: 'resumeToken', requestId: 'run_1', resumeToken: 'thread_1' },
      { type: 'result', requestId: 'run_1', result: { exitCode: 0 } },
      {
        type: 'error',
        requestId: 'run_1',
        error: { message: 'failed', code: 'runtime_exit', details: { stderr: 'x' } },
      },
      { type: 'error', error: { message: 'failed' } },
    ]
    for (const output of outputs) {
      expect(RuntimeBridgeOutputMessageSchema.safeParse(output).success, output.type).toBe(true)
    }
    expect(EnborRuntimeEventSchema.parse({ type: 'provider.custom', payload: { raw: true } })).toEqual({
      type: 'provider.custom',
      payload: { raw: true },
    })
  })

  it('rejects malformed envelopes but not opaque event internals', () => {
    expect(RuntimeBridgeOutputMessageSchema.safeParse({ type: 'runtime.event', requestId: 'run_1' }).success).toBe(
      false,
    )
    expect(RuntimeBridgeOutputMessageSchema.safeParse({ type: 'result', requestId: 'run_1', event: {} }).success).toBe(
      false,
    )
    expect(RuntimeBridgeOutputMessageSchema.safeParse({ type: 'resumeToken', requestId: 'run_1' }).success).toBe(false)
    expect(EnborRuntimeEventSchema.safeParse([]).success).toBe(false)
  })
})

describe('RuntimeBridgeErrorSchema', () => {
  it('requires serializable error details', () => {
    expect(RuntimeBridgeErrorSchema.safeParse({ message: 'failed', details: { reason: 'x' } }).success).toBe(true)
    expect(RuntimeBridgeErrorSchema.safeParse({ message: 'failed', details: () => undefined }).success).toBe(false)
  })
})

describe('RuntimeBridgeInventoryResultSchema', () => {
  it('validates runtime inventory snapshots', () => {
    expect(
      RuntimeBridgeInventoryResultSchema.safeParse({
        runtimes: [
          {
            runtime: 'codex',
            binary: 'codex',
            installed: true,
            fallbackModels: ['gpt'],
            models: ['gpt'],
            status: 'ready',
            version: '1.0.0',
            detail: 'ready',
            usageWindows: [{ label: '5h', utilization: 10, resetsAt: '2026-01-01T00:00:00Z' }],
            limitedDetail: 'none',
          },
        ],
      }).success,
    ).toBe(true)
    expect(RuntimeBridgeInventoryResultSchema.safeParse({ runtimes: [{ runtime: 'unknown' }] }).success).toBe(false)
  })
})
