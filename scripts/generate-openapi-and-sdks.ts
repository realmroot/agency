// Emits the canonical OpenAPI snapshot from the Hono routes, then drives each
// language's community generator to produce its SDK from that snapshot.
//
//   sdk/openapi.json   <- route-generated OpenAPI 3.0 document (source of truth)
//   sdk/typescript     <- @hey-api/openapi-ts        (pnpm run generate)
//   sdk/go             <- oapi-codegen               (oapi-codegen -config ...)
//   sdk/python         <- openapi-python-client      (openapi-python-client generate ...)
//   sdk/spec           <- stable facade shape shared by all language SDKs
//
// `--check` regenerates everything and fails if any committed artifact drifts,
// which is how CI verifies the SDKs stay in sync with the contract. It requires
// all three toolchains (pnpm, oapi-codegen on PATH, openapi-python-client on
// PATH) to be installed.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../server/app'
import { AMA_CANONICAL_RESOURCE } from '../server/auth/scopes'
import type { Env } from '../server/env'

type OpenApiDocument = {
  openapi: string
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string
        security?: Array<Record<string, string[]>>
        responses?: Record<string, unknown>
      }
    >
  >
  components?: {
    schemas?: Record<string, JSONSchema>
  }
}

type JSONSchema = {
  properties?: Record<string, JSONSchema>
  enum?: Array<string | null>
  $ref?: string
  [key: string]: unknown
}

const ROOT = path.join(import.meta.dirname, '..')

async function main() {
  const check = process.argv.includes('--check')
  const before = check ? await sdkDigest(path.join(ROOT, 'sdk')) : null

  // 1. Emit the canonical OpenAPI snapshot from the live Hono routes.
  const document = await routeGeneratedOpenApi()
  removeNullEnumMembers(document)
  stabilizeSdkSchemaNames(document)
  await writeFile(path.join(ROOT, 'sdk/openapi.json'), `${JSON.stringify(document, null, 2)}\n`)

  // 2. Drive each language's generator from that snapshot.
  generateTypeScriptSdk()
  generateGoSdk()
  await generatePythonSdk()
  generateSdkFacades()

  // 3. In check mode, fail when regeneration changes the checked working tree.
  // Comparing content snapshots supports both clean CI checkouts and local
  // feature work whose generated artifacts are intentionally not committed yet.
  if (before && before !== (await sdkDigest(path.join(ROOT, 'sdk'))))
    throw new Error('Generated SDK artifacts are stale. Run pnpm openapi:generate and commit the result.')
}

async function sdkDigest(directory: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(current: string) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) {
        hash.update(path.relative(directory, absolute))
        hash.update(await readFile(absolute))
      }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}

function removeNullEnumMembers(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const schema = value as JSONSchema
  if (schema.enum?.includes(null)) schema.enum = schema.enum.filter((member): member is string => member !== null)
  for (const child of Object.values(schema)) removeNullEnumMembers(child)
}

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function generateTypeScriptSdk() {
  run('pnpm', ['--filter', '@any-managed-agents/sdk', 'run', 'generate'], ROOT)
}

function generateGoSdk() {
  run('oapi-codegen', ['-config', 'oapi-codegen.config.yaml', '../openapi.json'], path.join(ROOT, 'sdk/go'))
}

async function generatePythonSdk() {
  // openapi-python-client refuses to overwrite a package it did not create, so
  // remove the previous output first; `--meta none` keeps the hand-maintained
  // pyproject.toml. py.typed is re-added because `--meta none` omits it.
  const sdkDir = path.join(ROOT, 'sdk/python')
  execFileSync('rm', ['-rf', 'ama_sdk'], { cwd: sdkDir, stdio: 'inherit' })
  run(
    'openapi-python-client',
    ['generate', '--path', '../openapi.json', '--config', 'openapi-python-client.config.yaml', '--meta', 'none', '--output-path', 'ama_sdk', '--overwrite'],
    sdkDir,
  )
  execFileSync('touch', ['ama_sdk/py.typed'], { cwd: sdkDir, stdio: 'inherit' })
  const retiredAgentApi = path.join(sdkDir, 'ama_sdk/api/agents/retire_agent.py')
  const source = await readFile(retiredAgentApi, 'utf8')
  await writeFile(retiredAgentApi, source.replace(/[ \t]+$/gm, ''))
}

function generateSdkFacades() {
  run('node', ['scripts/generate-sdk-facades.mjs'], ROOT)
}

async function routeGeneratedOpenApi() {
  const app = createApp()
  const env = {
    OIDC_RESOURCE: AMA_CANONICAL_RESOURCE,
    OIDC_ISSUER: 'https://id.realmroot.dev/api/auth',
    OIDC_CLIENT_ID: 'ama-console',
  } as Env
  const response = await app.fetch(new Request('https://example.test/api/v1/openapi.json'), env)
  if (!response.ok) {
    throw new Error(`OpenAPI generation failed with HTTP ${response.status}`)
  }
  return (await response.json()) as OpenApiDocument
}

function stabilizeSdkSchemaNames(document: OpenApiDocument) {
  setPropertyEnumNames(document, 'VaultCredential', ['spec', 'type'], [
    'VaultCredentialTypeOpaque',
    'VaultCredentialTypeBasicAuth',
    'VaultCredentialTypeSshAuth',
    'VaultCredentialTypeTls',
    'VaultCredentialTypePrivateKeyJwk',
    'VaultCredentialTypeOauthToken',
    'VaultCredentialTypeRealmrootAgentState',
  ])
  setPropertyEnumNames(document, 'CreateVaultCredentialRequest', ['type'], [
    'CreateVaultCredentialRequestTypeOpaque',
    'CreateVaultCredentialRequestTypeBasicAuth',
    'CreateVaultCredentialRequestTypeSshAuth',
    'CreateVaultCredentialRequestTypeTls',
    'CreateVaultCredentialRequestTypePrivateKeyJwk',
    'CreateVaultCredentialRequestTypeOauthToken',
    'CreateVaultCredentialRequestTypeRealmrootAgentState',
  ])
}

function setPropertyEnumNames(document: OpenApiDocument, schemaName: string, propertyPath: string[], names: string[]) {
  let property: JSONSchema | undefined = document.components?.schemas?.[schemaName]
  for (const propertyName of propertyPath) {
    property = resolveSchemaRef(document, property)?.properties?.[propertyName]
  }
  property = resolveSchemaRef(document, property)
  if (!property) {
    throw new Error(`OpenAPI schema property ${schemaName}.${propertyPath.join('.')} not found`)
  }
  if (!property.enum || property.enum.length !== names.length) {
    throw new Error(`OpenAPI schema property ${schemaName}.${propertyPath.join('.')} enum does not match varnames`)
  }
  property['x-enum-varnames'] = names
}

function resolveSchemaRef(document: OpenApiDocument, schema: JSONSchema | undefined): JSONSchema | undefined {
  if (!schema?.$ref) {
    return schema
  }
  const prefix = '#/components/schemas/'
  if (!schema.$ref.startsWith(prefix)) {
    return schema
  }
  return document.components?.schemas?.[schema.$ref.slice(prefix.length)]
}

await main()
