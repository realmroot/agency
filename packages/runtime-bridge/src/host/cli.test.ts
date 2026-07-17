import { afterEach, describe, expect, it, vi } from 'vitest'

const whichSyncMock = vi.fn<(command: string, options?: unknown) => string | null>()
vi.mock('which', () => ({
  default: { sync: (command: string, options?: unknown) => whichSyncMock(command, options) },
}))

const { resolveCliPath } = await import('./cli')

afterEach(() => {
  vi.restoreAllMocks()
  whichSyncMock.mockReset()
})

describe('resolveCliPath', () => {
  it('resolves a directly executable host command', () => {
    whichSyncMock.mockReturnValue('/usr/local/bin/codex')
    expect(resolveCliPath('codex')).toBe('/usr/local/bin/codex')
    expect(whichSyncMock).toHaveBeenCalledWith('codex', { nothrow: true })
  })

  it('returns undefined when the command is not found', () => {
    whichSyncMock.mockReturnValue(null)
    expect(resolveCliPath('claude')).toBeUndefined()
  })
})
