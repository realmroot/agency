import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
