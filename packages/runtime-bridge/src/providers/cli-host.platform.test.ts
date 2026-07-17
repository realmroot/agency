import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCliPath } from './cli-host'

const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT

function restoreEnv(name: 'PATH' | 'PATHEXT', value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

afterEach(() => {
  restoreEnv('PATH', originalPath)
  restoreEnv('PATHEXT', originalPathExt)
})

describe('[spec: runners/heartbeat] resolveCliPath platform lookup', () => {
  it('resolves a host CLI using native PATH and PATHEXT rules', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ama-runtime-path-'))
    const name = 'ama-runtime-probe'
    const executable = join(directory, process.platform === 'win32' ? `${name}.CMD` : name)
    try {
      writeFileSync(executable, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n')
      if (process.platform !== 'win32') {
        chmodSync(executable, 0o755)
      }
      process.env.PATH = [directory, originalPath].filter(Boolean).join(delimiter)
      if (process.platform === 'win32') {
        process.env.PATHEXT = '.CMD;.EXE'
      }

      const resolved = resolveCliPath(name)
      const normalize = (value: string | undefined) => (process.platform === 'win32' ? value?.toLowerCase() : value)
      expect(normalize(resolved)).toBe(normalize(executable))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
