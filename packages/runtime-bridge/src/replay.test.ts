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

function textFromMessageEvent(event: { payload: { message?: { content?: Array<{ text?: string }> } } }) {
  return event.payload.message?.content?.map((block) => block.text ?? '').join('') ?? ''
}

describe('runtime event replay', () => {
  it('maps provider JSONL for each external runtime through AMA event mappers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-replay-test-'))
    const sources = {
      codex: tempFile(dir, 'codex.jsonl', [
        {
          type: 'response_item',
          payload: {
            type: 'message',
            id: 'codex_msg',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'codex ok' }],
          },
        },
      ]),
      'claude-code': tempFile(dir, 'claude.jsonl', [
        {
          type: 'assistant',
          uuid: 'claude_msg',
          message: { content: [{ type: 'text', text: 'claude ok' }] },
        },
        { type: 'result', modelUsage: {} },
      ]),
      copilot: tempFile(dir, 'copilot.jsonl', [
        { type: 'assistant.turn.started', data: {} },
        { type: 'assistant.message', data: { messageId: 'copilot_msg', content: 'copilot ok' } },
        { type: 'session.idle', data: {} },
      ]),
    } as const

    for (const [runtime, sourcePath] of Object.entries(sources)) {
      const events = runtimeEventsFromSource({ runtime: runtime as keyof typeof sources, sourcePath })
      expect(events.at(0)?.type).toBe('runtime.started')
      expect(events.some((event) => event.type === 'turn.started')).toBe(true)
      expect(events.at(-1)?.type).toBe('turn.completed')
      const message = events.find((event) => event.type === 'message.completed')
      const expected = runtime === 'claude-code' ? 'claude ok' : runtime === 'copilot' ? 'copilot ok' : 'codex ok'
      expect(message).toBeDefined()
      expect(textFromMessageEvent(message as Parameters<typeof textFromMessageEvent>[0])).toContain(expected)
    }
  })

  it('rebuilds an events.jsonl file and backs up the previous log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ama-rebuild-test-'))
    const sourcePath = tempFile(dir, 'bridge.ndjson', [
      { type: 'ready', requestId: 'run_1' },
      {
        type: 'runtime.event',
        requestId: 'run_1',
        event: {
          type: 'message.completed',
          payload: {
            message: {
              id: 'msg_1',
              role: 'assistant',
              content: [{ type: 'text', text: 'hello from bridge' }],
            },
          },
        },
      },
      { type: 'result', requestId: 'run_1', result: { resumeToken: 'provider_session_1' } },
    ])
    const targetDir = join(dir, 'sessions', 'session_1')
    const targetPath = join(targetDir, 'events.jsonl')
    mkdirSync(targetDir, { recursive: true })
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

    const result = rebuildSessionEvents({ sourcePath, eventsPath: targetPath })

    expect(result).toMatchObject({
      targetPath,
      backupPath: expect.stringContaining('events.jsonl.bak-'),
      sessionId: 'session_1',
      events: 1,
      dryRun: false,
    })
    expect(result.backupPath && existsSync(result.backupPath)).toBe(true)
    const rebuilt = readFileSync(targetPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]).toMatchObject({
      id: 'event_rebuilt_00000001',
      sessionId: 'session_1',
      sequence: 1,
      type: 'message.completed',
    })
    expect(rebuilt[0].createdAt).toBe('2026-07-03T00:00:00.001Z')
  })
})
