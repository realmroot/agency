import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { SessionEventSchema, type SessionEvent } from '@ama/runtime-contracts/session-events'
import {
  runtimeEventsFromSource,
  type RuntimeReplaySourceFormat,
} from '../packages/runtime-bridge/src/replay'
import type { AmaRuntimeEvent, RuntimeBridgeRunMessage } from '../packages/runtime-bridge/src/protocol'

type ExternalRuntimeName = RuntimeBridgeRunMessage['runtime']

type RebuildInput = {
  runtime?: ExternalRuntimeName
  sourcePath: string
  sourceFormat?: RuntimeReplaySourceFormat
  sessionId?: string
  eventsPath?: string
  workDir?: string
  home?: string
  dryRun?: boolean
  backup?: boolean
}

type RebuildResult = {
  targetPath: string
  backupPath?: string
  sessionId: string
  events: number
  firstType?: string
  lastType?: string
  dryRun: boolean
}

const RUNTIMES = new Set<ExternalRuntimeName>(['codex', 'claude-code', 'copilot'])
const SOURCE_FORMATS = new Set<RuntimeReplaySourceFormat>(['auto', 'ama-events', 'bridge-ndjson', 'provider-jsonl'])

export function rebuildSessionEvents(input: RebuildInput): RebuildResult {
  const targetPath = resolveTargetPath(input)
  const sessionId = input.sessionId ?? inferSessionId(targetPath)
  const events = runtimeEventsFromSource({
    sourcePath: input.sourcePath,
    sourceFormat: input.sourceFormat ?? 'auto',
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.home ? { home: input.home } : {}),
  })
  const baseCreatedAt = firstCreatedAt(targetPath) ?? new Date().toISOString()
  const records = buildSessionRecords(events, sessionId, baseCreatedAt)
  const result: RebuildResult = {
    targetPath,
    sessionId,
    events: records.length,
    dryRun: Boolean(input.dryRun),
  }
  if (records[0]?.type) result.firstType = records[0].type
  const lastType = records.at(-1)?.type
  if (lastType) result.lastType = lastType
  if (input.dryRun) return result
  mkdirSync(dirname(targetPath), { recursive: true })
  if ((input.backup ?? true) && existsSync(targetPath)) {
    const backupPath = `${targetPath}.bak-${timestampForPath()}`
    copyFileSync(targetPath, backupPath)
    result.backupPath = backupPath
  }
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  renameSync(tmpPath, targetPath)
  return result
}

export function buildSessionRecords(
  events: AmaRuntimeEvent[],
  sessionId: string,
  baseCreatedAt: string,
): SessionEvent[] {
  const startMs = Date.parse(baseCreatedAt)
  if (!Number.isFinite(startMs)) throw new Error(`Invalid base createdAt: ${baseCreatedAt}`)
  return events.map((event, index) => {
    const sequence = index + 1
    const record = {
      id: `event_rebuilt_${String(sequence).padStart(8, '0')}`,
      sessionId,
      sequence,
      createdAt: new Date(startMs + sequence).toISOString(),
      type: event.type,
      payload: event.payload,
    }
    return SessionEventSchema.parse(record) as SessionEvent
  })
}

export function resolveTargetPath(input: Pick<RebuildInput, 'eventsPath' | 'sessionId' | 'workDir'>): string {
  if (input.eventsPath) return resolve(input.eventsPath)
  if (!input.sessionId) throw new Error('Either --session-id or --events is required')
  return join(resolve(input.workDir ?? defaultWorkDir()), 'sessions', input.sessionId, 'events.jsonl')
}

function inferSessionId(eventsPath: string): string {
  const parts = eventsPath.split(/[\\/]/)
  const parent = parts.at(-2)
  if (!parent) throw new Error('Unable to infer session id from events path; pass --session-id')
  return parent
}

function defaultWorkDir(): string {
  if (process.env.AMA_RUNNER_WORK_DIR) return process.env.AMA_RUNNER_WORK_DIR
  if (process.env.XDG_STATE_HOME) return join(process.env.XDG_STATE_HOME, 'ama-runner', 'work')
  return join(process.env.HOME || homedir(), '.local', 'state', 'ama-runner', 'work')
}

function firstCreatedAt(targetPath: string): string | null {
  if (!existsSync(targetPath)) return null
  for (const line of readFileSync(targetPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const parsed = SessionEventSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data.createdAt : null
  }
  return null
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function usage(): string {
  return `Usage:
  pnpm exec tsx scripts/rebuild-session-events.ts --runtime <codex|claude-code|copilot> --source <provider.jsonl> --session-id <ama-session-id>

Options:
  --runtime <name>          Runtime for provider-jsonl sources: codex, claude-code, copilot
  --source <path>           Source JSONL path
  --source-format <format>  auto, ama-events, bridge-ndjson, provider-jsonl (default: auto)
  --session-id <id>         AMA session id. Default target is the runner store for this session.
  --events <path>           Exact target events.jsonl path. Session id is inferred from its parent directory unless --session-id is set.
  --work-dir <path>         AMA runner work dir. Defaults to $AMA_RUNNER_WORK_DIR or ~/.local/state/ama-runner/work
  --home <path>             Host home for provider replay helpers, used by Codex to find child sessions.
  --dry-run                 Build and validate without writing
  --no-backup               Replace target without backing up the existing file

Source formats:
  provider-jsonl  Raw runtime provider events mapped through AMA's runtime bridge mappers.
  bridge-ndjson   Captured runtime bridge stdout; runtime.event frames are extracted.
  ama-events      Existing AMA SessionEvent/AmaEvent JSONL; records are renumbered and rewritten.
`
}

function parseCli(): RebuildInput {
  const { values } = parseArgs({
    args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
    options: {
      runtime: { type: 'string' },
      source: { type: 'string' },
      'source-format': { type: 'string' },
      'session-id': { type: 'string' },
      events: { type: 'string' },
      'work-dir': { type: 'string' },
      home: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'no-backup': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(usage())
    process.exit(0)
  }
  if (!values.source) throw new Error('--source is required')
  const runtime = parseRuntime(values.runtime)
  const sourceFormat = parseSourceFormat(values['source-format'])
  return {
    sourcePath: resolve(values.source),
    ...(runtime ? { runtime } : {}),
    ...(sourceFormat ? { sourceFormat } : {}),
    ...(values['session-id'] ? { sessionId: values['session-id'] } : {}),
    ...(values.events ? { eventsPath: values.events } : {}),
    ...(values['work-dir'] ? { workDir: values['work-dir'] } : {}),
    ...(values.home ? { home: values.home } : {}),
    ...(values['dry-run'] !== undefined ? { dryRun: values['dry-run'] } : {}),
    backup: !values['no-backup'],
  }
}

function parseRuntime(value: string | undefined): ExternalRuntimeName | undefined {
  if (value === undefined) return undefined
  if (RUNTIMES.has(value as ExternalRuntimeName)) return value as ExternalRuntimeName
  throw new Error(`Unsupported runtime: ${value}`)
}

function parseSourceFormat(value: string | undefined): RuntimeReplaySourceFormat | undefined {
  if (value === undefined) return undefined
  if (SOURCE_FORMATS.has(value as RuntimeReplaySourceFormat)) return value as RuntimeReplaySourceFormat
  throw new Error(`Unsupported source format: ${value}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = rebuildSessionEvents(parseCli())
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
