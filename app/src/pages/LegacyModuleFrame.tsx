import { useEffect, useRef, useState } from 'react'
import { useCompany } from '../lib/company'
import s from './LegacyModuleFrame.module.css'

const EMBED_STYLES = `
  .sidebar,
  .topbar,
  .receipt-batch-skip { display: none !important; }
  .app-shell { display: block !important; height: 100vh !important; min-height: 0 !important; overflow: hidden !important; }
  .content { height: 100vh !important; min-height: 0 !important; margin: 0 !important; overflow: hidden !important; }
  .page { height: 100vh !important; min-height: 0 !important; }
  @media (max-width: 1040px) {
    .app-shell { height: 100vh !important; min-height: 0 !important; overflow: hidden !important; }
  }
`

interface LegacyModuleFrameProps {
  src: string
  title: string
}

export default function LegacyModuleFrame({ src, title }: LegacyModuleFrameProps) {
  const { companyId } = useCompany()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const frameSrc = companyId
    ? `${src}${src.includes('?') ? '&' : '?'}company_id=${encodeURIComponent(companyId)}`
    : src

  function prepareEmbeddedShell() {
    const doc = frameRef.current?.contentDocument
    if (!doc) return

    let style = doc.getElementById('flux-react-embed-style') as HTMLStyleElement | null
    if (!style) {
      style = doc.createElement('style')
      style.id = 'flux-react-embed-style'
      style.textContent = EMBED_STYLES
      doc.head.appendChild(style)
    }

    doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'dark'
    setReady(true)
  }

  useEffect(() => {
    setReady(false)
  }, [frameSrc])

  return (
    <section className={s.host} aria-label={title}>
      <iframe
        ref={frameRef}
        className={`${s.frame} ${ready ? s.frameReady : ''}`}
        src={frameSrc}
        title={title}
        onLoad={prepareEmbeddedShell}
      />
    </section>
  )
}
