import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CompanyCaptureContext } from '../components/ui/CompanyCaptureContext'
import contextCss from '../components/ui/CompanyCaptureContext.module.css?inline'

type Target = { host: HTMLElement; name: string | null; label: string }

// These are the existing company fields in the two embedded operational pages.
const COMPANY_SELECTORS = '#batchCompanyId, #createCompanyId, #directorCompanyId'

export function legacyModalCompany(dialog: Element, activeCompanyName: string | null) {
  const select = dialog.querySelector<HTMLSelectElement>(COMPANY_SELECTORS)
  return select
    ? { name: select.value ? select.selectedOptions[0]?.textContent?.trim() || null : null, label: 'Empresa' }
    : { name: activeCompanyName, label: 'Empresa activa' }
}

export function LegacyCompanyModalContexts({ doc, companyName }: { doc: Document | null; companyName: string | null }) {
  const [targets, setTargets] = useState<Target[]>([])

  useEffect(() => {
    if (!doc) { setTargets([]); return }
    const hosts = new Map<Element, HTMLElement>()
    const style = doc.createElement('style')
    style.textContent = contextCss + '\ndialog .modal-header > div:first-child { min-width: 0; }'
    doc.head.appendChild(style)

    function refresh() {
      const next: Target[] = []
      doc!.querySelectorAll('dialog .modal-header > div:first-child').forEach(header => {
        const dialog = header.closest('dialog')!
        let host = hosts.get(header)
        if (!host) {
          host = doc!.createElement('div')
          header.appendChild(host)
          hosts.set(header, host)
        }
        next.push({ host, ...legacyModalCompany(dialog, companyName) })
      })
      setTargets(previous => previous.length === next.length && previous.every((target, index) =>
        target.host === next[index].host && target.name === next[index].name && target.label === next[index].label,
      ) ? previous : next)
    }

    refresh()
    // Re-read programmatically selected values when a dialog opens, and options
    // loaded asynchronously. Rendering a portal does not change the target list.
    const observer = new MutationObserver(refresh)
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    doc.addEventListener('change', refresh)
    return () => {
      observer.disconnect()
      doc.removeEventListener('change', refresh)
      style.remove()
      hosts.forEach(host => host.remove())
    }
  }, [doc, companyName])

  return <>{targets.map((target, index) => createPortal(
    <CompanyCaptureContext name={target.name} label={target.label} />,
    target.host, String(index),
  ))}</>
}
