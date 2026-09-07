import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const expected = process.argv[2] === 'production' ? 'Flux' : 'Flux DEV'
const root = resolve('dist')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'))
const html = await readFile(resolve(root, 'index.html'), 'utf8')
assert.equal(manifest.name, expected, 'El ambiente del manifest debe coincidir con el build verificado')
assert.equal(manifest.id, '/')
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.prefer_related_applications, false)
assert.match(html, /rel="manifest"[^>]+href="\/manifest\.webmanifest"/)
assert.match(html, /name="theme-color"/)
assert.match(html, /name="apple-mobile-web-app-capable"[^>]+content="yes"/)
assert.equal(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'), true)
assert.equal(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'), true)
assert.equal(manifest.icons.some(icon => icon.purpose === 'maskable'), true)
const apple = html.match(/rel="apple-touch-icon"[^>]+href="([^"]+)"/)?.[1]
assert.ok(apple)
for (const icon of [...manifest.icons, { src: apple, sizes: '180x180' }]) {
  assert.match(icon.src, /^\/pwa\/[a-z0-9-]+\.png$/)
  assert.equal(icon.src.includes('flux-dev-'), expected === 'Flux DEV', 'El icono debe corresponder al ambiente')
  const png = await readFile(resolve(root, icon.src.slice(1)))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes)
}
console.log(`PASS: ${expected}; manifest, standalone, metadatos e iconos verificados en dist.`)
