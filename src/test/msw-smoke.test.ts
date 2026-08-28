import { describe, expect, it } from 'vitest'
import { api } from '@/lib/amarpc'
import { createCollection, resourceHandlers, server } from './msw'
import { agent } from './resource-fixtures'

// Foundation smoke: the REAL api client (not mocked) must reach MSW, send auth +
// project headers, and round-trip the {data, pagination} envelope + a create.
describe('web suite foundation (real api client + MSW)', () => {
  it('lists and creates agents through the real client against MSW', async () => {
    const agents = createCollection([agent({ id: 'agent_1', name: 'Seeded' })])
    server.use(
      ...resourceHandlers('agents', agents, (body, index) => {
        const input = body as { metadata: { name: string } }
        return agent({ id: `agent_${index + 2}`, name: input.metadata.name })
      }),
    )

    const page = await api.listAgents({})
    expect(page.data.map((a) => a.metadata.name)).toContain('Seeded')

    const created = await api.createAgent({
      metadata: { name: 'Created via MSW' },
      spec: { systemPrompt: 'Do the work.' },
    })
    expect(created.metadata.uid).toBeTruthy()

    const after = await api.listAgents({})
    expect(after.data.map((a) => a.metadata.name)).toContain('Created via MSW')
  })
})
