import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

function runPreflight(results: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), 'enbor-identity-preflight-'))
  temporaryDirectories.push(directory)
  const wrangler = join(directory, 'wrangler')
  writeFileSync(wrangler, '#!/bin/sh\nprintf \'%s\' "$PREFLIGHT_FIXTURE"\n')
  chmodSync(wrangler, 0o755)
  return spawnSync(process.execPath, [resolve('scripts/identity-migration-preflight.mjs'), '--database', 'fixture'], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      PREFLIGHT_FIXTURE: JSON.stringify([{ results }]),
    },
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Identity migration preflight', () => {
  it('reports conflict categories and affected Agent/Trigger IDs without credential references', () => {
    const result = runPreflight([
      {
        category: 'shared_credential',
        agent_ids: 'agent_1,agent_2',
        source_ids: 'agent:agent_1,agent:agent_2',
        resource_id: null,
        detail: 'Realmroot credential is used by multiple Enbor Agents',
      },
      {
        category: 'trigger_runtime_mismatch',
        agent_ids: 'agent_1',
        source_ids: 'trigger:trigger_7',
        resource_id: 'trigger_7',
        detail: 'Active Trigger runtime codex conflicts with migrated Identity runtime enbor',
      },
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('shared_credential')
    expect(result.stderr).toContain('agent_1,agent_2')
    expect(result.stderr).toContain('trigger_runtime_mismatch')
    expect(result.stderr).toContain('trigger_7')
    expect(`${result.stdout}${result.stderr}`).not.toContain('enbor://vaults/')
    expect(`${result.stdout}${result.stderr}`).not.toContain('credentialRef')
  })

  it('exits successfully when no migration conflicts are found', () => {
    const result = runPreflight([])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no conflicts found')
    expect(result.stderr).toBe('')
  })
})
