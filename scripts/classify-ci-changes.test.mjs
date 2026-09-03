import assert from 'node:assert/strict'
import test from 'node:test'

import { CI_GROUPS, classifyChanges } from './classify-ci-changes.mjs'

const enabled = (classification) => CI_GROUPS.filter((group) => classification[group])

test('documentation-only changes require no expensive suite', () => {
  assert.deepEqual(enabled(classifyChanges(['README.md', 'docs/infra/runner.md'])), [])
})

test('web changes select application checks without Runner checks', () => {
  assert.deepEqual(enabled(classifyChanges(['src/features/home.tsx'])), [
    'quality',
    'application',
    'e2e',
    'build',
  ])
})

test('server changes include real integration checks', () => {
  assert.deepEqual(enabled(classifyChanges(['server/routes/projects.ts'])), [
    'quality',
    'application',
    'integration',
    'e2e',
    'build',
  ])
})

test('Runner changes select native and release-package checks', () => {
  assert.deepEqual(enabled(classifyChanges(['cmd/ama-runner/cmd/root.go'])), ['runner', 'packaging'])
})

test('runtime bridge changes cover both Node and embedded Runner consumers', () => {
  assert.deepEqual(enabled(classifyChanges(['packages/runtime-bridge/src/main.ts'])), [
    'quality',
    'application',
    'build',
    'runner',
    'runtime',
    'packaging',
  ])
})

test('release configuration changes select packaging', () => {
  assert.deepEqual(enabled(classifyChanges(['.goreleaser.yaml'])), ['packaging'])
})

test('workflow and unknown changes fail open to the complete suite', () => {
  assert.deepEqual(enabled(classifyChanges(['.github/workflows/ci.yml'])), CI_GROUPS)
  assert.deepEqual(enabled(classifyChanges(['new-project-area/file.txt'])), CI_GROUPS)
})

test('nightly mode selects the complete suite', () => {
  assert.deepEqual(enabled(classifyChanges([], { full: true })), CI_GROUPS)
})
