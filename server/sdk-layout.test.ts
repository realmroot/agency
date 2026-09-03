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
  }, 60_000)

  it('keeps only the TypeScript SDK in pnpm workspaces', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')
    const sdkPackage = JSON.parse(readFileSync('sdk/typescript/package.json', 'utf8')) as {
      name?: string
      private?: boolean
      publishConfig?: { registry?: string }
      repository?: { url?: string; directory?: string }
    }

    expect(workspace).toContain('- sdk/typescript')
    expect(sdkPackage).toMatchObject({
      name: '@realmroot/enbor-sdk',
      private: false,
      publishConfig: { registry: 'https://npm.pkg.github.com' },
      repository: { url: 'https://github.com/realmroot/agency.git', directory: 'sdk/typescript' },
    })
    expect(readFileSync('sdk/go/go.mod', 'utf8')).toMatch(/^module github\.com\/realmroot\/agency\/sdk\/go/m)
    expect(readFileSync('sdk/python/pyproject.toml', 'utf8')).toMatch(/^name = "enbor-sdk"/m)
    expect(existsSync('sdk/python/enbor_sdk/__init__.py')).toBe(true)
  })

  it('keeps a single canonical OpenAPI snapshot', () => {
    expect(existsSync('sdk/openapi.json')).toBe(true)
    expect(existsSync('sdk/typescript/openapi.json')).toBe(false)
    expect(existsSync('sdk/go/openapi.json')).toBe(false)
    expect(existsSync('sdk/python/openapi.json')).toBe(false)
  })

  it('builds an importable TypeScript SDK package', () => {
    expect(() =>
      execFileSync('pnpm', ['--filter', '@realmroot/enbor-sdk', 'run', 'smoke'], { encoding: 'utf8' }),
    ).not.toThrow()
  }, 30_000)

  it('keeps generated runner WebSocket facades on Bearer while Agent sockets remain DPoP', () => {
    const typescript = readFileSync('sdk/typescript/src/client.ts', 'utf8')
    const python = readFileSync('sdk/python/enbor_sdk/facade.py', 'utf8')

    expect(typescript).toContain('Runner WebSocket factory with Bearer header support is required')
    expect(typescript).toContain("name.toLowerCase() !== 'dpop'")
    expect(typescript).toContain('Realmroot DPoP authorizer is required for AMA WebSocket connections')
    expect(python).toContain('def _runner_websocket_headers')
    expect(python).toContain('Runner WebSocket requires an Authorization: Bearer header')
    expect(python).toContain('def _dpop_websocket_headers')
  })

  it('requires and forwards the Identity idempotency key in every language facade', () => {
    const typescript = readFileSync('sdk/typescript/src/client.ts', 'utf8')
    const go = readFileSync('sdk/go/enbor/client.go', 'utf8')
    const python = readFileSync('sdk/python/enbor_sdk/facade.py', 'utf8')

    expect(typescript).toContain('create: (body: types.CreateIdentityRequest, idempotencyKey: string)')
    expect(typescript).toContain('headers: { "idempotency-key": idempotencyKey }')
    expect(go).toContain('Create(ctx context.Context, params *CreateIdentityParams, body CreateIdentityRequest)')
    expect(go).toContain('CreateIdentityWithResponse(ctx, params, body)')
    expect(python).toContain('def create(self, body: Any, idempotency_key: str)')
    expect(python).toContain('body=body, idempotency_key=idempotency_key')
  })

  it('keeps the web console on the shared Hono RPC client', () => {
    const apiClient = readFileSync('src/lib/amarpc/core.ts', 'utf8')

    expect(apiClient).toMatch(/hc<AppType>/)
    expect(apiClient).toMatch(/x-ama-client['"]?: ['"]web-rpc/)
    expect(apiClient).not.toMatch(/@realmroot\/enbor-sdk/)
    expect(existsSync('src/lib/api.ts')).toBe(false)
  })

  it('publishes versioned Enbor SDK artifacts through GitHub', () => {
    const workflow = readFileSync('.github/workflows/enbor-sdk-release.yml', 'utf8')

    expect(workflow).toContain('enbor-sdk-v*')
    expect(workflow).toContain('packages: write')
    expect(workflow).toContain('pnpm --filter @realmroot/enbor-sdk publish')
    expect(workflow).toMatch(/sdk\/go\/v\$\{version\}/)
    expect(workflow).toContain('sdk/python/dist/*')
  })
})
