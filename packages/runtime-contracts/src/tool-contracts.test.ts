import { describe, expect, it } from 'vitest'
import { EnborSandboxToolCallSchema, parseEnborSandboxToolInput, parseEnborSandboxToolOutput } from './tool-contracts'

describe('Enbor sandbox tool contracts', () => {
  it('defines strict inputs for every executable tool', () => {
    expect(parseEnborSandboxToolInput('bash', { command: 'pwd', timeout: 1000 })).toEqual({
      command: 'pwd',
      timeout: 1000,
    })
    expect(parseEnborSandboxToolInput('read', { path: 'README.md', offset: 0, limit: 10 })).toEqual({
      path: 'README.md',
      offset: 0,
      limit: 10,
    })
    expect(parseEnborSandboxToolInput('write', { path: 'a.txt', content: 'hello' })).toEqual({
      path: 'a.txt',
      content: 'hello',
    })
    expect(parseEnborSandboxToolInput('edit', { path: 'a.txt', edits: [{ oldText: 'a', newText: 'b' }] })).toEqual({
      path: 'a.txt',
      edits: [{ oldText: 'a', newText: 'b' }],
    })
    expect(parseEnborSandboxToolInput('grep', { pattern: 'needle', path: '.', literal: true, limit: 5 })).toEqual({
      pattern: 'needle',
      path: '.',
      literal: true,
      limit: 5,
    })
    expect(parseEnborSandboxToolInput('find', { pattern: 'test', glob: '**/*.test.ts', path: '.', limit: 20 })).toEqual(
      {
        pattern: 'test',
        glob: '**/*.test.ts',
        path: '.',
        limit: 20,
      },
    )
    expect(parseEnborSandboxToolInput('ls', { path: '.', limit: 20 })).toEqual({ path: '.', limit: 20 })
    expect(parseEnborSandboxToolInput('fetch', { url: 'https://example.com' })).toEqual({
      url: 'https://example.com',
    })
    expect(parseEnborSandboxToolInput('web_search', { query: 'managed agents', limit: 10 })).toEqual({
      query: 'managed agents',
      limit: 10,
    })
  })

  it('defines strict outputs for every executable tool', () => {
    const commandOutput = { stdout: 'ok', stderr: '', exitCode: 0 }
    expect(parseEnborSandboxToolOutput('bash', commandOutput)).toEqual(commandOutput)
    expect(parseEnborSandboxToolOutput('grep', commandOutput)).toEqual(commandOutput)
    expect(parseEnborSandboxToolOutput('find', commandOutput)).toEqual(commandOutput)
    expect(parseEnborSandboxToolOutput('ls', commandOutput)).toEqual(commandOutput)
    expect(parseEnborSandboxToolOutput('fetch', commandOutput)).toEqual(commandOutput)
    expect(parseEnborSandboxToolOutput('web_search', commandOutput)).toEqual(commandOutput)
    expect(parseEnborSandboxToolOutput('read', { content: 'hello', path: 'a.txt' })).toEqual({
      content: 'hello',
      path: 'a.txt',
    })
    expect(parseEnborSandboxToolOutput('write', { ok: true, path: 'a.txt', bytes: 5 })).toEqual({
      ok: true,
      path: 'a.txt',
      bytes: 5,
    })
    expect(parseEnborSandboxToolOutput('edit', { ok: true, path: 'a.txt' })).toEqual({ ok: true, path: 'a.txt' })
  })

  it('rejects loose inputs for known executable tool names', () => {
    expect(
      EnborSandboxToolCallSchema.safeParse({ id: 'call_1', name: 'bash', input: { path: 'README.md' } }).success,
    ).toBe(false)
    expect(() => parseEnborSandboxToolInput('read', { path: 'README.md', extra: true })).toThrow()
    expect(() => parseEnborSandboxToolInput('find', { path: '.' })).toThrow()
  })
})
