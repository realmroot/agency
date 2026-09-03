import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, 'public', '.well-known', 'agent-skills')
const destination = path.join(projectRoot, 'dist', 'client', '.well-known', 'agent-skills')

await mkdir(path.dirname(destination), { recursive: true })
await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })
