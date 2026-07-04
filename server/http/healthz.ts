import { Hono } from 'hono'
import type { Env } from '../env'

const healthz = new Hono<{ Bindings: Env }>()

healthz.get('/', (c) => c.text('ok'))

export default healthz
