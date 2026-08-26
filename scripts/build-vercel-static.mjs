import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const output = resolve(root, '.vercel-static')
const appDist = resolve(root, 'app', 'dist')

const excluded = new Set([
  '.git',
  '.github',
  '.vercel',
  '.vercel-static',
  'api',
  'app',
  'node_modules',
  'scripts',
  'supabase',
  'vercel.json',
])

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue
  await cp(resolve(root, entry.name), resolve(output, entry.name), { recursive: true })
}

await cp(appDist, resolve(output, 'app'), { recursive: true })
