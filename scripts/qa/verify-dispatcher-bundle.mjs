import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, lstatSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Reviewed against DEV v83 on 2026-09-07; see docs/qa/pr508-validacion-2026-09-07.md.
export const certifiedDispatcherFiles = Object.freeze({
  'deno.json': '95feb9ee585c58270f6f7149161261be68c5234c',
  'index.ts': '410ba33a81a8b69d3e3929f16dc55ed5d99c4804',
  'jspdf_edge.ts': 'e72e0524be72d89866c834c7892e1b3f5d5e7b5a',
  'pdf_logo.ts': 'c02b257afcaf7bc81db1346c769175388f33566b',
  'pdf_logo_embed.ts': '8b2a5fcfb08ef13147d5de7c62b865ea5ce61f62',
})
export function gitBlobSha(bytes) {
  const canonical = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
  return createHash('sha1').update(`blob ${canonical.length}\0`).update(canonical).digest('hex')
}
export function verifyDispatcherBundle(directory) {
  if (directory instanceof URL) directory = fileURLToPath(directory)
  assert.deepEqual(readdirSync(directory).sort(), Object.keys(certifiedDispatcherFiles).sort(), 'Dispatcher file inventory drifted')
  for (const [name, hash] of Object.entries(certifiedDispatcherFiles)) {
    const path = resolve(directory, name)
    assert.ok(lstatSync(path).isFile(), `Dispatcher ${name} must be a regular file`)
    assert.equal(gitBlobSha(readFileSync(path)), hash, `Dispatcher ${name} is not certified`)
  }
  return certifiedDispatcherFiles
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../../supabase/functions/notification-dispatcher/', import.meta.url))
  verifyDispatcherBundle(directory)
  assert.equal(process.env.EXPECTED_FUNCTION_BLOB, certifiedDispatcherFiles['index.ts'], 'Workflow index pin drifted')
  console.log(JSON.stringify(certifiedDispatcherFiles, null, 2))
}
