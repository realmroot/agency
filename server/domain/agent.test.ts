import { describe, expect, it } from 'vitest'
import {
  defaultAllowedTools,
  hasSecretMaterial,
  nextVersionNumber,
  validateAllowedTools,
  validateSkills,
  validateSubagents,
} from './agent'

describe('[spec: agents/tool-contract] validateAllowedTools', () => {
  it('defaults to the complete Enbor runtime tool set', () => {
    expect(defaultAllowedTools()).toEqual([
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'fetch',
      'web_search',
    ])
  })

  it('rejects duplicate tool names', () => {
    expect(validateAllowedTools(['read', 'read'])).toEqual({
      allowedTools: 'Tool is listed more than once: read',
    })
  })

  it('rejects unsupported tool names', () => {
    expect(validateAllowedTools(['repo.delete'])).toEqual({
      allowedTools: 'Tool is not supported by the Enbor runtime: repo.delete',
    })
  })

  it('rejects secret-looking tool names', () => {
    expect(validateAllowedTools(['raw-secret-token'])).toEqual({
      allowedTools: 'Tool is not supported by the Enbor runtime: raw-secret-token',
    })
  })

  it('accepts supported sandbox tools', () => {
    expect(validateAllowedTools(['read', 'bash', 'fetch'])).toBeNull()
  })
})

describe('[spec: agents/validation] validateSkills', () => {
  it('requires a stable source@skill reference', () => {
    expect(validateSkills(['missing-style'])).toMatchObject({ skills: expect.stringContaining('stable') })
    expect(validateSkills(['enbor@code review'])).toMatchObject({ skills: expect.any(String) })
    expect(validateSkills(['enbor@code-review'])).toBeNull()
    expect(validateSkills(['saltbo/downstream-service#codex/enbor-runtime-integration@downstream-operator'])).toBeNull()
    expect(validateSkills(['enbor#@code-review'])).toMatchObject({ skills: expect.any(String) })
    expect(validateSkills(['enbor#bad ref@code-review'])).toMatchObject({ skills: expect.any(String) })
  })

  it('rejects secret-looking skills', () => {
    expect(validateSkills(['enbor@raw-secret-token'])).toEqual({
      skills: 'Secret material must be stored in a vault.',
    })
  })
})

describe('[spec: agents/validation] validateSubagents', () => {
  const subagent = {
    agentId: 'agent_reviewer',
    name: 'reviewer',
  }

  it('requires stable names and Agent resource references', () => {
    expect(validateSubagents([{ ...subagent, name: 'has space' }])).toMatchObject({ subagents: expect.any(String) })
    expect(validateSubagents([{ ...subagent, agentId: ' ' }])).toEqual({
      subagents: 'Sub-agent must reference an Agent resource: reviewer',
    })
    expect(validateSubagents([subagent])).toBeNull()
    expect(
      validateSubagents([
        { agentId: 'agent_slash', name: 'a/b' },
        { agentId: 'agent_dash', name: 'a-b' },
      ]),
    ).toBeNull()
  })

  it('rejects duplicate names and Agent references', () => {
    expect(validateSubagents([subagent, { ...subagent, agentId: 'agent_qa' }])).toEqual({
      subagents: 'Sub-agent is configured more than once: reviewer',
    })
    expect(validateSubagents([subagent, { ...subagent, name: 'quality-reviewer' }])).toEqual({
      subagents: 'Agent is referenced as a sub-agent more than once: agent_reviewer',
    })
  })

  it('[spec: agents/subagent-references] rejects a self-reference', () => {
    expect(validateSubagents([{ agentId: 'agent_parent', name: 'self' }], 'agent_parent')).toEqual({
      subagents: 'An Agent cannot reference itself as a sub-agent.',
    })
  })
})

describe('[spec: agents/validation] hasSecretMaterial', () => {
  it('detects secret-looking values and keys at any depth', () => {
    expect(hasSecretMaterial({ access_token: 'raw-secret' })).toBe(true)
    expect(hasSecretMaterial({ nested: [{ secretValue: 'x' }] })).toBe(true)
    expect(hasSecretMaterial('ghp_0123456789abcdef0123456789abcdef')).toBe(true)
    expect(hasSecretMaterial({ owner: 'platform' })).toBe(false)
  })
})

describe('[spec: agents/lifecycle] nextVersionNumber', () => {
  it('starts at 1 and increments', () => {
    expect(nextVersionNumber(null)).toBe(1)
    expect(nextVersionNumber(3)).toBe(4)
  })
})
