import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const CI_GROUPS = [
  'quality',
  'application',
  'integration',
  'e2e',
  'build',
  'runner',
  'runtime',
  'packaging',
]

const documentation = /^(docs\/|README(?:\.|$)|CONTRIBUTING(?:\.|$)|CHANGELOG(?:\.|$)|LICENSE(?:\.|$))/
const globalConfiguration = [
  /^\.github\/workflows\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^go\.work(?:\.sum)?$/,
  /^(?:biome|eslint|playwright|tsconfig|vite|vitest|wrangler)(?:\.|$)/,
  /^\.dependency-cruiser\./,
  /^scripts\/(?!classify-ci-changes(?:\.test)?\.mjs$)/,
]

function emptyClassification() {
  return Object.fromEntries(CI_GROUPS.map((group) => [group, false]))
}

function enable(classification, ...groups) {
  for (const group of groups) classification[group] = true
}

export function classifyChanges(paths, { full = false } = {}) {
  const classification = emptyClassification()
  if (full) {
    enable(classification, ...CI_GROUPS)
    return classification
  }

  for (const path of paths) {
    if (!path || documentation.test(path)) continue

    if (globalConfiguration.some((pattern) => pattern.test(path))) {
      enable(classification, ...CI_GROUPS)
      continue
    }

    if (/^server\//.test(path)) {
      enable(classification, 'quality', 'application', 'integration', 'e2e', 'build')
    } else if (/^src\//.test(path)) {
      enable(classification, 'quality', 'application', 'e2e', 'build')
    } else if (/^shared\//.test(path)) {
      enable(classification, 'quality', 'application', 'integration', 'e2e', 'build')
    } else if (/^migrations\//.test(path)) {
      enable(classification, 'application', 'integration', 'e2e', 'build')
    } else if (/^e2e\//.test(path)) {
      enable(classification, 'quality', 'e2e')
    } else if (/^spec\//.test(path)) {
      enable(classification, 'quality')
    } else if (/^public\//.test(path)) {
      enable(classification, 'quality', 'e2e', 'build')
    } else if (/^packages\/runtime-bridge\//.test(path)) {
      enable(classification, 'quality', 'application', 'build', 'runner', 'runtime', 'packaging')
    } else if (/^packages\/runtime-contracts\//.test(path)) {
      enable(
        classification,
        'quality',
        'application',
        'integration',
        'e2e',
        'build',
        'runner',
        'runtime',
        'packaging',
      )
    } else if (/^packages\//.test(path)) {
      enable(classification, 'quality', 'application', 'build')
    } else if (/^sdk\/(?:openapi\.json|go\/)/.test(path)) {
      enable(classification, 'application', 'runner', 'packaging')
    } else if (/^sdk\//.test(path)) {
      enable(classification, 'quality', 'application')
    } else if (/^cmd\/enbor-runner\//.test(path)) {
      enable(classification, 'runner', 'packaging')
      if (path === 'cmd/enbor-runner/pkg/runtimebridge/bundle.mjs') {
        enable(classification, 'quality', 'runtime')
      }
    } else if (/^\.goreleaser\.ya?ml$/.test(path)) {
      enable(classification, 'packaging')
    } else if (/^\.github\//.test(path)) {
      enable(classification, ...CI_GROUPS)
    } else {
      // Unknown paths fail open to the complete suite so new project areas cannot
      // silently bypass verification before their ownership is classified.
      enable(classification, ...CI_GROUPS)
    }
  }

  return classification
}

export function formatGitHubOutputs(classification) {
  return CI_GROUPS.map((group) => `${group}=${classification[group]}`).join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arguments_ = process.argv.slice(2)
  const full = arguments_.includes('--full')
  const inputPath = arguments_.find((argument) => !argument.startsWith('--'))
  const paths = inputPath ? readFileSync(inputPath, 'utf8').split(/\r?\n/) : []
  process.stdout.write(`${formatGitHubOutputs(classifyChanges(paths, { full }))}\n`)
}
