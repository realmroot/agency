// Ratchet gate for type-safety escape hatches that neither tsc nor Biome can
// catch on their own: `as unknown as` double casts and the
// `z.record(z.string(), z.unknown())` "JSON black hole" schema shape.
//
// Each pattern carries a baseline: the build fails if the live count exceeds it.
// As the type-safe-contracts refactor lands, lower the baselines — the end state
// is 0, at which point these patterns are effectively forbidden. Run with
// `--report` to print the current counts and per-file breakdown without failing.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SCAN_DIRS = ['server', 'shared']

interface Rule {
  id: string
  description: string
  pattern: RegExp
  baseline: number
}

// Baselines reflect non-test production code under server/ and shared/.
// Lower them as the refactor removes escapes; never raise them.
const RULES: Rule[] = [
  {
    id: 'as-unknown-as',
    description: 'Double cast `as unknown as` bypasses the type checker entirely.',
    pattern: /\bas unknown as\b/g,
    baseline: 0,
  },
  {
    id: 'json-blackhole',
    description: 'Contract-less `z.record(z.string(), z.unknown())` schema shape.',
    pattern: /z\.record\(z\.string\(\),\s*z\.unknown\(\)\)/g,
    // Counts the per-file `JsonObjectSchema` const, a proxy for opaque shapes.
    // Opaque field usages dropped sharply this pass (lastError, pricing, policy
    // docs, agent policies, resourceLimits, session env); the remaining consts
    // back legitimately freeform fields such as metadata and runtimeConfig.
    baseline: 14,
  },
]

function isProductionTs(path: string): boolean {
  return (
    path.endsWith('.ts') &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.test.tsx') &&
    !path.includes(`${join('server', 'integration')}${path.includes('/') ? '/' : '\\'}`)
  )
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (isProductionTs(full)) {
      out.push(full)
    }
  }
  return out
}

const files = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
const report = process.argv.includes('--report')

let failed = false
for (const rule of RULES) {
  const hits: { file: string; count: number }[] = []
  let total = 0
  for (const file of files) {
    const matches = readFileSync(file, 'utf8').match(rule.pattern)
    if (matches) {
      hits.push({ file: relative(ROOT, file), count: matches.length })
      total += matches.length
    }
  }
  const status = total > rule.baseline ? '❌' : total < rule.baseline ? '⤵️ ' : '✅'
  console.log(`${status} ${rule.id}: ${total} (baseline ${rule.baseline}) — ${rule.description}`)
  if (report || total > rule.baseline) {
    for (const hit of hits.sort((a, b) => b.count - a.count)) {
      console.log(`     ${hit.count}  ${hit.file}`)
    }
  }
  if (total > rule.baseline) {
    failed = true
  }
  if (total < rule.baseline) {
    console.log(`     baseline can be lowered to ${total} in scripts/check-type-escapes.ts`)
  }
}

if (failed) {
  console.error('\nType-escape ratchet failed: new escapes were introduced above the baseline.')
  process.exit(1)
}
