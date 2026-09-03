import { parseEnborSandboxToolInput, parseEnborSandboxToolOutput } from '@enbor/runtime-contracts/tool-contracts'
import type { Env } from '../../env'
import { RuntimeTurnCancelledError } from '../../usecases/runtime/engine/errors'
import type { ToolExecutionInput, ToolExecutionResult, ToolExecutor } from '../../usecases/runtime/engine/ports'

// Worker-host adapter for the Enbor turn engine ToolExecutor port: executes sandbox
// tools against the Cloudflare Sandbox (or a deterministic in-process simulator
// in test mode). The canonical port types live in the engine/contracts; re-exported
// here so existing importers keep their paths.
export type { ToolExecutionInput, ToolExecutionResult, ToolExecutor }

function commandFromInput(input: Record<string, unknown>) {
  const command = input.command
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('bash requires a non-empty command')
  }
  return command
}

function filePathFromInput(input: Record<string, unknown>) {
  const path = input.path
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('sandbox file operations require a non-empty path')
  }
  if (path.split('/').includes('..')) {
    throw new Error('sandbox file paths must stay under /workspace')
  }
  // Models address files both ways; accept absolute paths inside /workspace.
  if (path.startsWith('/')) {
    if (path !== '/workspace' && !path.startsWith('/workspace/')) {
      throw new Error('sandbox file paths must stay under /workspace')
    }
    return path
  }
  return `/workspace/${path}`
}

function textFromInput(input: Record<string, unknown>) {
  const content = input.content
  if (typeof content !== 'string') {
    throw new Error('write requires string content')
  }
  return content
}

function urlFromInput(input: Record<string, unknown>) {
  const url = input.url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error('fetch requires an http(s) url')
  }
  return url
}

function optionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`)
  }
  return value
}

function timeoutFromInput(input: Record<string, unknown>, fallbackMs: number) {
  if (input.timeout === undefined) {
    return fallbackMs
  }
  if (typeof input.timeout !== 'number' || !Number.isFinite(input.timeout) || input.timeout <= 0) {
    throw new Error('bash timeout must be a positive number of milliseconds')
  }
  return Math.min(input.timeout, fallbackMs)
}

function patternFromInput(input: Record<string, unknown>) {
  const pattern = input.pattern
  if (typeof pattern !== 'string' || !pattern.trim()) {
    throw new Error('search tools require a non-empty pattern')
  }
  return pattern
}

function findPatternFromInput(input: Record<string, unknown>) {
  const pattern = input.pattern
  if (typeof pattern === 'string' && pattern.trim()) {
    return pattern
  }
  return undefined
}

function findGlobFromInput(input: Record<string, unknown>) {
  const glob = input.glob
  if (typeof glob === 'string' && glob.trim()) {
    return glob
  }
  return undefined
}

function queryFromInput(input: Record<string, unknown>) {
  const query = input.query
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('web_search requires a non-empty query')
  }
  return query.trim()
}

function limitFromInput(input: Record<string, unknown>, fallback: number) {
  return optionalPositiveInteger(input.limit, 'limit') ?? fallback
}

function lineWindow(content: string, input: Record<string, unknown>) {
  const offset = optionalPositiveInteger(input.offset, 'offset') ?? 0
  const limit = optionalPositiveInteger(input.limit, 'limit')
  if (offset === 0 && limit === undefined) {
    return content
  }
  const lines = content.split(/\r?\n/)
  return lines.slice(offset, limit === undefined ? undefined : offset + limit).join('\n')
}

function editsFromInput(input: Record<string, unknown>) {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error('edit requires at least one edit')
  }
  return input.edits.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('edit entries must be objects')
    }
    const edit = entry as Record<string, unknown>
    if (typeof edit.oldText !== 'string' || !edit.oldText) {
      throw new Error('edit oldText must be a non-empty string')
    }
    if (typeof edit.newText !== 'string') {
      throw new Error('edit newText must be a string')
    }
    return { oldText: edit.oldText, newText: edit.newText }
  })
}

function applyEdits(content: string, input: Record<string, unknown>) {
  let next = content
  for (const edit of editsFromInput(input)) {
    if (!next.includes(edit.oldText)) {
      throw new Error('edit oldText was not found')
    }
    next = next.replace(edit.oldText, edit.newText)
  }
  return next
}

function sandboxExecOutput(value: unknown) {
  if (!value || typeof value !== 'object') {
    return { stdout: String(value ?? ''), stderr: '', exitCode: 0 }
  }
  const record = value as Record<string, unknown>
  return {
    stdout: typeof record.stdout === 'string' ? record.stdout : '',
    stderr: typeof record.stderr === 'string' ? record.stderr : '',
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : 0,
  }
}

function sandboxText(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value)
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value)
  }
  return String(value ?? '')
}

async function getSandboxBinding() {
  const { getSandbox } = await import('@cloudflare/sandbox')
  return getSandbox
}

// Parity with the self-hosted runner's per-command default (10 minutes).
const SANDBOX_EXEC_TIMEOUT_MS = 10 * 60_000
// Outbound fetches are bounded much tighter than commands: a stalled host
// must not consume the turn budget.
const SANDBOX_FETCH_TIMEOUT_MS = 90_000

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function globMatches(glob: string, path: string) {
  const normalizedGlob = glob.replaceAll('\\', '/')
  const normalizedPath = path.replaceAll('\\', '/').replace(/^\/workspace\//, '')
  const escaped = normalizedGlob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll('\0', '.*')
  return new RegExp(`^${escaped}$`).test(normalizedPath)
}

function shellPathFromInput(input: Record<string, unknown>) {
  return shellQuote(filePathFromInput({ path: typeof input.path === 'string' && input.path.trim() ? input.path : '.' }))
}

function grepCommand(input: Record<string, unknown>) {
  const args = ['rg', '--line-number', '--color', 'never']
  if (input.ignoreCase === true) args.push('--ignore-case')
  if (input.literal === true) args.push('--fixed-strings')
  if (typeof input.glob === 'string' && input.glob.trim()) args.push('--glob', shellQuote(input.glob))
  if (input.context !== undefined) args.push('--context', String(optionalPositiveInteger(input.context, 'context')))
  args.push('--max-count', String(limitFromInput(input, 200)))
  args.push(shellQuote(patternFromInput(input)), shellPathFromInput(input))
  return args.join(' ')
}

function findCommand(input: Record<string, unknown>) {
  const limit = limitFromInput(input, 200)
  const glob = findGlobFromInput(input)
  if (glob) {
    return `rg --files --glob ${shellQuote(glob)} ${shellPathFromInput(input)} | head -n ${limit}`
  }
  const pattern = findPatternFromInput(input)
  if (!pattern) {
    throw new Error('find requires pattern or glob')
  }
  return `find ${shellPathFromInput(input)} -type f -name ${shellQuote(`*${pattern}*`)} -print | head -n ${limit}`
}

function lsCommand(input: Record<string, unknown>) {
  const limit = limitFromInput(input, 200)
  return `find ${shellPathFromInput(input)} -maxdepth 1 -mindepth 1 -print | sort | head -n ${limit}`
}

function webSearchCommand(input: Record<string, unknown>) {
  const query = new URLSearchParams({ q: queryFromInput(input) }).toString()
  const limit = Math.min(limitFromInput(input, 20), 50)
  const url = `https://lite.duckduckgo.com/lite/?${query}`
  return [
    `curl -fsSL --max-time 30 ${shellQuote(url)}`,
    "sed -E 's/<[^>]*>/ /g; s/&amp;/\\&/g; s/&quot;/\"/g; s/&#39;/'\"'\"'/g'",
    "awk '{$1=$1; if (length($0) > 0) print}'",
    `head -n ${limit * 4}`,
  ].join(' | ')
}

export class CloudflareSandboxToolExecutor implements ToolExecutor {
  constructor(private readonly env: Env) {}

  async execute(input: ToolExecutionInput, signal?: AbortSignal): Promise<ToolExecutionResult> {
    // A cancelled turn must not start a new tool call: bail before acquiring the
    // sandbox so an aborted turn never spins one up.
    if (signal?.aborted) {
      throw new RuntimeTurnCancelledError()
    }
    const startedAt = Date.now()
    const toolInput = parseEnborSandboxToolInput(input.toolName, input.input)
    const sandbox = await this.sandbox(input.sandboxId)
    const output = await this.executeInSandbox(sandbox, { ...input, input: toolInput } as ToolExecutionInput)
    return {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      output: parseEnborSandboxToolOutput(input.toolName, output),
      error: null,
      durationMs: Date.now() - startedAt,
    }
  }

  async stop(sandboxId: string) {
    const sandbox = await this.sandbox(sandboxId)
    await sandbox.destroy()
  }

  private async sandbox(sandboxId: string) {
    const getSandbox = await getSandboxBinding()
    return getSandbox(this.env.SANDBOX, sandboxId, {
      enableDefaultSession: false,
      keepAlive: true,
      normalizeId: true,
    })
  }

  private async executeInSandbox(
    sandbox: Awaited<ReturnType<CloudflareSandboxToolExecutor['sandbox']>>,
    input: ToolExecutionInput,
  ) {
    // An AbortSignal cannot be passed to the Sandbox binding: it crosses a
    // Workers RPC boundary, which rejects with "AbortSignal serialization is
    // not enabled". A cancelled turn is instead handled by the pre-exec abort
    // check (no new tool calls start) plus stop() → sandbox.destroy(), which
    // tears down any in-flight command. The per-exec timeout bounds hangs.
    if (input.toolName === 'bash') {
      // Bounded: an unbounded hang (network stall, interactive prompt) would
      // otherwise consume the whole turn budget and strand the session.
      return sandboxExecOutput(
        await sandbox.exec(commandFromInput(input.input), {
          cwd: input.cwd ?? '/workspace',
          timeout: timeoutFromInput(input.input, SANDBOX_EXEC_TIMEOUT_MS),
        }),
      )
    }
    if (input.toolName === 'read') {
      const content = sandboxText(await sandbox.readFile(filePathFromInput(input.input), { encoding: 'utf-8' }))
      return { content: lineWindow(content, input.input) }
    }
    if (input.toolName === 'write') {
      await sandbox.writeFile(filePathFromInput(input.input), textFromInput(input.input), { encoding: 'utf-8' })
      return { ok: true }
    }
    if (input.toolName === 'edit') {
      const path = filePathFromInput(input.input)
      const original = sandboxText(await sandbox.readFile(path, { encoding: 'utf-8' }))
      const content = applyEdits(original, input.input)
      await sandbox.writeFile(path, content, { encoding: 'utf-8' })
      return { ok: true, path }
    }
    if (input.toolName === 'grep') {
      return sandboxExecOutput(
        await sandbox.exec(grepCommand(input.input), {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_EXEC_TIMEOUT_MS,
        }),
      )
    }
    if (input.toolName === 'find') {
      return sandboxExecOutput(
        await sandbox.exec(findCommand(input.input), {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_EXEC_TIMEOUT_MS,
        }),
      )
    }
    if (input.toolName === 'ls') {
      return sandboxExecOutput(
        await sandbox.exec(lsCommand(input.input), {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_EXEC_TIMEOUT_MS,
        }),
      )
    }
    if (input.toolName === 'fetch') {
      // Outbound network access happens from inside the sandbox so it is
      // subject to the sandbox network namespace, after the policy gate has
      // already approved the host.
      return sandboxExecOutput(
        await sandbox.exec(`curl -fsS --max-time 60 ${shellQuote(urlFromInput(input.input))}`, {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_FETCH_TIMEOUT_MS,
        }),
      )
    }
    if (input.toolName === 'web_search') {
      return sandboxExecOutput(
        await sandbox.exec(webSearchCommand(input.input), {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_FETCH_TIMEOUT_MS,
        }),
      )
    }
    throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
  }
}

// Per-sandbox simulated filesystem for AMA_RUNTIME_MODE=test: writes are
// readable back within the same sandbox, and stopping the sandbox destroys
// its state — mirroring the one-sandbox-per-session lifecycle.
const simulatedSandboxFiles = new Map<string, Map<string, string>>()

function simulatedSandboxFs(sandboxId: string) {
  let files = simulatedSandboxFiles.get(sandboxId)
  if (!files) {
    files = new Map()
    simulatedSandboxFiles.set(sandboxId, files)
  }
  return files
}

function simulatedExecOutput(command: string) {
  const echo = command.match(/^echo\s+(.+)$/)
  return {
    stdout: echo?.[1] ?? `simulated sandbox exec: ${command}`,
    stderr: '',
    exitCode: 0,
  }
}

export class TestToolExecutor implements ToolExecutor {
  async execute(input: ToolExecutionInput, signal?: AbortSignal): Promise<ToolExecutionResult> {
    // Parity with the cloud executor: a cancelled turn must not start a new tool
    // call. Existing callers pass no signal, so simulation behavior is unchanged.
    if (signal?.aborted) {
      throw new RuntimeTurnCancelledError()
    }
    if (
      input.toolName !== 'bash' &&
      input.toolName !== 'read' &&
      input.toolName !== 'write' &&
      input.toolName !== 'edit' &&
      input.toolName !== 'grep' &&
      input.toolName !== 'find' &&
      input.toolName !== 'ls' &&
      input.toolName !== 'fetch' &&
      input.toolName !== 'web_search'
    ) {
      throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
    }
    const startedAt = Date.now()
    const toolInput = parseEnborSandboxToolInput(input.toolName, input.input)
    const output = this.simulate({ ...input, input: toolInput } as ToolExecutionInput)
    return {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      output: parseEnborSandboxToolOutput(input.toolName, output),
      error: null,
      durationMs: Object.keys(output).length === 0 ? 0 : Math.max(1, Date.now() - startedAt),
    }
  }

  async stop(sandboxId: string) {
    simulatedSandboxFiles.delete(sandboxId)
  }

  // Deterministic sandbox behavior for callers that submit real tool inputs
  // instead of pre-baked outputs: commands produce bounded stdio, file writes
  // are readable back per sandbox, and fetches resolve without leaving the
  // test process.
  private simulate(input: ToolExecutionInput): Record<string, unknown> {
    const args = input.input as Record<string, unknown>
    if (input.toolName === 'bash') {
      return typeof args.command === 'string' ? simulatedExecOutput(args.command) : {}
    }
    if (input.toolName === 'write') {
      if (typeof args.path !== 'string') {
        return {}
      }
      const path = filePathFromInput(args)
      const content = textFromInput(args)
      simulatedSandboxFs(input.sandboxId).set(path, content)
      return { ok: true, path, bytes: content.length }
    }
    if (input.toolName === 'read') {
      if (typeof args.path !== 'string') {
        return {}
      }
      const path = filePathFromInput(args)
      const content = simulatedSandboxFs(input.sandboxId).get(path)
      if (content === undefined) {
        throw new Error(`Sandbox file not found: ${path}`)
      }
      return { content: lineWindow(content, args), path }
    }
    if (input.toolName === 'edit') {
      if (typeof args.path !== 'string') {
        return {}
      }
      const path = filePathFromInput(args)
      const content = simulatedSandboxFs(input.sandboxId).get(path)
      if (content === undefined) {
        throw new Error(`Sandbox file not found: ${path}`)
      }
      const next = applyEdits(content, args)
      simulatedSandboxFs(input.sandboxId).set(path, next)
      return { ok: true, path }
    }
    if (input.toolName === 'grep') {
      const pattern = patternFromInput(args)
      const limit = limitFromInput(args, 200)
      const literal = args.literal === true
      const ignoreCase = args.ignoreCase === true
      const matches: string[] = []
      for (const [path, content] of simulatedSandboxFs(input.sandboxId)) {
        const lines = content.split(/\r?\n/)
        for (const [index, line] of lines.entries()) {
          const haystack = ignoreCase ? line.toLowerCase() : line
          const needle = ignoreCase ? pattern.toLowerCase() : pattern
          const matched = literal ? haystack.includes(needle) : new RegExp(pattern, ignoreCase ? 'i' : '').test(line)
          if (matched) matches.push(`${path}:${index + 1}:${line}`)
          if (matches.length >= limit) break
        }
        if (matches.length >= limit) break
      }
      return { stdout: matches.join('\n'), stderr: '', exitCode: matches.length > 0 ? 0 : 1 }
    }
    if (input.toolName === 'find') {
      const pattern = findPatternFromInput(args)
      const glob = findGlobFromInput(args)
      if (!pattern && !glob) {
        throw new Error('find requires pattern or glob')
      }
      const limit = limitFromInput(args, 200)
      const paths = [...simulatedSandboxFs(input.sandboxId).keys()]
        .filter((path) => (glob ? globMatches(glob, path) : path.includes(pattern!)))
        .slice(0, limit)
      return { stdout: paths.join('\n'), stderr: '', exitCode: 0 }
    }
    if (input.toolName === 'ls') {
      const root = filePathFromInput({ path: typeof args.path === 'string' ? args.path : '.' })
      const prefix = root.endsWith('/') ? root : `${root}/`
      const limit = limitFromInput(args, 200)
      const entries = [...simulatedSandboxFs(input.sandboxId).keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) =>
          path.slice(0, path.indexOf('/', prefix.length) === -1 ? undefined : path.indexOf('/', prefix.length)),
        )
        .filter((path, index, all) => all.indexOf(path) === index)
        .slice(0, limit)
      return { stdout: entries.join('\n'), stderr: '', exitCode: 0 }
    }
    if (input.toolName === 'web_search') {
      return {
        stdout: `simulated web search: ${queryFromInput(args)}`,
        stderr: '',
        exitCode: 0,
      }
    }
    if (typeof args.url !== 'string') {
      return {}
    }
    const url = urlFromInput(args)
    return {
      stdout: `simulated fetch ${new URL(url).hostname} ok`,
      stderr: '',
      exitCode: 0,
    }
  }
}

export function toolExecutor(env: Env): ToolExecutor {
  return env.AMA_RUNTIME_MODE === 'test' ? new TestToolExecutor() : new CloudflareSandboxToolExecutor(env)
}
