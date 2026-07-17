import { describe, expect, it, vi } from 'vitest'
import type { RuntimeProviderRequest } from '../protocol'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}))

vi.mock('../host/cli', () => ({ resolveCliPath: () => undefined }))

vi.mock('./cli-host', () => ({
  hostHome: (env: Record<string, string>) => env.AMA_RUNTIME_BRIDGE_HOST_HOME,
  objectValue: (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  sdkEnv: (request: RuntimeProviderRequest) => request.env,
}))

const { ClaudeEventMapper } = await import('./claude-code')

describe('ClaudeEventMapper', () => {
  it('maps Claude Code builtin tool calls to canonical AMA runtime tools', () => {
    const mapper = new ClaudeEventMapper()
    const events = mapper.map({
      type: 'assistant',
      uuid: 'msg_1',
      message: {
        id: 'claude_msg_1',
        content: [
          { type: 'tool_use', id: 'tool_bash', name: 'Bash', input: { command: 'pwd' } },
          { type: 'tool_use', id: 'tool_read', name: 'Read', input: { file_path: 'README.md' } },
          { type: 'tool_use', id: 'tool_write', name: 'Write', input: { file_path: 'out.txt', content: 'ok' } },
          {
            type: 'tool_use',
            id: 'tool_edit',
            name: 'Edit',
            input: { file_path: 'out.txt', old_string: 'old', new_string: 'new' },
          },
          {
            type: 'tool_use',
            id: 'tool_grep',
            name: 'Grep',
            input: { pattern: 'TODO', path: 'src', glob: '*.ts', '-i': true },
          },
          { type: 'tool_use', id: 'tool_glob', name: 'Glob', input: { pattern: '*.ts', path: 'src' } },
          { type: 'tool_use', id: 'tool_fetch', name: 'WebFetch', input: { url: 'https://example.com' } },
          { type: 'tool_use', id: 'tool_search', name: 'WebSearch', input: { query: 'ama runtime' } },
          {
            type: 'tool_use',
            id: 'tool_agent',
            name: 'Task',
            input: { subagent_type: 'reviewer', description: 'Review pull request', prompt: 'Check this change' },
          },
        ],
      },
    } as unknown as Parameters<typeof mapper.map>[0])

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
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool_grep',
          name: 'grep',
          input: { pattern: 'TODO', path: 'src', glob: '*.ts', ignoreCase: true },
        },
      },
      { type: 'tool_call', toolCall: { id: 'tool_glob', name: 'find', input: { glob: '*.ts', path: 'src' } } },
      { type: 'tool_call', toolCall: { id: 'tool_fetch', name: 'fetch', input: { url: 'https://example.com' } } },
      { type: 'tool_call', toolCall: { id: 'tool_search', name: 'web_search', input: { query: 'ama runtime' } } },
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool_agent',
          name: 'agent',
          input: { prompt: 'Check this change', description: 'Review pull request', subagentName: 'reviewer' },
        },
      },
    ])
  })
})
