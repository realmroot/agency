import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const OPENAPI_PATH = path.join(ROOT, 'sdk/openapi.json')
const SPEC_PATH = path.join(ROOT, 'sdk/spec/resources.json')

const openapi = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'))
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
const facades = normalizeFacades(spec)
const facadeExclusions = normalizeFacadeExclusions(spec)
const operations = collectOperations(openapi)
const pythonModules = collectPythonModules(path.join(ROOT, 'sdk/python/ama_sdk/api'))

validateSpec()
rewriteTypeScriptGeneratedAuthBoundary()
rewritePythonAuthenticatedClient()
writeFileSync(path.join(ROOT, 'sdk/typescript/src/client.ts'), generateTypeScriptClient())
writeFileSync(path.join(ROOT, 'sdk/go/ama/client.go'), generateGoClient())
writeFileSync(path.join(ROOT, 'sdk/python/ama_sdk/facade.py'), generatePythonFacade())
writeFileSync(
  path.join(ROOT, 'sdk/python/ama_sdk/__init__.py'),
  `"""A client library for accessing Any Managed Agents API."""\n\nfrom .client import AuthenticatedClient, Client\nfrom .facade import AmaApiError, AmaClient, AmaRunnerClient, JsonWebSocket, RunnerChannel, SessionStream, create_ama_client, create_ama_runner_client\n\n__all__ = (\n    "AuthenticatedClient",\n    "Client",\n    "AmaApiError",\n    "AmaClient",\n    "AmaRunnerClient",\n    "JsonWebSocket",\n    "RunnerChannel",\n    "SessionStream",\n    "create_ama_client",\n    "create_ama_runner_client",\n)\n`,
)

execFileSync('gofmt', ['-w', 'sdk/go/ama/client.go'], { cwd: ROOT, stdio: 'inherit' })

function rewriteTypeScriptGeneratedAuthBoundary() {
  const authPath = path.join(ROOT, 'sdk/typescript/src/generated/core/auth.gen.ts')
  writeFileSync(
    authPath,
    `// Generated authentication boundary for the Realmroot-native AMA Resource.

export type AuthToken = string | undefined

export interface Auth {
  in?: 'header' | 'query' | 'cookie'
  key?: string
  name?: string
  scheme?: never
  type: 'apiKey' | 'http'
}

export const getAuthToken = async (
  _auth: Auth,
  _callback: ((auth: Auth) => Promise<AuthToken> | AuthToken) | AuthToken,
): Promise<string | undefined> => {
  throw new Error('Raw token authentication is unsupported; use createAmaClient with a Realmroot DPoP authorizer')
}
`,
  )

  const sdkPath = path.join(ROOT, 'sdk/typescript/src/generated/sdk.gen.ts')
  const sdkSource = readFileSync(sdkPath, 'utf8')
  writeFileSync(sdkPath, sdkSource.replaceAll(/    security: \[[\s\S]*?\],\n(?=    url:)/g, ''))
}

function rewritePythonAuthenticatedClient() {
  const clientPath = path.join(ROOT, 'sdk/python/ama_sdk/client.py')
  const source = readFileSync(clientPath, 'utf8')
  const marker = '@define\nclass AuthenticatedClient:'
  const start = source.indexOf(marker)
  if (start < 0) {
    if (source.includes('class AuthenticatedClient(Client):')) return
    throw new Error('Generated Python AuthenticatedClient was not found')
  }
  const replacement = `@define
class AuthenticatedClient(Client):
    """Generated client backed by a request-aware Realmroot DPoP httpx.Auth implementation."""

    _auth: httpx.Auth = field(kw_only=True, alias="auth")

    def get_httpx_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                base_url=self._base_url,
                cookies=self._cookies,
                headers=self._headers,
                timeout=self._timeout,
                verify=self._verify_ssl,
                follow_redirects=self._follow_redirects,
                auth=self._auth,
                **self._httpx_args,
            )
        return self._client

    def get_async_httpx_client(self) -> httpx.AsyncClient:
        if self._async_client is None:
            self._async_client = httpx.AsyncClient(
                base_url=self._base_url,
                cookies=self._cookies,
                headers=self._headers,
                timeout=self._timeout,
                verify=self._verify_ssl,
                follow_redirects=self._follow_redirects,
                auth=self._auth,
                **self._httpx_args,
            )
        return self._async_client
`
  writeFileSync(clientPath, `${source.slice(0, start)}${replacement}`)
}

function normalizeFacades(document) {
  if (document.facades) {
    return document.facades
  }
  return { public: { resources: document.resources ?? [] } }
}

function normalizeFacadeExclusions(document) {
  const exclusions = document.facadeExclusions ?? []
  if (!Array.isArray(exclusions)) throw new Error('SDK facadeExclusions must be an array')
  return exclusions
}

function collectOperations(document) {
  const result = new Map()
  for (const [operationPath, methods] of Object.entries(document.paths)) {
    for (const [httpMethod, operation] of Object.entries(methods)) {
      if (!operation.operationId) continue
      const parameters = operation.parameters ?? []
      const pathParams = parameters.filter((param) => param.in === 'path')
      const queryParams = parameters.filter((param) => param.in === 'query')
      const bodyType = requestBodyType(operation)
      const success = successResponse(operation)
      result.set(operation.operationId, {
        id: operation.operationId,
        path: operationPath,
        method: httpMethod,
        tag: operation.tags?.[0] ?? 'default',
        pathParams,
        queryParams,
        bodyType,
        success,
        errorStatuses: Object.keys(operation.responses ?? {}).filter((status) => Number(status) >= 400),
      })
    }
  }
  return result
}

function requestBodyType(operation) {
  const schema = operation.requestBody?.content?.['application/json']?.schema
  return schemaRefName(schema)
}

function successResponse(operation) {
  const entries = Object.entries(operation.responses ?? {})
    .filter(([status]) => status === '101' || (Number(status) >= 200 && Number(status) < 300))
    .sort(([a], [b]) => Number(a) - Number(b))
  const withBody = entries.find(([, response]) => schemaRefName(response.content?.['application/json']?.schema))
  if (withBody) {
    return {
      status: withBody[0],
      type: schemaRefName(withBody[1].content?.['application/json']?.schema),
      field: `JSON${withBody[0]}`,
      empty: false,
    }
  }
  const empty = entries[0]
  if (!empty) throw new Error(`Operation ${operation.operationId} has no 2xx response`)
  return { status: empty[0], type: undefined, field: undefined, empty: true }
}

function schemaRefName(schema) {
  const ref = schema?.$ref
  return ref ? ref.split('/').at(-1) : undefined
}

function validateSpec() {
  const covered = new Set()
  for (const [facadeName, facade] of Object.entries(facades)) {
    const facadeCovered = new Set()
    for (const resource of facade.resources) {
      for (const method of resource.methods) {
        if (!operations.has(method.operationId)) {
          throw new Error(`SDK ${facadeName} facade references missing operationId: ${method.operationId}`)
        }
        if (facadeCovered.has(method.operationId)) {
          throw new Error(`SDK ${facadeName} facade references operationId twice: ${method.operationId}`)
        }
        facadeCovered.add(method.operationId)
        covered.add(method.operationId)
      }
    }
  }
  const excluded = new Set()
  for (const exclusion of facadeExclusions) {
    if (
      !exclusion ||
      typeof exclusion.operationId !== 'string' ||
      typeof exclusion.reason !== 'string' ||
      !exclusion.reason.trim()
    ) {
      throw new Error('Every SDK facade exclusion requires an operationId and non-empty reason')
    }
    if (!operations.has(exclusion.operationId)) {
      throw new Error(`SDK facade exclusion references missing operationId: ${exclusion.operationId}`)
    }
    if (covered.has(exclusion.operationId)) {
      throw new Error(`SDK operation cannot be both covered and excluded: ${exclusion.operationId}`)
    }
    if (excluded.has(exclusion.operationId)) {
      throw new Error(`SDK facade excludes operationId twice: ${exclusion.operationId}`)
    }
    excluded.add(exclusion.operationId)
  }
  const missing = [...operations.keys()]
    .filter((operationId) => !covered.has(operationId) && !excluded.has(operationId))
    .sort()
  if (missing.length > 0) {
    throw new Error(`SDK facades do not cover OpenAPI operations:\n${missing.join('\n')}`)
  }
}

function generateTypeScriptClient() {
  return `// Stable facades generated from sdk/spec/resources.json.
// The generated OpenAPI layer owns HTTP shapes; this file owns SDK shape.

import { createClient, createConfig } from './generated/client/index.js'
import * as ops from './generated/sdk.gen.js'
import type * as types from './generated/types.gen.js'

export interface AmaClientConfig {
  baseUrl: string
  projectId?: string
  headers?: Record<string, string>
  authorize?: (url: string, method: string) => Promise<{ accessToken: string; dpopProof: string }>
}

export class AmaApiError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly responseText: string,
    readonly body: unknown,
  ) {
    super(\`AMA API request failed\${status === undefined ? '' : \` with HTTP \${status}\`}\`)
    this.name = 'AmaApiError'
  }
}

async function unwrap<TData>(call: Promise<{ data: TData | undefined; error?: unknown; response?: Response }>): Promise<TData> {
  const { data, error, response } = await call
  if (response?.ok && error === undefined) {
    return data as TData
  }
  const body = error ?? data
  throw new AmaApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body)
}

export interface SessionStream {
  events: AsyncIterable<types.SessionEvent>
  send(message: types.SessionSocketClientMessage): Promise<void>
  backfill(options?: { cursor?: number; limit?: number; eventType?: string }): Promise<types.SessionSocketBackfillMessage>
  close(): void
}

export interface RunnerChannel {
  messages: AsyncIterable<types.RunnerChannelMessage>
  send(message: types.RunnerChannelMessage): Promise<void>
  close(): void
}

type SessionSocketServerMessage =
  | { type: 'event'; record: types.SessionEvent }
  | (types.SessionSocketBackfillMessage & { type: 'backfill' })
  | { type: 'runner_unavailable'; message: string }

function websocketURL(config: AmaClientConfig, path: string): URL {
  const url = new URL(path, config.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (config.projectId) {
    url.searchParams.set('x-ama-project-id', config.projectId)
  }
  return url
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function authenticatedWebSocket(config: AmaClientConfig, path: string): Promise<WebSocket> {
  if (!config.authorize) throw new Error('Realmroot DPoP authorizer is required for AMA WebSocket connections')
  const url = websocketURL(config, path)
  const authorization = await config.authorize(url.toString().replace(/^ws/, 'http'), 'GET')
  return new WebSocket(url.toString(), [
    'ama-dpop',
    \`ama-access.\${base64Url(authorization.accessToken)}\`,
    \`ama-proof.\${base64Url(authorization.dpopProof)}\`,
  ])
}

async function createSessionStream(config: AmaClientConfig, sessionId: string): Promise<SessionStream> {
  const socket = await authenticatedWebSocket(config, \`/api/v1/sessions/\${encodeURIComponent(sessionId)}/socket\`)
  const buffered: types.SessionEvent[] = []
  const waiters: Array<(result: IteratorResult<types.SessionEvent>) => void> = []
  const backfillWaiters = new Map<string, (response: types.SessionSocketBackfillMessage) => void>()
  let done = false

  const drainDone = () => {
    done = true
    for (const resolve of waiters.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : '') as SessionSocketServerMessage
    if (message.type === 'event') {
      const waiter = waiters.shift()
      if (waiter) {
        waiter({ value: message.record, done: false })
      } else {
        buffered.push(message.record)
      }
    } else if (message.type === 'backfill') {
      const resolve = message.requestId ? backfillWaiters.get(message.requestId) : undefined
      if (message.requestId) {
        backfillWaiters.delete(message.requestId)
      }
      resolve?.(message)
    }
  })
  socket.addEventListener('close', drainDone)

  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Session socket failed to open')))
  })

  let backfillSeq = 0
  return {
    events: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<types.SessionEvent>> {
            const value = buffered.shift()
            if (value !== undefined) {
              return Promise.resolve({ value, done: false })
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise((resolve) => waiters.push(resolve))
          },
        }
      },
    },
    async send(message) {
      await ready
      socket.send(JSON.stringify(message))
    },
    async backfill(options = {}) {
      await ready
      const requestId = \`bf_\${(backfillSeq += 1)}\`
      const response = new Promise<types.SessionSocketBackfillMessage>((resolve) => backfillWaiters.set(requestId, resolve))
      socket.send(JSON.stringify({ type: 'backfill', requestId, ...options }))
      return response
    },
    close() {
      socket.close()
    },
  }
}

async function createRunnerChannel(config: AmaClientConfig, runnerId: string): Promise<RunnerChannel> {
  const socket = await authenticatedWebSocket(config, \`/api/v1/runners/\${encodeURIComponent(runnerId)}/channel\`)
  const buffered: types.RunnerChannelMessage[] = []
  const waiters: Array<(result: IteratorResult<types.RunnerChannelMessage>) => void> = []
  let done = false

  const drainDone = () => {
    done = true
    for (const resolve of waiters.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : '') as types.RunnerChannelMessage
    const waiter = waiters.shift()
    if (waiter) {
      waiter({ value: message, done: false })
    } else {
      buffered.push(message)
    }
  })
  socket.addEventListener('close', drainDone)

  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Runner channel failed to open')))
  })

  return {
    messages: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<types.RunnerChannelMessage>> {
            const value = buffered.shift()
            if (value !== undefined) {
              return Promise.resolve({ value, done: false })
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise((resolve) => waiters.push(resolve))
          },
        }
      },
    },
    async send(message) {
      await ready
      socket.send(JSON.stringify(message))
    },
    close() {
      socket.close()
    },
  }
}

function createConfiguredClient(config: AmaClientConfig) {
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    if (config.authorize) {
      const authorization = await config.authorize(request.url, request.method)
      headers.set('authorization', \`DPoP \${authorization.accessToken}\`)
      headers.set('dpop', authorization.dpopProof)
    }
    return fetch(new Request(request, { headers }))
  }
  return createClient(
    createConfig({
      baseUrl: config.baseUrl,
      fetch: authenticatedFetch,
      headers: {
        ...(config.projectId ? { 'x-ama-project-id': config.projectId } : {}),
        ...config.headers,
      },
    }),
  )
}

${generateTypeScriptFactory('public', 'AmaClient', 'createAmaClient')}

${generateTypeScriptFactory('runner', 'AmaRunnerClient', 'createAmaRunnerClient')}
`
}

function generateTypeScriptFactory(facadeName, typeName, functionName) {
  const resources = facades[facadeName].resources.map((resource) => generateTypeScriptResource(resource)).join(',\n\n')
  return `export type ${typeName} = ReturnType<typeof ${functionName}>

export function ${functionName}(config: AmaClientConfig) {
  const client = createConfiguredClient(config)

  return {
    raw: client,

${indent(resources, 4)},
  }
}`
}

function generateTypeScriptResource(resource) {
  const methods = resource.methods.map((method) => generateTypeScriptMethod(method)).join(',\n')
  return `${resource.name}: {\n${indent(methods, 2)},\n}`
}

function generateTypeScriptMethod(method) {
  const operation = operations.get(method.operationId)
  if (operation.id === 'connectSessionSocket') {
    return `${method.name}: (sessionId: string): Promise<SessionStream> => createSessionStream(config, sessionId)`
  }
  if (operation.id === 'connectRunnerChannel') {
    return `${method.name}: (runnerId: string): Promise<RunnerChannel> => createRunnerChannel(config, runnerId)`
  }
  const pathParams = operation.pathParams.map((param) => `${param.name}: ${tsScalarType(param.schema)}`)
  const queryParam = operation.queryParams.length > 0 ? `query?: types.${pascal(operation.id)}Data['query']` : undefined
  const bodyParam = operation.bodyType ? `body: types.${operation.bodyType}` : undefined
  const optionsParam = operation.id === 'createTriggerRun' ? 'options?: { headers?: Record<string, string> }' : undefined
  const params = [...pathParams, bodyParam, queryParam, optionsParam].filter(Boolean).join(', ')
  const callParts = ['client']
  if (operation.pathParams.length > 0) {
    callParts.push(`path: { ${operation.pathParams.map((param) => param.name).join(', ')} }`)
  }
  if (operation.queryParams.length > 0) {
    callParts.push('query')
  }
  if (operation.bodyType) {
    callParts.push('body')
  }
  if (operation.id === 'createTriggerRun') {
    callParts.push('headers: options?.headers')
  }
  return `${method.name}: (${params}) => unwrap(ops.${operation.id}({ ${callParts.join(', ')} }))`
}

function tsScalarType(schema) {
  return schema?.type === 'integer' || schema?.type === 'number' ? 'number' : 'string'
}

function generateGoClient() {
  const publicFields = generateGoFields('public', '')
  const runnerFields = generateGoFields('runner', 'Runner')
  const publicAssignments = generateGoAssignments('public', '', 'client')
  const runnerAssignments = generateGoAssignments('runner', 'Runner', 'client')
  const services = [
    ...facades.public.resources.map((resource) => generateGoService(resource, '')),
    ...facades.runner.resources.map((resource) => generateGoService(resource, 'Runner')),
  ].join('\n')
  return `package ama\n\nimport (\n\t\"bytes\"\n\t\"context\"\n\t\"encoding/json\"\n\t\"errors\"\n\t\"fmt\"\n\t\"net/http\"\n\t\"net/url\"\n\t\"strings\"\n\n\t\"github.com/coder/websocket\"\n)\n\n// Regenerate the typed models and REST client (ama.gen.go) from the OpenAPI doc.\n// Requires oapi-codegen on PATH:\n//   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest\n// The config's paths (overlay, output) resolve from sdk/go, so run from there.\n// \`go generate\` invokes this from the package dir, hence the \`cd ..\`.\n//go:generate sh -c \"cd .. && oapi-codegen -config oapi-codegen.config.yaml ../openapi.json\"\n\ntype JSON = map[string]interface{}\n\ntype ClientConfig struct {\n\tBaseURL    string\n\tProjectID  string\n\tHeaders    map[string]string\n\tHTTPClient *http.Client\n}\n\ntype clientCore struct {\n\traw                 *ClientWithResponses\n\tbaseURL             string\n\tprojectID  string\n\theaders    map[string]string\n\thttpClient *http.Client\n}\n\ntype Client struct {\n\tcore *clientCore\n${publicFields}\n}\n\ntype RunnerClient struct {\n\tcore *clientCore\n${runnerFields}\n}\n\nfunc New(config ClientConfig) (*Client, error) {\n\tcore, err := newClientCore(config)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\tclient := &Client{core: core}\n${publicAssignments}\n\treturn client, nil\n}\n\nfunc NewRunner(config ClientConfig) (*RunnerClient, error) {\n\tcore, err := newClientCore(config)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\tclient := &RunnerClient{core: core}\n${runnerAssignments}\n\treturn client, nil\n}\n\nfunc newClientCore(config ClientConfig) (*clientCore, error) {\n\tif strings.TrimSpace(config.BaseURL) == \"\" {\n\t\treturn nil, fmt.Errorf(\"AMA base URL is required\")\n\t}\n\theaders := map[string]string{}\n\tfor key, value := range config.Headers {\n\t\theaders[key] = value\n\t}\n\topts := []ClientOption{\n\t\tWithRequestEditorFn(func(ctx context.Context, request *http.Request) error {\n\t\t\tif config.ProjectID != \"\" {\n\t\t\t\trequest.Header.Set(\"x-ama-project-id\", config.ProjectID)\n\t\t\t}\n\t\t\tfor key, value := range headers {\n\t\t\t\trequest.Header.Set(key, value)\n\t\t\t}\n\t\t\treturn nil\n\t\t}),\n\t}\n\thttpClient := config.HTTPClient\n\tif httpClient == nil {\n\t\thttpClient = http.DefaultClient\n\t}\n\topts = append(opts, WithHTTPClient(httpClient))\n\tbaseURL := strings.TrimRight(config.BaseURL, \"/\")\n\traw, err := NewClientWithResponses(baseURL, opts...)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\treturn &clientCore{raw: raw, baseURL: baseURL, projectID: config.ProjectID, headers: headers, httpClient: httpClient}, nil\n}\n\nfunc (c *Client) Raw() *ClientWithResponses {\n\treturn c.core.raw\n}\n\nfunc (c *RunnerClient) Raw() *ClientWithResponses {\n\treturn c.core.raw\n}\n\ntype APIError struct {\n\tStatus       int\n\tResponseText string\n\tBody         any\n}\n\nfunc (e *APIError) Error() string {\n\tif e.Status == 0 {\n\t\treturn \"AMA API request failed\"\n\t}\n\tif e.ResponseText != \"\" {\n\t\treturn fmt.Sprintf(\"AMA API request failed with HTTP %d: %s\", e.Status, e.ResponseText)\n\t}\n\treturn fmt.Sprintf(\"AMA API request failed with HTTP %d\", e.Status)\n}\n\nfunc StatusCode(err error) (int, bool) {\n\tvar apiErr *APIError\n\tif errors.As(err, &apiErr) {\n\t\treturn apiErr.Status, true\n\t}\n\treturn 0, false\n}\n\ntype JSONChannel interface {\n\tReadJSON(ctx context.Context, out any) error\n\tWriteJSON(ctx context.Context, value any) error\n\tClose(statusCode int, reason string) error\n}\n\ntype WebSocketChannel struct {\n\tConn *websocket.Conn\n}\n\nconst webSocketReadLimit = 16 << 20\n\nfunc (c *WebSocketChannel) ReadJSON(ctx context.Context, out any) error {\n\t_, data, err := c.Conn.Read(ctx)\n\tif err != nil {\n\t\treturn err\n\t}\n\treturn json.Unmarshal(data, out)\n}\n\nfunc (c *WebSocketChannel) WriteJSON(ctx context.Context, value any) error {\n\tdata, err := json.Marshal(value)\n\tif err != nil {\n\t\treturn err\n\t}\n\treturn c.Conn.Write(ctx, websocket.MessageText, data)\n}\n\nfunc (c *WebSocketChannel) Close(statusCode int, reason string) error {\n\treturn c.Conn.Close(websocket.StatusCode(statusCode), reason)\n}\n\nfunc (c *clientCore) dialWebSocket(ctx context.Context, path string) (JSONChannel, error) {\n\tendpoint, err := c.webSocketURL(path)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\theaders := http.Header{}\n\tfor key, value := range c.headers {\n\t\theaders.Set(key, value)\n\t}\n\tif c.projectID != \"\" {\n\t\theaders.Set(\"x-ama-project-id\", c.projectID)\n\t}\n\tconn, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPClient: c.httpClient, HTTPHeader: headers})\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\tconn.SetReadLimit(webSocketReadLimit)\n\treturn &WebSocketChannel{Conn: conn}, nil\n}\n\nfunc (c *clientCore) webSocketURL(path string) (string, error) {\n\tparsed, err := url.Parse(c.baseURL)\n\tif err != nil {\n\t\treturn \"\", err\n\t}\n\tswitch parsed.Scheme {\n\tcase \"https\":\n\t\tparsed.Scheme = \"wss\"\n\tcase \"http\":\n\t\tparsed.Scheme = \"ws\"\n\tdefault:\n\t\treturn \"\", fmt.Errorf(\"AMA base URL must use http or https\")\n\t}\n\tparsed.Path = path\n\tparsed.RawPath = \"\"\n\tparsed.RawQuery = \"\"\n\tparsed.Fragment = \"\"\n\treturn parsed.String(), nil\n}\n\n\n${services}\nfunc unwrap[T any](status int, responseBody []byte, data *T, errors ...*ErrorResponse) (*T, error) {\n\tif status >= 200 && status <= 299 && data != nil {\n\t\treturn data, nil\n\t}\n\treturn nil, newAPIError(status, responseBody, firstError(errors...))\n}\n\nfunc unwrapEmpty(status int, responseBody []byte, errors ...*ErrorResponse) error {\n\tif status >= 200 && status <= 299 {\n\t\treturn nil\n\t}\n\treturn newAPIError(status, responseBody, firstError(errors...))\n}\n\nfunc newAPIError(status int, responseBody []byte, response *ErrorResponse) *APIError {\n\tif response != nil {\n\t\treturn &APIError{Status: status, ResponseText: errorResponseText(response), Body: response}\n\t}\n\treturn &APIError{Status: status, ResponseText: strings.TrimSpace(string(responseBody)), Body: string(responseBody)}\n}\n\nfunc errorResponseText(response *ErrorResponse) string {\n\tif response == nil {\n\t\treturn \"\"\n\t}\n\tif response.Error.Message != \"\" {\n\t\treturn response.Error.Message\n\t}\n\treturn fmt.Sprintf(\"%v\", response.Error)\n}\n\nfunc firstError(errors ...*ErrorResponse) *ErrorResponse {\n\tfor _, err := range errors {\n\t\tif err != nil {\n\t\t\treturn err\n\t\t}\n\t}\n\treturn nil\n}\n`
}

function generateGoFields(facadeName, prefix) {
  return facades[facadeName].resources
    .map((resource) => `\t${goResourceName(resource.name)} ${goServiceName(resource.name, prefix)}`)
    .join('\n')
}

function generateGoAssignments(facadeName, prefix, variableName) {
  return facades[facadeName].resources
    .map((resource) => `\t${variableName}.${goResourceName(resource.name)} = ${goServiceName(resource.name, prefix)}{client: core}`)
    .join('\n')
}

function generateGoService(resource, prefix) {
  const serviceName = goServiceName(resource.name, prefix)
  const methods = [
    ...resource.methods.map((method) => generateGoMethod(serviceName, method)),
    ...(prefix === 'Runner' && resource.name === 'sessions' ? [generateGoCreateRawEventsMethod(serviceName)] : []),
  ].join('\n')
  return `type ${serviceName} struct {\n\tclient *clientCore\n}\n\n${methods}\n`
}

function generateGoMethod(serviceName, method) {
  const operation = operations.get(method.operationId)
  if (operation.id === 'connectSessionSocket') {
    return `func (s ${serviceName}) ${pascal(method.name)}(ctx context.Context, sessionID string) (JSONChannel, error) {\n\treturn s.client.dialWebSocket(ctx, \"/api/v1/sessions/\"+url.PathEscape(sessionID)+\"/socket\")\n}\n`
  }
  if (operation.id === 'connectRunnerChannel') {
    return `func (s ${serviceName}) ${pascal(method.name)}(ctx context.Context, runnerID string) (JSONChannel, error) {\n\treturn s.client.dialWebSocket(ctx, \"/api/v1/runners/\"+url.PathEscape(runnerID)+\"/channel\")\n}\n`
  }
  const rawName = `${pascal(operation.id)}WithResponse`
  const pathArgs = operation.pathParams.map((param) => `${goParamName(param.name)} ${goScalarType(param.schema)}`)
  const queryArg = operation.queryParams.length > 0 ? `params *${pascal(operation.id)}Params` : undefined
  const bodyArg = operation.bodyType ? `body ${operation.bodyType}` : undefined
  const args = ['ctx context.Context', ...pathArgs, queryArg, bodyArg].filter(Boolean).join(', ')
  const rawArgs = ['ctx', ...operation.pathParams.map((param) => goParamName(param.name))]
  if (operation.queryParams.length > 0) rawArgs.push('params')
  if (operation.bodyType) rawArgs.push('body')
  const errors = operation.errorStatuses.map((status) => `response.JSON${status}`).join(', ')
  const returnType = operation.success.empty ? 'error' : `(*${operation.success.type}, error)`
  const success = operation.success.empty
    ? `return unwrapEmpty(response.StatusCode(), response.Body${errors ? `, ${errors}` : ''})`
    : `return unwrap(response.StatusCode(), response.Body, response.${operation.success.field}${errors ? `, ${errors}` : ''})`
  return `func (s ${serviceName}) ${pascal(method.name)}(${args}) ${returnType} {\n\tresponse, err := s.client.raw.${rawName}(${rawArgs.join(', ')})\n\tif err != nil {\n\t\t${operation.success.empty ? 'return err' : 'return nil, err'}\n\t}\n\t${success}\n}\n`
}

function generateGoCreateRawEventsMethod(serviceName) {
  const operation = operations.get('createSessionEvents')
  const errors = operation.errorStatuses.map((status) => `response.JSON${status}`).join(', ')
  return `func (s ${serviceName}) CreateRawEvents(ctx context.Context, sessionID string, events []JSON) (*SessionEventsAccepted, error) {\n\tbody, err := json.Marshal(struct {\n\t\tEvents []JSON \`json:"events"\`\n\t}{Events: events})\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\tresponse, err := s.client.raw.CreateSessionEventsWithBodyWithResponse(\n\t\tctx,\n\t\tsessionID,\n\t\t"application/json",\n\t\tbytes.NewReader(body),\n\t)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\treturn unwrap(response.StatusCode(), response.Body, response.${operation.success.field}${errors ? `, ${errors}` : ''})\n}\n`
}

function goResourceName(name) {
  return pascal(name).replace(/Id/g, 'ID')
}

function goServiceName(name, prefix = '') {
  return `${prefix}${goResourceName(name)}Service`
}

function goParamName(name) {
  return name.replace(/Id$/, 'ID')
}

function goScalarType(schema) {
  return schema?.type === 'integer' ? 'int' : 'string'
}

function generatePythonFacade() {
  const imports = []
  for (const facade of Object.values(facades)) {
    for (const resource of facade.resources) {
      for (const method of resource.methods) {
        const operation = operations.get(method.operationId)
        if (isWebSocketOperation(operation.id)) {
          continue
        }
        const module = pythonModules.get(operation.id)
        if (!module) throw new Error(`Missing generated Python module for ${operation.id}`)
        imports.push(`from .api.${module.package} import ${module.name} as ${pythonModuleAlias(operation.id)}`)
      }
    }
  }
  const uniqueImports = [...new Set(imports)].sort()
  const resources = [
    ...facades.public.resources.map((resource) => generatePythonResource(resource, '')),
    ...facades.runner.resources.map((resource) => generatePythonResource(resource, 'Runner')),
  ].join('\n\n')
  const publicInitAssignments = generatePythonInitAssignments('public', '')
  const runnerInitAssignments = generatePythonInitAssignments('runner', 'Runner')
  return `from __future__ import annotations\n\nimport asyncio\nimport json\nfrom collections.abc import AsyncIterator, Callable\nfrom typing import Any\nfrom urllib.parse import quote, urlparse, urlunparse\n\nimport websockets\n\nfrom .client import Client\n${uniqueImports.join('\n')}\n\n\nclass AmaApiError(Exception):\n    def __init__(self, status: int | None, response_text: str, body: Any) -> None:\n        super().__init__(f\"AMA API request failed{'' if status is None else f' with HTTP {status}'}\")\n        self.status = status\n        self.response_text = response_text\n        self.body = body\n\n\nclass JsonWebSocket:\n    def __init__(self, url: str, headers: dict[str, str]) -> None:\n        self.url = url\n        self.headers = headers\n        self._socket: Any | None = None\n\n    async def connect(self) -> \"JsonWebSocket\":\n        self._socket = await websockets.connect(self.url, additional_headers=self.headers or None)\n        return self\n\n    async def __aenter__(self) -> \"JsonWebSocket\":\n        return await self.connect()\n\n    async def __aexit__(self, *args: Any) -> None:\n        await self.close()\n\n    def _connected(self) -> Any:\n        if self._socket is None:\n            raise RuntimeError(\"WebSocket is not connected; use 'async with' or await connect().\")\n        return self._socket\n\n    async def recv_json(self) -> Any:\n        return json.loads(await self._connected().recv())\n\n    async def send_json(self, value: Any) -> None:\n        await self._connected().send(json.dumps(value))\n\n    async def close(self, code: int = 1000, reason: str = \"\") -> None:\n        if self._socket is not None:\n            await self._socket.close(code=code, reason=reason)\n            self._socket = None\n\n\nclass RunnerChannel(JsonWebSocket):\n    async def messages(self) -> AsyncIterator[Any]:\n        while True:\n            yield await self.recv_json()\n\n    async def send(self, message: Any) -> None:\n        await self.send_json(message)\n\n\nclass SessionStream(JsonWebSocket):\n    def __init__(self, url: str, headers: dict[str, str]) -> None:\n        super().__init__(url, headers)\n        self._events: asyncio.Queue[Any | None] = asyncio.Queue()\n        self._messages: asyncio.Queue[Any | None] = asyncio.Queue()\n        self._backfills: dict[str, asyncio.Future[Any]] = {}\n        self._reader: asyncio.Task[None] | None = None\n        self._backfill_seq = 0\n\n    async def connect(self) -> \"SessionStream\":\n        await super().connect()\n        self._reader = asyncio.create_task(self._read_loop())\n        return self\n\n    async def _read_loop(self) -> None:\n        try:\n            async for message in self._connected():\n                socket_message = json.loads(message)\n                message_type = socket_message.get(\"type\") if isinstance(socket_message, dict) else None\n                if message_type == \"event\":\n                    await self._events.put(socket_message.get(\"record\"))\n                elif message_type == \"backfill\":\n                    request_id = socket_message.get(\"requestId\")\n                    future = self._backfills.pop(request_id, None)\n                    if future is not None and not future.done():\n                        future.set_result(socket_message)\n                else:\n                    await self._messages.put(socket_message)\n        except Exception as error:\n            for future in self._backfills.values():\n                if not future.done():\n                    future.set_exception(error)\n            self._backfills.clear()\n        finally:\n            await self._events.put(None)\n            await self._messages.put(None)\n\n    async def events(self) -> AsyncIterator[Any]:\n        while True:\n            event = await self._events.get()\n            if event is None:\n                return\n            yield event\n\n    async def messages(self) -> AsyncIterator[Any]:\n        while True:\n            message = await self._messages.get()\n            if message is None:\n                return\n            yield message\n\n    async def send(self, message: Any) -> None:\n        await self.send_json(message)\n\n    async def backfill(self, **options: Any) -> Any:\n        self._backfill_seq += 1\n        request_id = f\"bf_{self._backfill_seq}\"\n        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()\n        self._backfills[request_id] = future\n        await self.send_json({\"type\": \"backfill\", \"requestId\": request_id, **options})\n        return await future\n\n    async def close(self, code: int = 1000, reason: str = \"\") -> None:\n        if self._reader is not None:\n            self._reader.cancel()\n            self._reader = None\n        await super().close(code=code, reason=reason)\n\n\nclass _ClientCore:\n    def __init__(\n        self,\n        base_url: str,\n        project_id: str | None = None,\n        headers: dict[str, str] | None = None,\n        client: Client | None = None,\n        websocket_authorizer: Callable[[str, str], dict[str, str]] | None = None,\n    ) -> None:\n        merged_headers = dict(headers or {})\n        if project_id:\n            merged_headers[\"x-ama-project-id\"] = project_id\n        self.base_url = base_url\n        self.websocket_authorizer = websocket_authorizer\n        self.project_id = project_id\n        self.headers = merged_headers\n        self.client = client or Client(base_url=base_url, headers=merged_headers)\n\n    @property\n    def raw(self) -> Client:\n        return self.client\n\n\nclass AmaClient:\n    def __init__(\n        self,\n        base_url: str,\n        project_id: str | None = None,\n        headers: dict[str, str] | None = None,\n        client: Client | None = None,\n        websocket_authorizer: Callable[[str, str], dict[str, str]] | None = None,\n    ) -> None:\n        self._core = _ClientCore(base_url, project_id, headers, client, websocket_authorizer)\n${publicInitAssignments}\n\n    @property\n    def raw(self) -> Client:\n        return self._core.raw\n\n\nclass AmaRunnerClient:\n    def __init__(\n        self,\n        base_url: str,\n        project_id: str | None = None,\n        headers: dict[str, str] | None = None,\n        client: Client | None = None,\n        websocket_authorizer: Callable[[str, str], dict[str, str]] | None = None,\n    ) -> None:\n        self._core = _ClientCore(base_url, project_id, headers, client, websocket_authorizer)\n${runnerInitAssignments}\n\n    @property\n    def raw(self) -> Client:\n        return self._core.raw\n\n\ndef create_ama_client(\n    base_url: str,\n    project_id: str | None = None,\n    headers: dict[str, str] | None = None,\n    client: Client | None = None,\n    websocket_authorizer: Callable[[str, str], dict[str, str]] | None = None,\n) -> AmaClient:\n    return AmaClient(base_url=base_url, project_id=project_id, headers=headers, client=client, websocket_authorizer=websocket_authorizer)\n\n\ndef create_ama_runner_client(\n    base_url: str,\n    project_id: str | None = None,\n    headers: dict[str, str] | None = None,\n    client: Client | None = None,\n    websocket_authorizer: Callable[[str, str], dict[str, str]] | None = None,\n) -> AmaRunnerClient:\n    return AmaRunnerClient(base_url=base_url, project_id=project_id, headers=headers, client=client, websocket_authorizer=websocket_authorizer)\n\n\ndef _websocket_url(base_url: str, path: str) -> str:\n    parsed = urlparse(base_url.rstrip(\"/\") + path)\n    if parsed.scheme == \"https\":\n        scheme = \"wss\"\n    elif parsed.scheme == \"http\":\n        scheme = \"ws\"\n    else:\n        raise ValueError(\"AMA base URL must use http or https\")\n    return urlunparse((scheme, parsed.netloc, parsed.path, \"\", \"\", \"\"))\n\n\ndef _websocket_headers(owner: _ClientCore, url: str) -> dict[str, str]:\n    if owner.websocket_authorizer is None:\n        raise RuntimeError(\"Realmroot DPoP WebSocket authorizer is required\")\n    result = {**owner.headers, **owner.websocket_authorizer(url.replace(\"ws\", \"http\", 1), \"GET\")}\n    if owner.project_id:\n        result[\"x-ama-project-id\"] = owner.project_id\n    return result\n\n\ndef _unwrap(response: Any) -> Any:\n    status = int(response.status_code)\n    if 200 <= status <= 299:\n        return response.parsed\n    body = response.parsed\n    response_text = getattr(body, \"error\", None)\n    if response_text is not None and getattr(response_text, \"message\", None):\n        text = response_text.message\n    else:\n        text = response.content.decode(\"utf-8\", errors=\"replace\") if response.content else \"\"\n    raise AmaApiError(status, text, body)\n\n\n${resources}\n`
}

function generatePythonInitAssignments(facadeName, prefix) {
  return facades[facadeName].resources
    .map((resource) => `        self.${pythonName(resource.name)} = _${prefix}${pascal(resource.name)}Resource(self._core)`)
    .join('\n')
}

function generatePythonResource(resource, prefix) {
  const methods = resource.methods.map((method) => generatePythonMethod(method)).join('\n\n')
  return `class _${prefix}${pascal(resource.name)}Resource:\n    def __init__(self, owner: _ClientCore) -> None:\n        self._owner = owner\n        self._client = owner.raw\n\n${indent(methods, 4)}`
}

function generatePythonMethod(method) {
  const operation = operations.get(method.operationId)
  if (operation.id === 'connectSessionSocket') {
    return `def ${pythonName(method.name)}(self, session_id: str) -> SessionStream:\n    url = _websocket_url(self._owner.base_url, f\"/api/v1/sessions/{quote(session_id)}/socket\")\n    return SessionStream(url, _websocket_headers(self._owner, url))`
  }
  if (operation.id === 'connectRunnerChannel') {
    return `def ${pythonName(method.name)}(self, runner_id: str) -> RunnerChannel:\n    url = _websocket_url(self._owner.base_url, f\"/api/v1/runners/{quote(runner_id)}/channel\")\n    return RunnerChannel(url, _websocket_headers(self._owner, url))`
  }
  const moduleAlias = pythonModuleAlias(operation.id)
  const pathArgs = operation.pathParams.map((param) => `${pythonName(param.name)}: ${pythonScalarType(param.schema)}`)
  const queryArg = operation.queryParams.length > 0 ? '**query: Any' : undefined
  const bodyArg = operation.bodyType ? 'body: Any' : undefined
  const args = ['self', ...pathArgs, bodyArg, queryArg].filter(Boolean).join(', ')
  const callArgs = operation.pathParams.map((param) => `${pythonName(param.name)}=${pythonName(param.name)}`)
  callArgs.push('client=self._client')
  if (operation.bodyType) callArgs.push('body=body')
  if (operation.queryParams.length > 0) callArgs.push('**query')
  return `def ${pythonName(method.name)}(${args}) -> Any:\n    return _unwrap(${moduleAlias}.sync_detailed(${callArgs.join(', ')}))`
}

function isWebSocketOperation(operationId) {
  return operationId === 'connectSessionSocket' || operationId === 'connectRunnerChannel'
}

function collectPythonModules(apiDir) {
  const result = new Map()
  for (const packageName of readdirSync(apiDir)) {
    const packageDir = path.join(apiDir, packageName)
    if (!existsSync(path.join(packageDir, '__init__.py'))) continue
    for (const fileName of readdirSync(packageDir)) {
      if (!fileName.endsWith('.py') || fileName === '__init__.py') continue
      const operationId = camel(fileName.slice(0, -3))
      result.set(operationId, { package: packageName, name: fileName.slice(0, -3) })
    }
  }
  return result
}

function pythonModuleAlias(operationId) {
  return `${pythonName(operationId)}_api`
}

function pythonName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

function pythonScalarType(schema) {
  return schema?.type === 'integer' ? 'int' : 'str'
}

function pascal(value) {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/(?:^|\s)([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/\s/g, '')
}

function camel(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function indent(value, spaces) {
  const padding = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => (line ? `${padding}${line}` : line))
    .join('\n')
}
