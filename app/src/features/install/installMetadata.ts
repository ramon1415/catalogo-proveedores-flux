// The public login document never advertises a manifest. This is called only
// after the server authorizes the current account; cleanup runs on logout/switch.
export function enableInstallMetadata(doc: Document) {
  const elements: HTMLElement[] = []
  const manifest = doc.createElement('link')
  manifest.rel = 'manifest'
  manifest.crossOrigin = 'use-credentials'
  manifest.href = '/api/pwa'
  elements.push(manifest)
  const icon = doc.createElement('link')
  icon.rel = 'apple-touch-icon'; icon.href = '/pwa/flux-apple-180.png'; icon.sizes.value = '180x180'
  elements.push(icon)
  for (const [name, content] of Object.entries({
    'application-name': 'Flux', 'apple-mobile-web-app-title': 'Flux',
    'mobile-web-app-capable': 'yes', 'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default', 'theme-color': '#172d29',
  })) {
    const meta = doc.createElement('meta'); meta.name = name; meta.content = content; elements.push(meta)
  }
  elements.forEach(element => { element.dataset.fluxPwa = 'pilot'; doc.head.appendChild(element) })
  return () => elements.forEach(element => element.remove())
}
