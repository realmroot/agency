import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

// The web suite drives the REAL AMA RPC client (src/lib/amarpc, a Hono `hc` RPC client
// over relative /api/v1/* fetches). MSW intercepts at the network boundary so the
// client's request building, error mapping, and refetch logic are exercised for
// real — never mock @/lib/amarpc. Handlers are backed by a small in-memory store so
// a create's post-mutation refetch converges instead of flapping on a fixed body.
export const server = setupServer(
  http.post('*/api/v1/sessions/:sessionId/socket-tickets', () =>
    HttpResponse.json(
      {
        ticket: 't'.repeat(43),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
      { status: 201 },
    ),
  ),
)

type CollectionItem = { id: string } | { metadata: { uid: string } }

function recordId(record: CollectionItem) {
  return 'id' in record ? record.id : record.metadata.uid
}

export interface Collection<T extends CollectionItem> {
  readonly items: Map<string, T>
  list(): T[]
  get(id: string): T | undefined
  put(record: T): T
  remove(id: string): void
  reset(): void
}

export function createCollection<T extends CollectionItem>(seed: T[] = []): Collection<T> {
  const items = new Map<string, T>(seed.map((record) => [recordId(record), record]))
  return {
    items,
    list: () => [...items.values()],
    get: (id) => items.get(id),
    put: (record) => {
      items.set(recordId(record), record)
      return record
    },
    remove: (id) => {
      items.delete(id)
    },
    reset: () => items.clear(),
  }
}

const listEnvelope = <T>(data: T[]) => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null as string | null },
})

const notFound = () => HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 })

// Standard REST handlers for a top-level collection that serves the canonical
// `{ data, pagination }` list envelope. `make` builds the stored record from a
// POST body (so created rows carry server-shaped fields the UI reads back).
export function resourceHandlers<T extends CollectionItem>(
  path: string,
  collection: Collection<T>,
  make: (body: Record<string, unknown>, index: number) => T,
) {
  const base = `*/api/v1/${path}`
  return [
    http.get(base, () => HttpResponse.json(listEnvelope(collection.list()))),
    http.post(base, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      const record = make(body, collection.items.size)
      collection.put(record)
      return HttpResponse.json(record, { status: 201 })
    }),
    http.get(`${base}/:id`, ({ params }) => {
      const record = collection.get(String(params.id))
      return record ? HttpResponse.json(record) : notFound()
    }),
    http.patch(`${base}/:id`, async ({ params, request }) => {
      const existing = collection.get(String(params.id))
      if (!existing) return notFound()
      const patch = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(collection.put({ ...existing, ...patch }))
    }),
    http.delete(`${base}/:id`, ({ params }) => {
      collection.remove(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

export { HttpResponse, http }
