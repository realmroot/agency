import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('generated SDK layout [spec: api-contracts/sdk-layout]', () => {
  it('keeps generated OpenAPI and SDK artifacts aligned with Hono routes', () => {
    const files = execFileSync('git', ['ls-files', 'sdk'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter((file) => file && existsSync(file))
    const before = Object.fromEntries(files.map((file) => [file, readFileSync(file, 'utf8')]))
    execFileSync('pnpm', ['run', 'openapi:generate'], { encoding: 'utf8' })
    const after = Object.fromEntries(files.map((file) => [file, readFileSync(file, 'utf8')]))
    expect(after).toEqual(before)
  }, 30_000)

  it('keeps only the TypeScript SDK in pnpm workspaces', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')
    const sdkPackage = JSON.parse(readFileSync('sdk/typescript/package.json', 'utf8')) as { name?: string }

    expect(workspace).toContain('- sdk/typescript')
    expect(sdkPackage.name).toBe('@any-managed-agents/sdk')
    expect(readFileSync('sdk/go/go.mod', 'utf8')).toMatch(/^module github\.com\/saltbo\/any-managed-agents\/sdk\/go/m)
    expect(readFileSync('sdk/python/pyproject.toml', 'utf8')).toMatch(/^name = "any-managed-agents-sdk"/m)
  })

  it('keeps a single canonical OpenAPI snapshot', () => {
    expect(existsSync('sdk/openapi.json')).toBe(true)
    expect(existsSync('sdk/typescript/openapi.json')).toBe(false)
    expect(existsSync('sdk/go/openapi.json')).toBe(false)
    expect(existsSync('sdk/python/openapi.json')).toBe(false)
  })

  it('builds an importable TypeScript SDK package', () => {
    expect(() =>
      execFileSync('pnpm', ['--filter', '@any-managed-agents/sdk', 'run', 'smoke'], { encoding: 'utf8' }),
    ).not.toThrow()
  }, 30_000)

  it('keeps generated runner WebSocket facades on Bearer while Agent sockets remain DPoP', () => {
    const typescript = readFileSync('sdk/typescript/src/client.ts', 'utf8')
    const python = readFileSync('sdk/python/ama_sdk/facade.py', 'utf8')

    expect(typescript).toContain('Runner WebSocket factory with Bearer header support is required')
    expect(typescript).toContain("name.toLowerCase() !== 'dpop'")
    expect(typescript).toContain('Realmroot DPoP authorizer is required for AMA WebSocket connections')
    expect(python).toContain('def _runner_websocket_headers')
    expect(python).toContain('Runner WebSocket requires an Authorization: Bearer header')
    expect(python).toContain('def _dpop_websocket_headers')
  })

  it('keeps the web console on the shared Hono RPC client', () => {
    const apiClient = readFileSync('src/lib/amarpc/core.ts', 'utf8')

    expect(apiClient).toMatch(/hc<AppType>/)
    expect(apiClient).toMatch(/x-ama-client['"]?: ['"]web-rpc/)
    expect(apiClient).not.toMatch(/@any-managed-agents\/sdk/)
    expect(existsSync('src/lib/api.ts')).toBe(false)
  })
})
