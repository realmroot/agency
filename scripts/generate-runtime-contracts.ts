import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  RuntimeBridgeInventoryMessageSchema,
  RuntimeBridgeInventoryResultSchema,
  RuntimeBridgeRunMessageSchema,
  RuntimeInventoryEntrySchema,
  RuntimeUsageWindowSchema,
} from '../packages/runtime-contracts/src/bridge-protocol'
import { EXTERNAL_RUNTIME_NAMES } from '../packages/runtime-contracts/src/runtime-names'
import { ENBOR_SESSION_EVENT_TYPES } from '../packages/runtime-contracts/src/session-events'

type JSONSchema = Record<string, unknown>
type OpenApiDocument = {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, never>
  components: { schemas: Record<string, JSONSchema> }
}

type GeneratedTextFile = {
  path: string
  content: string
}

const ROOT = path.join(import.meta.dirname, '..')
const RUNTIME_CONTRACT_OPENAPI = path.join(ROOT, 'packages/runtime-contracts/openapi/runtime-bridge.openapi.json')
const SESSION_EVENT_OPENAPI = path.join(ROOT, 'packages/runtime-contracts/openapi/session-events.openapi.json')

const RUNTIME_BRIDGE_CONFIG = path.join(ROOT, 'cmd/enbor-runner/pkg/runtimebridge/oapi-codegen.config.yaml')
const SESSION_EVENT_CONFIG = path.join(ROOT, 'cmd/enbor-runner/pkg/sessionevent/oapi-codegen.config.yaml')

const RUNTIME_BRIDGE_GO = path.join(ROOT, 'cmd/enbor-runner/pkg/runtimebridge/protocol_gen.go')
const SESSION_EVENT_GO = path.join(ROOT, 'cmd/enbor-runner/pkg/sessionevent/session_events_gen.go')

const SESSION_EVENT_TYPES = [...ENBOR_SESSION_EVENT_TYPES]

async function main() {
  const check = process.argv.includes('--check')
  const openApiFiles = generatedOpenApiFiles()

  if (check) {
    await assertFilesCurrent(openApiFiles)
    await assertGeneratedGoCurrent(RUNTIME_BRIDGE_CONFIG, RUNTIME_CONTRACT_OPENAPI, RUNTIME_BRIDGE_GO)
    await assertGeneratedGoCurrent(SESSION_EVENT_CONFIG, SESSION_EVENT_OPENAPI, SESSION_EVENT_GO)
    console.log('Runtime contract artifacts are up to date.')
    return
  }

  for (const file of openApiFiles) {
    await writeFile(file.path, file.content)
    console.log(`Generated ${path.relative(ROOT, file.path)}.`)
  }
  runOapiCodegen(RUNTIME_BRIDGE_CONFIG, RUNTIME_CONTRACT_OPENAPI)
  runOapiCodegen(SESSION_EVENT_CONFIG, SESSION_EVENT_OPENAPI)
}

function generatedOpenApiFiles(): GeneratedTextFile[] {
  return [
    {
      path: RUNTIME_CONTRACT_OPENAPI,
      content: stableJSON(runtimeBridgeOpenApiDocument()),
    },
    {
      path: SESSION_EVENT_OPENAPI,
      content: stableJSON(sessionEventOpenApiDocument()),
    },
  ]
}

function runtimeBridgeOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Enbor Runtime Bridge Protocol',
      version: '1.0.0',
    },
    paths: {},
    components: {
      schemas: {
        JSON: {
          type: 'object',
          additionalProperties: true,
        },
        ExternalRuntimeName: {
          type: 'string',
          enum: EXTERNAL_RUNTIME_NAMES,
          'x-enum-varnames': EXTERNAL_RUNTIME_NAMES.map((name) => `ExternalRuntime${goConstName(name)}`),
        },
        EnborSessionEventType: sessionEventTypeSchema(),
        RuntimeBridgeRunMessage: bridgeRunMessageSchema(),
        RuntimeBridgeControlMessage: bridgeControlMessageSchema(),
        RuntimeBridgeInventoryMessage: bridgeInventoryMessageSchema(),
        RuntimeBridgeOutputMessage: bridgeOutputMessageSchema(),
        RuntimeBridgeError: bridgeErrorSchema(),
        RuntimeBridgeInventoryResult: bridgeInventoryResultSchema(),
        RuntimeBridgeInventoryRuntime: bridgeInventoryRuntimeSchema(),
        RuntimeBridgeUsageWindow: openApiSchema(RuntimeUsageWindowSchema),
      },
    },
  }
}

function sessionEventOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Enbor Session Event Types',
      version: '1.0.0',
    },
    paths: {},
    components: {
      schemas: {
        EnborSessionEventType: sessionEventTypeSchema(),
      },
    },
  }
}

function bridgeRunMessageSchema() {
  const schema = openApiSchema(RuntimeBridgeRunMessageSchema)
  setPropertyRef(schema, 'runtime', 'ExternalRuntimeName')
  setPropertyRef(schema, 'agentSnapshot', 'JSON')
  setPropertyRef(schema, 'runtimeConfig', 'JSON')
  setPropertyGoName(schema, 'requestId', 'RequestID')
  setPropertyGoName(schema, 'sessionId', 'SessionID')
  setPropertyGoName(schema, 'runtimeConfig', 'RuntimeConfig')
  setPropertyGoName(schema, 'agentSnapshot', 'AgentSnapshot')
  setPropertyGoName(schema, 'resumeToken', 'ResumeToken')
  setPropertyEnumNames(schema, 'type', ['BridgeMessageTypeRun'])
  return schema
}

function bridgeControlMessageSchema() {
  const schema: JSONSchema = {
    type: 'object',
    required: ['type', 'requestId'],
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['abort', 'send', 'permissionDecision'] },
      requestId: { type: 'string' },
      message: { type: 'string' },
      permissionId: { type: 'string' },
      allowed: { type: 'boolean' },
      reason: { type: 'string' },
    },
  }
  setPropertyGoName(schema, 'requestId', 'RequestID')
  setPropertyGoName(schema, 'permissionId', 'PermissionID')
  setPropertyEnumNames(schema, 'type', [
    'BridgeMessageTypeAbort',
    'BridgeMessageTypeSend',
    'BridgeMessageTypePermissionDecision',
  ])
  return schema
}

function bridgeInventoryMessageSchema() {
  const schema = openApiSchema(RuntimeBridgeInventoryMessageSchema)
  setPropertyGoName(schema, 'requestId', 'RequestID')
  setPropertyGoName(schema, 'includeUsage', 'IncludeUsage')
  setPropertyGoName(schema, 'usageOnly', 'UsageOnly')
  setPropertyEnumNames(schema, 'type', ['BridgeMessageTypeInventory'])
  return schema
}

function bridgeErrorSchema() {
  return {
    type: 'object',
    required: ['message'],
    additionalProperties: false,
    properties: {
      message: { type: 'string' },
      code: { type: 'string' },
      details: {},
    },
  }
}

function bridgeOutputMessageSchema() {
  const schema: JSONSchema = {
    type: 'object',
    required: ['type'],
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['ready', 'runtime.event', 'provider.event', 'resumeToken', 'result', 'error'] },
      requestId: { type: 'string' },
      runtime: { $ref: '#/components/schemas/ExternalRuntimeName' },
      event: { $ref: '#/components/schemas/JSON' },
      result: { $ref: '#/components/schemas/JSON' },
      error: { $ref: '#/components/schemas/RuntimeBridgeError' },
      resumeToken: { type: 'string' },
    },
  }
  setPropertyRef(schema, 'runtime', 'ExternalRuntimeName')
  setPropertyRef(schema, 'event', 'JSON')
  setPropertyRef(schema, 'result', 'JSON')
  setPropertyRef(schema, 'error', 'RuntimeBridgeError')
  setPropertyGoName(schema, 'requestId', 'RequestID')
  setPropertyGoName(schema, 'resumeToken', 'ResumeToken')
  setPropertyEnumNames(schema, 'type', [
    'BridgeMessageTypeReady',
    'BridgeMessageTypeRuntimeEvent',
    'BridgeMessageTypeProviderEvent',
    'BridgeMessageTypeResumeToken',
    'BridgeMessageTypeResult',
    'BridgeMessageTypeError',
  ])
  return schema
}

function bridgeInventoryResultSchema() {
  const schema = openApiSchema(RuntimeBridgeInventoryResultSchema)
  setPropertyArrayRef(schema, 'runtimes', 'RuntimeBridgeInventoryRuntime')
  return schema
}

function bridgeInventoryRuntimeSchema() {
  const schema = openApiSchema(RuntimeInventoryEntrySchema)
  setPropertyRef(schema, 'runtime', 'ExternalRuntimeName')
  setPropertyArrayRef(schema, 'usageWindows', 'RuntimeBridgeUsageWindow')
  setPropertyGoName(schema, 'fallbackModels', 'FallbackModels')
  setPropertyGoName(schema, 'usageWindows', 'UsageWindows')
  setPropertyGoName(schema, 'limitedDetail', 'LimitedDetail')
  return schema
}

function sessionEventTypeSchema() {
  return {
    type: 'string',
    enum: SESSION_EVENT_TYPES,
    'x-enum-varnames': SESSION_EVENT_TYPES.map((type) => `EventType${goConstName(type)}`),
  }
}

function openApiSchema(schema: z.ZodType): JSONSchema {
  const jsonSchema = z.toJSONSchema(schema) as JSONSchema
  delete jsonSchema.$schema
  normalizeJSONSchema(jsonSchema)
  return jsonSchema
}

function normalizeJSONSchema(value: unknown) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) normalizeJSONSchema(item)
    return
  }
  const record = value as JSONSchema
  delete record.$defs
  delete record.propertyNames
  if (record.additionalProperties && typeof record.additionalProperties === 'object') {
    const additionalProperties = record.additionalProperties as JSONSchema
    if (Object.keys(additionalProperties).length === 0) {
      record.additionalProperties = true
    }
  }
  for (const item of Object.values(record)) normalizeJSONSchema(item)
}

function setPropertyRef(schema: JSONSchema, property: string, refName: string) {
  propertySchema(schema, property).$ref = `#/components/schemas/${refName}`
  for (const key of Object.keys(propertySchema(schema, property))) {
    if (key !== '$ref' && key.startsWith('x-') === false) delete propertySchema(schema, property)[key]
  }
}

function setPropertyArrayRef(schema: JSONSchema, property: string, refName: string) {
  const target = propertySchema(schema, property)
  target.type = 'array'
  target.items = { $ref: `#/components/schemas/${refName}` }
}

function setPropertyGoName(schema: JSONSchema, property: string, goName: string) {
  propertySchema(schema, property)['x-go-name'] = goName
}

function setPropertyEnumNames(schema: JSONSchema, property: string, names: string[]) {
  const target = propertySchema(schema, property)
  if (Object.hasOwn(target, 'const')) {
    target.enum = [target.const]
    delete target.const
  }
  target['x-enum-varnames'] = names
}

function propertySchema(schema: JSONSchema, property: string): JSONSchema {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`Schema has no properties object`)
  }
  const target = (properties as Record<string, JSONSchema>)[property]
  if (!target) {
    throw new Error(`Schema property ${property} not found`)
  }
  return target
}

function goConstName(value: string): string {
  return value
    .split(/[-._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function stableJSON(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function assertFilesCurrent(files: GeneratedTextFile[]) {
  const stale = []
  for (const file of files) {
    const existing = await readFile(file.path, 'utf8').catch(() => '')
    if (existing !== file.content) stale.push(path.relative(ROOT, file.path))
  }
  if (stale.length > 0) {
    throw new Error(`Runtime contract OpenAPI artifacts are out of date. Run: pnpm run contract:generate\n${stale.join('\n')}`)
  }
}

async function assertGeneratedGoCurrent(configPath: string, specPath: string, targetPath: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'enbor-contract-check-'))
  try {
    const tempOutput = path.join(dir, path.basename(targetPath))
    const tempConfig = path.join(dir, 'oapi-codegen.config.yaml')
    const config = await readFile(configPath, 'utf8')
    await writeFile(tempConfig, config.replace(/^output: .+$/m, `output: ${tempOutput}`))
    runOapiCodegen(tempConfig, specPath)
    const [expected, existing] = await Promise.all([readFile(tempOutput, 'utf8'), readFile(targetPath, 'utf8').catch(() => '')])
    if (expected !== existing) {
      throw new Error(`Generated Go contract is out of date. Run: pnpm run contract:generate\n${path.relative(ROOT, targetPath)}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function runOapiCodegen(configPath: string, specPath: string) {
  execFileSync('oapi-codegen', ['-config', configPath, specPath], { cwd: path.dirname(configPath), stdio: 'inherit' })
}

await main()
