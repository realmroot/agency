import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Env } from './env'

const routeSources = {
  // agents and environments are migrated to the clean-architecture http layer.
  agents: readFileSync('server/http/agents.ts', 'utf8'),
  environments: readFileSync('server/http/environments.ts', 'utf8'),
  sessions: readFileSync('server/http/sessions.ts', 'utf8'),
}

async function openApiDoc() {
  const response = await createApp().fetch(new Request('https://example.test/api/v1/openapi.json'), {
    OIDC_ISSUER: 'https://identity.contract.test/api/auth',
    OIDC_CLIENT_ID: 'enbor-contract-test',
    OIDC_RESOURCE: 'https://enbor.realmroot.dev/api',
  } as Env)
  assert.equal(response.status, 200)
  return (await response.json()) as {
    components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> }
  }
}

function bodyFields(source: string): string[] {
  const propertyAccess = [...source.matchAll(/\bbody\.([A-Za-z]\w*)/g)].map((match) => match[1]!)
  const destructured = [...source.matchAll(/const \{([^}]+)\}\s*=\s*c\.req\.valid\('json'\)/gs)].flatMap((match) =>
    match[1]!
      .split(',')
      .map((field) => field.trim().split(':', 1)[0]!.trim())
      .filter(Boolean),
  )
  return [...propertyAccess, ...destructured].sort()
}

function schemaFields(doc: Awaited<ReturnType<typeof openApiDoc>>, schemaName: string) {
  return Object.keys(doc.components?.schemas?.[schemaName]?.properties ?? {}).sort()
}

function sortedUnique(fields: string[]) {
  return [...new Set(fields)].sort()
}

function listFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listFiles(path.join(directory, entry.name), name) : [name]
    })
    .sort()
}

function readTarFiles(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive)
  const files = new Map<string, Buffer>()
  let offset = 0

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break

    const name = Buffer.from(header.subarray(0, 100)).toString('utf8').replace(/\0.*$/, '')
    const sizeText = Buffer.from(header.subarray(124, 136)).toString('ascii').replace(/\0.*$/, '').trim()
    const size = Number.parseInt(sizeText, 8)
    const contentsStart = offset + 512
    files.set(name, Buffer.from(tar.subarray(contentsStart, contentsStart + size)))
    offset = contentsStart + Math.ceil(size / 512) * 512
  }

  return files
}

describe('[spec: api-contracts/agent-skills] Agent Skills Discovery artifacts', () => {
  it('serves Agent Skills as assets while preserving Worker-first OAuth metadata', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8')
    const assetsSection = wrangler.match(/^\[assets\]\n([\s\S]*?)(?=^\[)/m)?.[1]
    const workerFirstJson = assetsSection?.match(/^run_worker_first = (\[[^\n]+\])$/m)?.[1]
    assert.ok(workerFirstJson, 'wrangler.toml must configure assets.run_worker_first')
    const workerFirst = JSON.parse(workerFirstJson) as string[]

    expect(workerFirst).toContain('/.well-known/oauth-protected-resource/api')
    expect(workerFirst).not.toContain('/.well-known/*')
    expect(workerFirst.every((route) => !route.startsWith('/.well-known/agent-skills'))).toBe(true)
  })

  it('publishes every owned Skill as a schema 0.2.0 digest-verified archive', () => {
    const check = spawnSync(process.execPath, ['scripts/build-agent-skills.mjs', '--check'], {
      encoding: 'utf8',
    })
    expect(check.stderr).toBe('')
    expect(check.status).toBe(0)

    const skillsRoot = path.resolve('skills')
    const publishRoot = path.resolve('public/.well-known/agent-skills')
    const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && listFiles(path.join(skillsRoot, entry.name)).includes('SKILL.md'))
      .map((entry) => entry.name)
      .sort()
    const index = JSON.parse(readFileSync(path.join(publishRoot, 'index.json'), 'utf8')) as {
      $schema: string
      skills: Array<{
        name: string
        type: string
        description: string
        url: string
        digest: string
      }>
    }

    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(index.skills.map((skill) => skill.name)).toEqual(skillNames)

    for (const skill of index.skills) {
      expect(skill).toMatchObject({
        type: 'archive',
        url: `/.well-known/agent-skills/${skill.name}.tar.gz`,
      })
      expect(skill.description).not.toBe('')

      const archive = readFileSync(path.join(publishRoot, `${skill.name}.tar.gz`))
      expect(skill.digest).toBe(`sha256:${createHash('sha256').update(archive).digest('hex')}`)

      const sourceRoot = path.join(skillsRoot, skill.name)
      const sourceFiles = listFiles(sourceRoot)
      const archiveFiles = readTarFiles(archive)
      expect([...archiveFiles.keys()].sort()).toEqual(sourceFiles)
      expect(archiveFiles.has('SKILL.md')).toBe(true)
      for (const name of sourceFiles) {
        expect(archiveFiles.get(name)).toEqual(readFileSync(path.join(sourceRoot, name)))
      }
    }
  })

  it('rejects stale generated artifacts', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'ama-agent-skills-'))
    try {
      cpSync('scripts/build-agent-skills.mjs', path.join(temporaryRoot, 'scripts/build-agent-skills.mjs'), {
        recursive: true,
      })
      cpSync('skills', path.join(temporaryRoot, 'skills'), { recursive: true })
      cpSync('public/.well-known/agent-skills', path.join(temporaryRoot, 'public/.well-known/agent-skills'), {
        recursive: true,
      })
      writeFileSync(path.join(temporaryRoot, 'public/.well-known/agent-skills/index.json'), '{}\n')

      const check = spawnSync(process.execPath, ['scripts/build-agent-skills.mjs', '--check'], {
        cwd: temporaryRoot,
        encoding: 'utf8',
      })

      expect(check.status).not.toBe(0)
      expect(check.stderr).toContain('public/.well-known/agent-skills/index.json is stale')
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('copies the discovery index and archives into the built client assets', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'enbor-agent-skills-copy-'))
    try {
      cpSync('scripts/copy-agent-skills-assets.mjs', path.join(temporaryRoot, 'scripts/copy-agent-skills-assets.mjs'), {
        recursive: true,
      })
      const source = path.join(temporaryRoot, 'public/.well-known/agent-skills')
      cpSync('public/.well-known/agent-skills', source, { recursive: true })
      const destination = path.join(temporaryRoot, 'dist/client/.well-known/agent-skills')
      mkdirSync(destination, { recursive: true })
      writeFileSync(path.join(destination, 'obsolete.tar.gz'), 'stale')

      const copy = spawnSync(process.execPath, ['scripts/copy-agent-skills-assets.mjs'], {
        cwd: temporaryRoot,
        encoding: 'utf8',
      })

      expect(copy.stderr).toBe('')
      expect(copy.status).toBe(0)
      const sourceFiles = listFiles(source)
      const publishedFiles = listFiles(destination)
      expect(publishedFiles).toEqual(sourceFiles)
      expect(publishedFiles).toContain('index.json')
      expect(publishedFiles.some((name) => name.endsWith('.tar.gz'))).toBe(true)
      for (const name of sourceFiles) {
        expect(readFileSync(path.join(destination, name))).toEqual(readFileSync(path.join(source, name)))
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})

describe('route schema and handler alignment [spec: api-contracts/schema-alignment]', () => {
  it('keeps agent write fields aligned across handlers and OpenAPI schemas', async () => {
    const doc = await openApiDoc()
    const createFields = schemaFields(doc, 'CreateAgentRequest')
    const updateFields = schemaFields(doc, 'UpdateAgentRequest')

    expect(createFields).toEqual(['metadata', 'spec'])
    expect(updateFields).toEqual(createFields)
  })

  it('keeps environment write fields aligned across handlers and OpenAPI schemas', async () => {
    const doc = await openApiDoc()
    const handled = sortedUnique(bodyFields(routeSources.environments))
    const createFields = schemaFields(doc, 'CreateEnvironmentRequest')
    const updateFields = schemaFields(doc, 'UpdateEnvironmentRequest')

    expect(handled).toEqual(createFields)
    expect(updateFields).toEqual(createFields)
  })

  it('keeps session write fields aligned across handlers and OpenAPI schemas', async () => {
    const doc = await openApiDoc()

    // Every body field any session handler reads, across the four session write
    // operations: create, update, message (content), approval decision, and
    // batch event ingest (events).
    expect(sortedUnique(bodyFields(routeSources.sessions))).toEqual([
      // POST /sessions/{id}/messages body.content
      'content',
      // PATCH /sessions/{id}/approvals/{id} body.decision
      'decision',
      // POST /sessions/{id}/events body.events
      'events',
      'metadata',
      'prompt',
      'reason',
      'requestId',
      'result',
      'spec',
      'state',
    ])

    expect(schemaFields(doc, 'CreateSessionRequest')).toEqual(['metadata', 'prompt', 'spec'])
    expect(schemaFields(doc, 'UpdateSessionRequest')).toEqual(['metadata', 'state'])
    expect(schemaFields(doc, 'CreateSessionMessageRequest')).toEqual(['content', 'requestId', 'type'])
    expect(schemaFields(doc, 'SessionApprovalDecisionRequest')).toEqual(['decision', 'reason', 'result'])
  })
})
