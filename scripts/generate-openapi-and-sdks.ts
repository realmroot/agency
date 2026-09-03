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
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../server/app'
import { ENBOR_CANONICAL_RESOURCE } from '../server/auth/scopes'
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
  enum?: string[]
  $ref?: string
  [key: string]: unknown
}

const ROOT = path.join(import.meta.dirname, '..')

async function main() {
  const check = process.argv.includes('--check')

  // 1. Emit the canonical OpenAPI snapshot from the live Hono routes.
  const document = await routeGeneratedOpenApi()
  stabilizeSdkSchemaNames(document)
  await writeFile(path.join(ROOT, 'sdk/openapi.json'), `${JSON.stringify(document, null, 2)}\n`)

  // 2. Drive each language's generator from that snapshot.
  generateTypeScriptSdk()
  generateGoSdk()
  await generatePythonSdk()
  generateSdkFacades()

  // 3. In check mode, fail if regeneration changed any committed artifact.
  if (check) {
    run('git', ['diff', '--exit-code', '--', 'sdk'], ROOT)
  }
}

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function generateTypeScriptSdk() {
  run('pnpm', ['--filter', '@realmroot/enbor-sdk', 'run', 'generate'], ROOT)
}

function generateGoSdk() {
  run('oapi-codegen', ['-config', 'oapi-codegen.config.yaml', '../openapi.json'], path.join(ROOT, 'sdk/go'))
}

async function generatePythonSdk() {
  // openapi-python-client refuses to overwrite a package it did not create, so
  // remove the previous output first; `--meta none` keeps the hand-maintained
  // pyproject.toml. py.typed is re-added because `--meta none` omits it.
  const sdkDir = path.join(ROOT, 'sdk/python')
  execFileSync('rm', ['-rf', 'enbor_sdk'], { cwd: sdkDir, stdio: 'inherit' })
  run(
    'openapi-python-client',
    ['generate', '--path', '../openapi.json', '--config', 'openapi-python-client.config.yaml', '--meta', 'none', '--output-path', 'enbor_sdk', '--overwrite'],
    sdkDir,
  )
  execFileSync('touch', ['enbor_sdk/py.typed'], { cwd: sdkDir, stdio: 'inherit' })
  await normalizeGeneratedPython(path.join(sdkDir, 'enbor_sdk'))
}

async function normalizeGeneratedPython(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await normalizeGeneratedPython(entryPath)
      continue
    }
    if (!entry.name.endsWith('.py')) continue
    const content = await readFile(entryPath, 'utf8')
    const normalized = content
      .replace(/^    AMA = "ama"$/gm, '    ENBOR = "ama"')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n*$/, '\n')
    if (normalized !== content) await writeFile(entryPath, normalized)
  }
}

function generateSdkFacades() {
  run('node', ['scripts/generate-sdk-facades.mjs'], ROOT)
}

async function routeGeneratedOpenApi() {
  const app = createApp()
  const env = {
    OIDC_RESOURCE: ENBOR_CANONICAL_RESOURCE,
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
  setPropertyEnumNames(document, 'RunnerWorkPayload', ['protocol'], ['EnborRunnerWork'])
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
