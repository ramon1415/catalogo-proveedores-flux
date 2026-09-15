// Serve OCR code and the Spanish model from Flux's own origin. Receipt pixels
// stay in the browser; no OCR service or runtime CDN is contacted.
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'app/package.json'))
const output = resolve(root, 'app/public/ocr/tesseract-6.0.1-spa-1.0.0')
await mkdir(output, { recursive: true })

const packages = { 'tesseract.js': '6.0.1', 'tesseract.js-core': '6.0.0', '@tesseract.js-data/spa': '1.0.0' }
const directories = {}
for (const [name, version] of Object.entries(packages)) {
  const manifest = require.resolve(`${name}/package.json`)
  if (JSON.parse(await readFile(manifest, 'utf8')).version !== version) throw new Error(`OCR_VERSION_MISMATCH: ${name}`)
  directories[name] = dirname(manifest)
}
await copyFile(resolve(directories['tesseract.js'], 'dist/worker.min.js'), resolve(output, 'worker.min.js'))
for (const variant of ['', '-simd', '-lstm', '-simd-lstm']) {
  for (const extension of ['wasm', 'wasm.js']) {
    const name = `tesseract-core${variant}.${extension}`
    await copyFile(resolve(directories['tesseract.js-core'], name), resolve(output, name))
  }
}
await copyFile(resolve(directories['@tesseract.js-data/spa'], '4.0.0_best_int/spa.traineddata.gz'), resolve(output, 'spa.traineddata.gz'))
for (const [name, license, target] of [['tesseract.js', 'LICENSE.md', 'LICENSE-tesseract.js'], ['tesseract.js-core', 'LICENSE', 'LICENSE-tesseract-core']]) {
  await copyFile(resolve(directories[name], license), resolve(output, target))
}
console.log('Payroll OCR assets ready (local worker, core and Spanish model).')
