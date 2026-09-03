import { describe, expect, it } from 'vitest'
import { redactToolResultsFromPayload } from './redaction'

describe('redactToolResultsFromPayload', () => {
  it('redacts only tool result output', () => {
    const payload = {
      message: {
        id: 'msg_1',
        role: 'tool',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'bash',
              input: { command: 'deploy', apiKey: 'tool-call-input-is-control-plane-state' },
            },
          },
          {
            type: 'tool_result',
            toolCallId: 'call_1',
            result: {
              content: [{ type: 'text', text: 'token=raw-secret-token\nAuthorization: Bearer abcdefghijklmnop' }],
              structuredContent: {
                apiKey: 'raw-api-key',
                nested: { accessToken: 'raw-access-token' },
                envFromShape: { type: 'secret', secretRef: 'enbor://vaults/v/credentials/c/versions/ver' },
              },
            },
            error: { message: 'password="raw-password"' },
          },
        ],
      },
    }

    expect(redactToolResultsFromPayload(payload)).toEqual({
      message: {
        id: 'msg_1',
        role: 'tool',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'bash',
              input: { command: 'deploy', apiKey: 'tool-call-input-is-control-plane-state' },
            },
          },
          {
            type: 'tool_result',
            toolCallId: 'call_1',
            result: {
              content: [{ type: 'text', text: 'token=[REDACTED]\nAuthorization: Bearer [REDACTED]' }],
              structuredContent: {
                apiKey: '[REDACTED]',
                nested: { accessToken: '[REDACTED]' },
                envFromShape: { type: 'secret', secretRef: 'enbor://vaults/v/credentials/c/versions/ver' },
              },
            },
            error: { message: 'password="[REDACTED]"' },
          },
        ],
      },
    })
  })
})
