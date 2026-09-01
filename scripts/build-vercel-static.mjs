import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const output = resolve(root, '.vercel-static')
const appDist = resolve(root, 'app', 'dist')
const legacyOutput = resolve(output, 'legacy')

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
await mkdir(legacyOutput, { recursive: true })

// Conserva el sitio vanilla completo como rollback explícito. Sus referencias
// relativas siguen resolviendo dentro de /legacy; /legacy/api/* se reescribe a
// las funciones canónicas /api/* desde vercel.json.
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue
  await cp(resolve(root, entry.name), resolve(legacyOutput, entry.name), { recursive: true })
}

// React ocupa la raíz y se convierte en la experiencia principal.
await cp(appDist, output, { recursive: true })

// Superficies públicas que ya circulan fuera del sistema y no pueden cambiar
// de URL. Los HTML internos antiguos se resuelven mediante redirects a React.
const publicRootEntries = [
  'assets',
  'solicitar.html',
  'solicitar.css',
  'solicitar.js',
  'solicitar-config.js',
  'solicitar-core.js',
  'provider-intake-privacy-dev.html',
  'approval_batch_quick_approve.html',
  'approval_batch_quick_approve.css',
  'approval_batch_quick_approve.js',
]

for (const entry of publicRootEntries) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true })
}
