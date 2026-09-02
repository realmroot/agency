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
  it('defaults to the complete AMA runtime tool set', () => {
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
      allowedTools: 'Tool is not supported by the AMA runtime: repo.delete',
    })
  })

  it('rejects secret-looking tool names', () => {
    expect(validateAllowedTools(['raw-secret-token'])).toEqual({
      allowedTools: 'Tool is not supported by the AMA runtime: raw-secret-token',
    })
  })

  it('accepts supported sandbox tools', () => {
    expect(validateAllowedTools(['read', 'bash', 'fetch'])).toBeNull()
  })
})

describe('[spec: agents/validation] validateSkills', () => {
  it('requires a stable source@skill reference', () => {
    expect(validateSkills(['missing-style'])).toMatchObject({ skills: expect.stringContaining('stable') })
    expect(validateSkills(['ama@code review'])).toMatchObject({ skills: expect.any(String) })
    expect(validateSkills(['ama@code-review'])).toBeNull()
    expect(validateSkills(['saltbo/downstream-service#codex/ama-runtime-integration@downstream-operator'])).toBeNull()
    expect(validateSkills(['ama#@code-review'])).toMatchObject({ skills: expect.any(String) })
    expect(validateSkills(['ama#bad ref@code-review'])).toMatchObject({ skills: expect.any(String) })
  })

  it('rejects secret-looking skills', () => {
    expect(validateSkills(['ama@raw-secret-token'])).toEqual({
      skills: 'Secret material must be stored in a vault.',
    })
  })
})

describe('[spec: agents/validation] validateSubagents', () => {
  const subagent = {
    name: 'reviewer',
    description: 'Reviews the work.',
    systemPrompt: 'Review the work.',
    model: null,
    allowedTools: ['read'],
    skills: [],
    mcpConnectors: [],
  }

  it('requires stable sub-agent names, descriptions, and system prompts', () => {
    expect(validateSubagents([{ ...subagent, name: 'has space' }])).toMatchObject({ subagents: expect.any(String) })
    expect(validateSubagents([{ ...subagent, description: '' }])).toEqual({
      subagents: 'Sub-agent description is required: reviewer',
    })
    expect(validateSubagents([{ ...subagent, systemPrompt: '' }])).toEqual({
      subagents: 'Sub-agent system prompt is required: reviewer',
    })
    expect(validateSubagents([subagent])).toBeNull()
  })

  it('rejects duplicate sub-agent names', () => {
    expect(validateSubagents([subagent, { ...subagent, model: 'qa' }])).toEqual({
      subagents: 'Sub-agent is configured more than once: reviewer',
    })
  })

  it('rejects invalid sub-agent tools and skills', () => {
    expect(validateSubagents([{ ...subagent, allowedTools: ['repo.delete'] }])).toEqual({
      subagents: 'Tool is not supported by the AMA runtime: repo.delete',
    })
    expect(validateSubagents([{ ...subagent, skills: ['missing-style'] }])).toEqual({
      subagents: 'Skill must be a stable <source>@<skill> reference: missing-style',
    })
  })

  it('rejects secret material inside sub-agents', () => {
    expect(validateSubagents([{ ...subagent, systemPrompt: 'raw-secret-token' }])).toEqual({
      subagents: 'Secret material must be stored in a vault.',
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
