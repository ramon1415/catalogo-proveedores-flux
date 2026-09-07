// Local/preview builds stay visibly separate from the customer installation.
export function fluxManifest(production = false) {
  const pack = production ? 'flux' : 'flux-dev'
  return {
    id: '/', name: production ? 'Flux' : 'Flux DEV', short_name: production ? 'Flux' : 'Flux DEV',
    description: 'Solicitudes, aprobaciones y seguimiento de pagos.', lang: 'es-MX',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#172d29', theme_color: '#172d29', prefer_related_applications: false,
    icons: [
      { src: `/pwa/${pack}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/pwa/${pack}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/pwa/${pack}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

export function fluxPwaPlugin(production = false) {
  const manifest = fluxManifest(production)
  const source = JSON.stringify(manifest, null, 2) + '\n'
  const appleIcon = `/pwa/${production ? 'flux' : 'flux-dev'}-apple-180.png`
  return {
    name: 'flux-pwa-metadata',
    transformIndexHtml(html) {
      return {
        html: html.replace(/<link\s+rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" sizes="180x180" href="${appleIcon}" />`),
        tags: [
          { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'application-name', content: manifest.name }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: manifest.name }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'theme-color', content: manifest.theme_color }, injectTo: 'head' },
        ],
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/manifest.webmanifest') return next()
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(source)
      })
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source }) },
  }
}
