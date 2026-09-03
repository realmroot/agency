// Governance lint (sibling to lint:arch): every scenario id in spec/*.feature for
// an ENFORCED capability must be referenced by a `[spec: <id>]` breadcrumb in at
// least one test file. The spec is the source of truth; tests trace back to it.
//
// Scope is opt-in per capability so unfinished fan-out work doesn't false-fail:
// add a capability to ENFORCED_CAPABILITIES once its spec + breadcrumbs land.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'node:fs/promises'

// Every capability is migrated to BDD-lite; the whole spec/ tree is enforced.
const ENFORCED_CAPABILITIES = new Set([
  'agents',
  'api-contracts',
  'audit',
  'auth',
  'environments',
  'governance',
  'identities',
  'mcp',
  'projects',
  'providers',
  'runners',
  'runtime',
  'sessions',
  'triggers',
  'usage',
  'vaults',
  'web-console',
])

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const SPEC_GLOB = 'spec/*.feature'
const TEST_GLOBS = [
  'server/**/*.test.ts',
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'shared/**/*.test.ts',
  'packages/runtime-bridge/src/**/*.test.ts',
  'cmd/enbor-runner/**/*_test.go',
  'workers/**/*.test.ts',
  'e2e/**/*.spec.ts',
]

const ID_PATTERN = /@([a-z0-9-]+)\/([a-z0-9-]+)\b/
const BREADCRUMB_PATTERN = /\[spec:\s*([a-z0-9-]+\/[a-z0-9-]+)\s*\]/g

const main = async () => {
  const specIds = await collectSpecIds()
  const referencedIds = await collectReferencedIds()

  const enforcedIds = [...specIds].filter((entry) => ENFORCED_CAPABILITIES.has(entry.capability))
  const missing = enforcedIds.filter((entry) => !referencedIds.has(entry.id))

  if (missing.length > 0) {
    console.error('Spec coverage lint failed — scenarios with no [spec: id] breadcrumb in any test:')
    for (const entry of missing) {
      console.error(`- ${entry.id}  (${entry.file}:${entry.line})`)
    }
    console.error(
      '\nAdd a `[spec: <id>]` breadcrumb to the home test for each scenario (see spec/README.md),',
    )
    console.error('or remove the scenario from the spec if it is no longer intended behaviour.')
    process.exit(1)
  }

  const enforced = [...ENFORCED_CAPABILITIES].sort().join(', ')
  console.log(
    `spec coverage OK — ${enforcedIds.length} enforced scenario ids traced (capabilities: ${enforced}).`,
  )
}

async function collectSpecIds() {
  const ids = new Set<string>()
  const entries: Array<{ id: string; capability: string; file: string; line: number }> = []
  for await (const file of glob(SPEC_GLOB, { cwd: repoRoot })) {
    const lines = readFileSync(join(repoRoot, file), 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('@')) return
      const match = trimmed.match(ID_PATTERN)
      if (!match) return
      const id = `${match[1]}/${match[2]}`
      if (ids.has(id)) {
        throw new Error(`Duplicate scenario id ${id} (${file}:${index + 1})`)
      }
      ids.add(id)
      entries.push({ id, capability: match[1], file, line: index + 1 })
    })
  }
  return entries
}

async function collectReferencedIds() {
  const referenced = new Set<string>()
  for (const pattern of TEST_GLOBS) {
    for await (const file of glob(pattern, { cwd: repoRoot })) {
      const content = readFileSync(join(repoRoot, file), 'utf8')
      for (const match of content.matchAll(BREADCRUMB_PATTERN)) {
        referenced.add(match[1])
      }
    }
  }
  return referenced
}

await main()
