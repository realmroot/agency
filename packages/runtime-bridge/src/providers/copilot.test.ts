import { describe, expect, it, vi } from 'vitest'
import type { RuntimeProviderRequest } from '../protocol'

vi.mock('@github/copilot/sdk', () => ({}))

vi.mock('@github/copilot-sdk', () => ({
  approveAll: vi.fn(),
  CopilotClient: class {},
}))

vi.mock('../host/cli', () => ({ resolveCliPath: () => undefined }))

vi.mock('./cli-host', () => ({
  hostHome: (env: Record<string, string>) => env.ENBOR_RUNTIME_BRIDGE_HOST_HOME,
  objectValue: (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  sdkEnv: (request: RuntimeProviderRequest) => request.env,
}))

const { CopilotEventMapper } = await import('./copilot')

describe('CopilotEventMapper', () => {
  it('maps Copilot tool requests to canonical Enbor runtime tools', () => {
    const mapper = new CopilotEventMapper()
    const events = mapper.map({
      type: 'assistant.message',
      data: {
        messageId: 'msg_1',
        toolRequests: [
          { toolCallId: 'tool_bash', name: 'shell', arguments: { command: 'pwd' } },
          { toolCallId: 'tool_read', name: 'read', arguments: { file_path: 'README.md' } },
          { toolCallId: 'tool_write', name: 'write', arguments: { file_path: 'out.txt', content: 'ok' } },
          {
            toolCallId: 'tool_edit',
            name: 'edit',
            arguments: { file_path: 'out.txt', old_text: 'old', new_text: 'new' },
          },
          { toolCallId: 'tool_fetch', name: 'url', arguments: { url: 'https://example.com' } },
          { toolCallId: 'tool_search', name: 'web_search', arguments: { query: 'enbor runtime' } },
        ],
      },
    })

    const blocks = events.flatMap((event) => (event.type === 'message.completed' ? event.payload.message.content : []))

    expect(blocks).toEqual([
      { type: 'tool_call', toolCall: { id: 'tool_bash', name: 'bash', input: { command: 'pwd' } } },
      { type: 'tool_call', toolCall: { id: 'tool_read', name: 'read', input: { path: 'README.md' } } },
      { type: 'tool_call', toolCall: { id: 'tool_write', name: 'write', input: { path: 'out.txt', content: 'ok' } } },
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool_edit',
          name: 'edit',
          input: { path: 'out.txt', edits: [{ oldText: 'old', newText: 'new' }] },
        },
      },
      { type: 'tool_call', toolCall: { id: 'tool_fetch', name: 'fetch', input: { url: 'https://example.com' } } },
      { type: 'tool_call', toolCall: { id: 'tool_search', name: 'web_search', input: { query: 'enbor runtime' } } },
    ])
  })
})
