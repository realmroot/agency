type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface SerializedError {
  name: string
  message: string
  stack?: string
  cause?: SerializedError | JsonValue
  errors?: Array<SerializedError | JsonValue>
  details?: Record<string, JsonValue>
}

export type LogContext = Record<string, unknown>

const MAX_DEPTH = 4
const MAX_STRING_LENGTH = 4_000
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[-_]?key|credential|private[-_]?key)/i
const SENSITIVE_VALUE =
  /\b(Bearer\s+[A-Za-z0-9._~+/-]+=*|Basic\s+[A-Za-z0-9+/]+=*|[A-Za-z0-9_-]{43}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g

function truncate(value: string) {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value
}

function redactString(value: string) {
  return truncate(value.replace(SENSITIVE_VALUE, '[redacted]'))
}

function safeJsonValue(value: unknown, key = '', depth = 0, seen: WeakSet<object> = new WeakSet()): JsonValue {
  if (SENSITIVE_KEY.test(key)) {
    return '[redacted]'
  }
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  if (seen.has(value)) {
    return '[circular]'
  }
  if (depth >= MAX_DEPTH) {
    return '[max-depth]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((item) => safeJsonValue(item, key, depth + 1, seen))
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      safeJsonValue(entryValue, entryKey, depth + 1, seen),
    ]),
  )
}

function safeJsonObject(value: unknown): Record<string, JsonValue> {
  const json = safeJsonValue(value)
  return json && typeof json === 'object' && !Array.isArray(json) ? json : {}
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? redactString(value) : undefined
}

function serializePlainErrorObject(error: Record<string, unknown>, seen: WeakSet<object>): Record<string, JsonValue> {
  const entries = Object.entries(error).filter(([key]) => key !== 'cause' && key !== 'errors')
  return Object.fromEntries(entries.map(([key, value]) => [key, safeJsonValue(value, key, 1, seen)]))
}

export function serializeError(
  error: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): SerializedError | JsonValue {
  if (!(error instanceof Error)) {
    return safeJsonValue(error, '', depth, seen)
  }

  if (seen.has(error)) {
    return { name: error.name || 'Error', message: '[circular]' }
  }
  seen.add(error)

  const extra = serializePlainErrorObject(error as Error & Record<string, unknown>, seen)
  const serialized: SerializedError = {
    name: error.name || 'Error',
    message: redactString(error.message),
    ...(error.stack ? { stack: redactString(error.stack) } : {}),
    ...(Object.keys(extra).length > 0 ? { details: extra } : {}),
  }

  const cause = (error as Error & { cause?: unknown }).cause
  if (cause !== undefined && depth < MAX_DEPTH) {
    serialized.cause = serializeError(cause, depth + 1, seen)
  }
  if (error instanceof AggregateError && depth < MAX_DEPTH) {
    serialized.errors = error.errors.map((item) => serializeError(item, depth + 1, seen))
  }
  return serialized
}

function logErrorPayload(event: string, context: LogContext = {}) {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      timestamp: new Date().toISOString(),
      ...safeJsonObject(context),
    }),
  )
}

export function logError(event: string, error: unknown, context: LogContext = {}) {
  logErrorPayload(event, { ...context, error: serializeError(error) })
}

export function requestLogContext(request: Request, requestId: string): LogContext {
  const url = new URL(request.url)
  return {
    requestId,
    method: request.method,
    path: url.pathname,
    query: url.search || null,
    cfRay: request.headers.get('cf-ray'),
    userAgent: optionalString(request.headers.get('user-agent')),
    enborProjectId: optionalString(request.headers.get('x-ama-project-id')),
  }
}
