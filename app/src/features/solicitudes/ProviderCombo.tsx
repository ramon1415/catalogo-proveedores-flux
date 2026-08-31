import { useEffect, useMemo, useRef, useState } from 'react'
import { normalize } from '../../lib/format'
import { proveedorLabel } from './logic'
import type { Proveedor } from './types'
import s from './Solicitudes.module.css'

// Combobox de proveedor con búsqueda NFD y navegación por teclado, fiel a
// initProviderCombo() / renderComboList() del vanilla. `withPlus` muestra el
// botón "+" (alta rápida) sólo en el modal de creación.
export function ProviderCombo({
  proveedores,
  value,
  search,
  onSelect,
  onPlus,
}: {
  proveedores: Proveedor[]
  value: string
  search: string
  onSelect: (id: string, label: string) => void
  onPlus?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [text, setText] = useState(search)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(search) }, [search])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  const filtered = useMemo(() => {
    const q = normalize(text)
    return proveedores
      .filter((p) => {
        const t = normalize([p.alias, p.nombre_completo, p.rfc].join(' '))
        return !q || t.includes(q)
      })
      .slice(0, 200)
  }, [proveedores, text])

  function pick(p: Proveedor) {
    const label = proveedorLabel(p)
    setText(label)
    onSelect(p.id, label)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && filtered[activeIndex]) pick(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={s.providerCombo} ref={wrapRef}>
      <div className={s.providerComboInput}>
        <input
          type="text"
          className={s.formControl}
          style={{ width: '100%' }}
          value={text}
          autoComplete="off"
          aria-autocomplete="list"
          placeholder="Escribe para buscar entre todos los proveedores (alias, razón social, RFC)…"
          onChange={(e) => { setText(e.target.value); setActiveIndex(-1); setOpen(true); onSelect('', e.target.value) }}
          onFocus={() => { if (!value) setOpen(true) }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul className={s.comboList} role="listbox">
            {filtered.length === 0 ? (
              <li className={s.comboEmpty}>Sin resultados</li>
            ) : (
              filtered.map((p, i) => (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={i === activeIndex ? s.comboActive : undefined}
                  onMouseDown={(e) => { e.preventDefault(); pick(p) }}
                >
                  <span className={s.comboMain}>{p.alias || p.nombre_completo || ''}</span>
                  <span className={s.comboSub}>{(p.rfc || '') + (p.banco ? ` · ${p.banco}` : '')}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {onPlus && (
        <button
          type="button"
          className={s.providerPlusBtn}
          title="Crear proveedor sin salir de la solicitud"
          aria-label="Crear proveedor sin salir de la solicitud"
          onClick={onPlus}
        >
          +
        </button>
      )}
    </div>
  )
}
