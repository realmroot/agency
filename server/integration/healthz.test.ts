import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] GET /api/healthz [spec: api-contracts/health]', () => {
  it('returns ok as plain health probe text', async () => {
    const res = await SELF.fetch('https://example.com/api/healthz')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    await expect(res.text()).resolves.toBe('ok')
  })

  it('removes the old versioned health endpoint', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/health')

    expect(res.status).toBe(404)
  })
})
