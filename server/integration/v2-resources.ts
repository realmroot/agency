import { SELF } from 'cloudflare:test'
import { dpopHeaders } from './auth'

export type ReadyAgent = {
  metadata: { uid: string }
  identity: { issuer: string; subject: string; username: string; runtime: 'ama' | 'claude-code' | 'codex' | 'copilot' }
  spec: { runtime: string; skills: string[] }
  status: { currentVersionId: string | null; ready: true }
}

async function request(path: string, authorization: string, projectId?: string, init: RequestInit = {}) {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, init.method ?? 'GET', path),
      ...(projectId ? { 'X-AMA-Project-ID': projectId } : {}),
      ...init.headers,
    },
  })
}

export async function createReadyAgent(
  authorization: string,
  input: {
    name?: string
    username?: string
    runtime?: 'ama' | 'claude-code' | 'codex' | 'copilot'
    systemPrompt?: string
    provider?: string | null
    model?: string | null
    skills?: string[]
    allowedTools?: string[]
    projectId?: string
  } = {},
): Promise<ReadyAgent> {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const response = await request('/api/v1/agents', authorization, input.projectId, {
    method: 'POST',
    headers: { 'Idempotency-Key': `agent-create-${suffix}` },
    body: JSON.stringify({
      username: input.username ?? `test-agent-${suffix}`,
      metadata: { name: input.name ?? `Test agent ${suffix}` },
      spec: {
        runtime: input.runtime ?? 'ama',
        systemPrompt: input.systemPrompt ?? 'Complete the assigned work.',
        provider: input.provider === undefined ? 'workers-ai' : input.provider,
        model:
          input.model === undefined
            ? (input.runtime ?? 'ama') === 'ama'
              ? '@cf/moonshotai/kimi-k2.6'
              : null
            : input.model,
        skills: input.skills ?? [],
        allowedTools: input.allowedTools ?? ['bash'],
      },
    }),
  })
  if (response.status !== 201) {
    throw new Error(`Expected Agent creation to return 201, got ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as ReadyAgent
}

export async function createIdentitySession(
  authorization: string,
  agent: ReadyAgent,
  input: { prompt?: string; projectId?: string } = {},
) {
  const response = await request('/api/v1/sessions', authorization, input.projectId, {
    method: 'POST',
    body: JSON.stringify({
      spec: { agentId: agent.metadata.uid },
      prompt: input.prompt ?? 'Complete the integration test task.',
    }),
  })
  if (response.status !== 201) {
    throw new Error(`Expected Session creation to return 201, got ${response.status}: ${await response.text()}`)
  }
  return response
}
