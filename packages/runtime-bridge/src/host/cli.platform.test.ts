import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCliPath } from './cli'

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
    const script = join(directory, 'node_modules', 'ama-runtime-probe', 'cli.js')
    try {
      if (process.platform === 'win32') {
        mkdirSync(join(directory, 'node_modules', 'ama-runtime-probe'), { recursive: true })
        writeFileSync(script, 'process.exit(0)\r\n')
        writeFileSync(executable, '@echo off\r\nnode "%~dp0\\node_modules\\ama-runtime-probe\\cli.js" %*\r\n')
      } else {
        writeFileSync(executable, '#!/bin/sh\nexit 0\n')
        chmodSync(executable, 0o755)
      }
      process.env.PATH = [directory, originalPath].filter(Boolean).join(delimiter)
      if (process.platform === 'win32') {
        process.env.PATHEXT = '.CMD;.EXE'
      }

      const resolved = resolveCliPath(name)
      const normalize = (value: string | undefined) => (process.platform === 'win32' ? value?.toLowerCase() : value)
      expect(normalize(resolved)).toBe(normalize(process.platform === 'win32' ? script : executable))
      if (process.platform === 'win32' && resolved) {
        expect(spawnSync(process.execPath, [resolved]).status).toBe(0)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  const windowsIt = process.platform === 'win32' ? it : it.skip
  windowsIt('resolves the native Codex executable behind the npm command shim', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ama-codex-path-'))
    const scope = join(directory, 'node_modules', '@openai')
    const codexRoot = join(scope, 'codex')
    const codexScript = join(codexRoot, 'bin', 'codex.js')
    const platformName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64'
    const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
    const nativeExecutable = join(scope, platformName, 'vendor', target, 'bin', 'codex.exe')
    const shim = join(directory, 'codex.CMD')
    try {
      mkdirSync(join(codexRoot, 'bin'), { recursive: true })
      mkdirSync(join(scope, platformName, 'vendor', target, 'bin'), { recursive: true })
      writeFileSync(join(codexRoot, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
      writeFileSync(join(scope, platformName, 'package.json'), JSON.stringify({ name: `@openai/${platformName}` }))
      writeFileSync(codexScript, 'process.exit(0)\r\n')
      writeFileSync(nativeExecutable, '')
      writeFileSync(shim, '@echo off\r\nnode "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n')
      process.env.PATH = directory
      process.env.PATHEXT = '.CMD;.EXE'

      expect(resolveCliPath('codex')?.toLowerCase()).toBe(nativeExecutable.toLowerCase())
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
