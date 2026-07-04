import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rebuildSessionEvents } from '../../../scripts/rebuild-session-events'
import { runtimeEventsFromSource } from './replay'

function tempFile(dir: string, name: string, records: unknown[]) {
  const filePath = join(dir, name)
  writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return filePath
}

function providerRecord(event: Record<string, unknown>, runtime = 'codex') {
  return { sequence: 1, createdAt: '2026-07-04T00:00:00.000Z', runtime, event }
}

function textFromMessageEvent(event: { payload: { message?: { content?: Array<{ text?: string }> } } }) {
  return event.payload.message?.content?.map((block) => block.text ?? '').join('') ?? ''
}

describe('runtime event replay', () => {
  it('maps captured Codex provider stream events through the runtime mapper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-replay-provider-test-'))
    const sourcePath = tempFile(dir, 'provider-events.jsonl', [
      providerRecord({ type: 'thread.started', thread_id: 'thread_1' }),
      providerRecord({
        type: 'item.completed',
        item: { id: 'codex_msg', type: 'agent_message', text: 'codex ok' },
      }),
      providerRecord({ type: 'turn.completed' }),
    ])

    const events = runtimeEventsFromSource({ sourcePath })

    expect(events.at(0)?.type).toBe('runtime.started')
    expect(events.at(-1)?.type).toBe('turn.completed')
    const message = events.find((event) => event.type === 'message.completed')
    expect(message).toBeDefined()
    expect(textFromMessageEvent(message as Parameters<typeof textFromMessageEvent>[0])).toContain('codex ok')
  })

  it('maps Codex collab tool calls from captured provider events to the canonical agent tool contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-replay-collab-test-'))
    const sourcePath = tempFile(dir, 'provider-events.jsonl', [
      providerRecord({
        type: 'item.started',
        item: {
          id: 'collab_spawn_1',
          type: 'collab_tool_call',
          tool: 'spawn_agent',
          sender_thread_id: 'thread_parent',
          receiver_thread_ids: [],
          prompt: 'Review the patch',
          agents_states: {},
          status: 'in_progress',
        },
      }),
      providerRecord({
        type: 'item.completed',
        item: {
          id: 'collab_spawn_1',
          type: 'collab_tool_call',
          tool: 'spawn_agent',
          sender_thread_id: 'thread_parent',
          receiver_thread_ids: ['agent_1'],
          prompt: 'Review the patch',
          agents_states: { agent_1: { status: 'pending_init' } },
          status: 'completed',
        },
      }),
      providerRecord({
        type: 'item.completed',
        item: {
          id: 'collab_wait_1',
          type: 'collab_tool_call',
          tool: 'wait',
          sender_thread_id: 'thread_parent',
          receiver_thread_ids: ['agent_1'],
          agents_states: { agent_1: { status: 'completed', message: 'Review passed.' } },
          status: 'completed',
        },
      }),
    ])

    const events = runtimeEventsFromSource({ sourcePath })

    expect(JSON.stringify(events)).not.toContain('"spawn_agent"')
    expect(JSON.stringify(events)).not.toContain('"wait"')
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              content: [
                {
                  type: 'tool_call',
                  toolCall: {
                    id: 'collab_spawn_1',
                    name: 'agent',
                    input: { prompt: 'Review the patch' },
                  },
                },
              ],
            }),
          },
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'tool',
              parentToolCallId: 'collab_spawn_1',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: 'collab_spawn_1',
                  result: {
                    content: [{ type: 'text', text: 'Review passed.' }],
                    structuredContent: {
                      agentId: 'agent_1',
                      status: 'completed',
                      provider: 'codex',
                      rawStatus: { status: 'completed', message: 'Review passed.' },
                    },
                  },
                },
              ],
            }),
          },
        }),
      ]),
    )
  })

  it('rebuilds an events.jsonl file from the default provider-events sidecar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-rebuild-test-'))
    const targetDir = join(dir, 'sessions', 'session_1')
    const targetPath = join(targetDir, 'events.jsonl')
    mkdirSync(targetDir, { recursive: true })
    tempFile(targetDir, 'provider-events.jsonl', [
      providerRecord({
        type: 'item.completed',
        item: { id: 'codex_msg', type: 'agent_message', text: 'hello from provider sidecar' },
      }),
    ])
    writeFileSync(
      targetPath,
      `${JSON.stringify({
        id: 'old_event',
        sessionId: 'session_1',
        sequence: 1,
        createdAt: '2026-07-03T00:00:00.000Z',
        type: 'turn.completed',
        payload: {},
      })}\n`,
    )

    const result = rebuildSessionEvents({ eventsPath: targetPath })

    expect(result).toMatchObject({
      targetPath,
      backupPath: expect.stringContaining('events.jsonl.bak-'),
      sessionId: 'session_1',
      events: 4,
      dryRun: false,
    })
    expect(result.backupPath && existsSync(result.backupPath)).toBe(true)
    const rebuilt = readFileSync(targetPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(rebuilt).toHaveLength(4)
    expect(rebuilt[0]).toMatchObject({
      id: 'event_rebuilt_00000001',
      sessionId: 'session_1',
      sequence: 1,
      type: 'runtime.started',
    })
    expect(rebuilt[0].createdAt).toBe('2026-07-03T00:00:00.001Z')
    expect(JSON.stringify(rebuilt)).toContain('hello from provider sidecar')
  })

  it('extracts provider.event frames from captured bridge NDJSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-replay-bridge-test-'))
    const sourcePath = tempFile(dir, 'bridge.ndjson', [
      { type: 'ready', requestId: 'run_1' },
      {
        type: 'runtime.event',
        requestId: 'run_1',
        event: { type: 'message.completed', payload: { ignored: true } },
      },
      {
        type: 'provider.event',
        requestId: 'run_1',
        runtime: 'codex',
        event: {
          type: 'item.completed',
          item: { id: 'codex_msg', type: 'agent_message', text: 'hello from provider frame' },
        },
      },
      { type: 'result', requestId: 'run_1', result: { resumeToken: 'provider_session_1' } },
    ])

    const events = runtimeEventsFromSource({ sourcePath, sourceFormat: 'bridge-ndjson' })

    expect(JSON.stringify(events)).toContain('hello from provider frame')
    expect(JSON.stringify(events)).not.toContain('ignored')
  })

  it('rejects bridge NDJSON that mixes provider events from multiple requests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-replay-bridge-mixed-test-'))
    const sourcePath = tempFile(dir, 'bridge.ndjson', [
      {
        type: 'provider.event',
        requestId: 'run_1',
        runtime: 'codex',
        event: { type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text: 'first' } },
      },
      {
        type: 'provider.event',
        requestId: 'run_2',
        runtime: 'codex',
        event: { type: 'item.completed', item: { id: 'msg_2', type: 'agent_message', text: 'second' } },
      },
    ])

    expect(() => runtimeEventsFromSource({ sourcePath, sourceFormat: 'bridge-ndjson' })).toThrow(
      /multiple provider request ids: run_1, run_2/,
    )
  })

  it('rejects old raw provider JSONL sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-replay-raw-reject-test-'))
    const sourcePath = tempFile(dir, 'codex-raw.jsonl', [
      {
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'codex_msg',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'old raw event' }],
        },
      },
    ])

    expect(() => runtimeEventsFromSource({ runtime: 'codex', sourcePath })).toThrow(/Unable to infer source format/)
  })
})
