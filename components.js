/**
 * components.js — Flux Operadora UI Component Library
 *
 * Funciones que retornan strings HTML usando los patrones aprobados en ux2_shared.css.
 * Uso: document.getElementById('x').innerHTML = Components.badge('Aprobada', 'success')
 *
 * Todos los textos van en español. Nunca uses hex directamente — solo clases CSS.
 */

const Components = (() => {

  // ─────────────────────────────────────────
  // BADGE
  // ─────────────────────────────────────────
  // variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'accent' | 'violet'
  function badge(text, variant = 'neutral') {
    return `<span class="b b-${variant}">${text}</span>`
  }

  // Catálogo de badges de estatus predefinidos
  const BADGE = {
    // Aprobación
    aprobada:    () => badge('Aprobada', 'success'),
    rechazada:   () => badge('Rechazada', 'danger'),
    excepcion:   () => badge('Excepción', 'violet'),
    // Pago
    pagado:      () => badge('Pagado', 'success'),
    pendiente:   () => badge('Pendiente', 'warning'),
    programado:  () => badge('Programado', 'info'),
    // Flujo
    enviada:     () => badge('Enviada', 'info'),
    borrador:    () => badge('Borrador', 'neutral'),
    cancelada:   () => badge('Cancelada', 'warning'),
    // Presupuesto
    extraordinario: () => badge('Extraordinario', 'violet'),
    // Efectivo
    abierto:     () => badge('Abierto', 'accent'),
    cerrado:     () => badge('Cerrado', 'neutral'),
    comprobado:  () => badge('Comprobado', 'success'),
    // Validación
    aprobable:   () => badge('Aprobable', 'success'),
    sin_validar: () => badge('Sin validar', 'neutral'),
    con_correccion: () => badge('Con corrección', 'warning'),
    // Layout
    completo:    () => badge('Completo', 'success'),
    faltante:    () => badge('Faltante', 'danger'),
    // Proveedor
    transferencia: () => badge('Transferencia', 'neutral'),
    efectivo_b:  () => badge('Efectivo', 'neutral'),
    // Revisión
    en_revision: () => badge('En revisión', 'info'),
    visita:      () => badge('Visita', 'info'),
  }

  // ─────────────────────────────────────────
  // NOTICE
  // ─────────────────────────────────────────
  // variant: 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'violet'
  // icon: string opcional (✓, !, ✕, i)
  function notice(title, desc, variant = 'info', icon = null) {
    const iconMap = { info: 'i', success: '✓', warning: '!', danger: '✕', neutral: '·', violet: '◆' }
    const ic = icon ?? iconMap[variant] ?? 'i'
    return `
      <div class="notice-v2 ${variant}">
        <span class="notice-icon">${ic}</span>
        <span>
          <span class="notice-title">${title}</span>
          <span class="notice-sep">—</span>
          <span class="notice-desc">${desc}</span>
        </span>
      </div>`
  }

  // ─────────────────────────────────────────
  // KPI CARD
  // ─────────────────────────────────────────
  // variant: 'success' | 'danger' | 'warning' | 'info' | 'violet' | 'muted'
  function kpi({ label, value, sub = '', variant = 'muted', clickable = false, active = false } = {}) {
    const classes = ['kpi', variant, clickable ? 'clickable' : '', active ? 'active' : ''].filter(Boolean).join(' ')
    return `
      <div class="${classes}">
        <span class="kpi-label">${label}</span>
        <span class="kpi-value">${value}</span>
        ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
      </div>`
  }

  // KPI horizontal (para interiores de modal)
  function kpiH({ label, value, variant = 'muted' } = {}) {
    return `
      <div class="kpi-h ${variant}">
        <span class="kpi-label">${label}</span>
        <span class="kpi-value">${value}</span>
      </div>`
  }

  // ─────────────────────────────────────────
  // TABS
  // ─────────────────────────────────────────
  // tabs: [{ label, count?, id }]
  // activeId: id del tab activo
  // onClickAttr: atributo HTML para el evento (ej. 'onclick' o 'data-tab')
  function tabBar(tabs, activeId, { onClickAttr = 'data-tab' } = {}) {
    const items = tabs.map(t => {
      const isActive = t.id === activeId
      const count = t.count != null ? `<span class="tab-count">${t.count}</span>` : ''
      return `<button class="tab${isActive ? ' active' : ''}" ${onClickAttr}="${t.id}">${t.label}${count}</button>`
    }).join('')
    return `<div class="tab-bar">${items}</div>`
  }

  // ─────────────────────────────────────────
  // EMPTY STATE
  // ─────────────────────────────────────────
  // variant: 'full' (primera vez) | 'compact' (sin resultados de filtro)
  function emptyState({ icon = '📋', title, desc, actionHtml = '', variant = 'full' } = {}) {
    const compact = variant === 'compact'
    return `
      <div class="empty-state-v2${compact ? ' compact' : ''}">
        <div class="es-icon">${icon}</div>
        <div class="es-title">${title}</div>
        <div class="es-desc">${desc}</div>
        ${actionHtml ? `<div class="es-action">${actionHtml}</div>` : ''}
      </div>`
  }

  // ─────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────
  // variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  // duration: segundos de la barra de progreso (0 = sin barra)
  function toast({ title, desc = '', variant = 'info', duration = 4, onClose = '' } = {}) {
    const iconMap = { success: '✓', danger: '✕', warning: '!', info: 'i', neutral: '·' }
    const icon = iconMap[variant] ?? 'i'
    const progress = duration > 0
      ? `<div class="toast-v2-progress"><div class="toast-v2-fill" style="animation:shrink ${duration}s linear forwards"></div></div>`
      : ''
    return `
      <div class="toast-v2 ${variant}">
        <span class="toast-v2-icon">${icon}</span>
        <div class="toast-v2-body">
          <span class="toast-v2-title">${title}</span>
          ${desc ? `<span class="toast-v2-desc">${desc}</span>` : ''}
        </div>
        <button class="toast-v2-close" ${onClose ? `onclick="${onClose}"` : ''}>✕</button>
        ${progress}
      </div>`
  }

  // Helper: mostrar un toast en el stack global (crea el stack si no existe)
  function showToast({ title, desc = '', variant = 'info', duration = 4 } = {}) {
    let stack = document.querySelector('.toast-stack-v2')
    if (!stack) {
      stack = document.createElement('div')
      stack.className = 'toast-stack-v2'
      document.body.appendChild(stack)
    }
    // popover=manual coloca el stack en el top layer, por encima de cualquier
    // <dialog open>. El div suele venir hardcodeado en el HTML (#toastStack),
    // así que el atributo se asegura aquí aunque no lo hayamos creado nosotros.
    if (!stack.hasAttribute('popover')) stack.setAttribute('popover', 'manual')
    // Re-mostrar en cada toast: lo sube al tope del top layer, encima de un
    // modal que se haya abierto DESPUÉS de mostrar el primer toast.
    try {
      if (stack.matches(':popover-open')) stack.hidePopover()
      stack.showPopover()
    } catch (_) {}
    const id = `toast-${Date.now()}`
    const el = document.createElement('div')
    el.innerHTML = toast({ title, desc, variant, duration, onClose: `this.closest('.toast-v2').remove()` })
    const node = el.firstElementChild
    node.id = id
    stack.appendChild(node)
    if (duration > 0) {
      // Añadir animación de keyframe si no existe
      if (!document.getElementById('toast-shrink-style')) {
        const style = document.createElement('style')
        style.id = 'toast-shrink-style'
        style.textContent = '@keyframes shrink{from{width:100%}to{width:0%}}'
        document.head.appendChild(style)
      }
      setTimeout(() => node.remove(), duration * 1000 + 300)
    }
  }

  // ─────────────────────────────────────────
  // REF GRID (modal de consulta — datos de referencia)
  // ─────────────────────────────────────────
  // cells: [{ label, value, muted?, full? }]
  function refGrid(cells) {
    const items = cells.map(c => `
      <div class="ref-cell${c.full ? ' full' : ''}">
        <span class="ref-label">${c.label}</span>
        <span class="ref-value${c.muted ? ' muted' : ''}">${c.value}</span>
      </div>`).join('')
    return `<div class="ref-grid">${items}</div>`
  }

  // ─────────────────────────────────────────
  // DATA ROW (modal de consulta — datos de la solicitud)
  // ─────────────────────────────────────────
  // rows: [{ label, value, muted?, amount? }]
  function dataSection(rows, heading = '') {
    const headingHtml = heading ? `<div class="section-heading">${heading}</div>` : ''
    const rowsHtml = rows.map(r => `
      <div class="data-row">
        <span class="data-label">${r.label}</span>
        <span class="data-value${r.muted ? ' muted' : ''}${r.amount ? ' amount' : ''}">${r.value}</span>
      </div>`).join('')
    return `<div class="data-section">${headingHtml}${rowsHtml}</div>`
  }

  // ─────────────────────────────────────────
  // CHECKLIST / GOALS (modal de preparación)
  // ─────────────────────────────────────────
  // items: [{ label, ok, reason?, actionLabel?, actionAttr? }]
  // progress: { done, total }
  function checkList({ items = [], progress = null } = {}) {
    const progressHtml = progress ? `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;color:var(--text-3)">${progress.done} de ${progress.total} campos completos</span>
          ${progress.done < progress.total ? badge(`${progress.total - progress.done} pendientes`, 'warning') : badge('Completo', 'success')}
        </div>
        <div class="progress-bar" style="margin-top:8px">
          <div class="progress-fill${progress.done < progress.total ? ' partial' : ''}" style="width:${Math.round(progress.done / progress.total * 100)}%"></div>
        </div>
      </div>` : ''

    const itemsHtml = items.map(item => `
      <div class="check-item${item.ok ? '' : ' fail'}">
        <div class="check-icon-wrap ${item.ok ? 'ok' : 'fail'}">${item.ok ? '✓' : '✕'}</div>
        <div style="flex:1">
          <div class="check-label">${item.label}</div>
          ${item.reason ? `<div class="check-reason">${item.reason}</div>` : ''}
        </div>
        ${item.ok
          ? badge('Completo', 'success')
          : item.actionLabel
            ? `<button class="check-action" ${item.actionAttr ?? ''}>${item.actionLabel} →</button>`
            : ''}
      </div>`).join('')

    return `${progressHtml}<div class="check-list">${itemsHtml}</div>`
  }

  // ─────────────────────────────────────────
  // DECISION AREA (modal de aprobación)
  // ─────────────────────────────────────────
  // opts: { onApprove, onReject, onException } — atributos onclick como strings
  function decisionArea({ onApprove = '', onReject = '', onException = '', placeholder = 'Comentario (requerido para rechazar o aprobar como excepción)...' } = {}) {
    return `
      <div class="decision-area">
        <span class="decision-label">Tu decisión</span>
        <textarea class="f-ctrl" placeholder="${placeholder}" id="decision-comment"></textarea>
        <div class="decision-actions">
          <button class="btn-approve" ${onApprove ? `onclick="${onApprove}"` : ''}>Aprobar</button>
          <button class="btn-reject" ${onReject ? `onclick="${onReject}"` : ''}>Rechazar</button>
          <button class="btn-exception" ${onException ? `onclick="${onException}"` : ''}>Aprobar como excepción</button>
        </div>
      </div>`
  }

  // ─────────────────────────────────────────
  // MODAL SHELL v2
  // ─────────────────────────────────────────
  // Retorna el shell — el contenido va dentro de .modal-v2-scroll
  function modalShell({ title, subtitle = '', bodyHtml = '', footerHtml = '', onClose = '' } = {}) {
    return `
      <div class="modal-v2">
        <div class="modal-v2-top">
          <div>
            <h1>${title}</h1>
            ${subtitle ? `<p>${subtitle}</p>` : ''}
          </div>
          <button class="close-btn-v2" ${onClose ? `onclick="${onClose}"` : ''}>✕</button>
        </div>
        <div class="modal-v2-scroll">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-v2-footer">${footerHtml}</div>` : ''}
      </div>`
  }

  // ─────────────────────────────────────────
  // FORM FIELD
  // ─────────────────────────────────────────
  // type: 'text' | 'number' | 'date' | 'month' | 'select' | 'textarea' | 'search'
  // options: [{ value, label }] — solo para select
  function field({ label, type = 'text', id = '', name = '', value = '', placeholder = '', hint = '', required = false, error = false, full = false, options = [] } = {}) {
    const req = required ? `<span class="f-req">*</span>` : ''
    const hintHtml = hint ? `<span class="f-hint${error ? ' error' : ''}">${hint}</span>` : ''
    const errorClass = error ? ' error' : ''

    let control
    if (type === 'select') {
      const opts = options.map(o => `<option value="${o.value}"${o.value == value ? ' selected' : ''}>${o.label}</option>`).join('')
      control = `<select class="f-ctrl${errorClass}" id="${id}" name="${name}">${opts}</select>`
    } else if (type === 'textarea') {
      control = `<textarea class="f-ctrl${errorClass}" id="${id}" name="${name}" placeholder="${placeholder}">${value}</textarea>`
    } else {
      control = `<input class="f-ctrl${errorClass}" type="${type}" id="${id}" name="${name}" value="${value}" placeholder="${placeholder}">`
    }

    return `
      <label${full ? ' class="full"' : ''}>
        <span class="f-label">${label} ${req}</span>
        ${control}
        ${hintHtml}
      </label>`
  }

  // ─────────────────────────────────────────
  // BUTTON HELPERS
  // ─────────────────────────────────────────
  function btnPrimary(label, { onclick = '', disabled = false, type = 'button' } = {}) {
    return `<button class="primary-btn" type="${type}" ${onclick ? `onclick="${onclick}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button>`
  }

  function btnSecondary(label, { onclick = '', type = 'button' } = {}) {
    return `<button class="secondary-btn" type="${type}" ${onclick ? `onclick="${onclick}"` : ''}>${label}</button>`
  }

  function btnDanger(label, { onclick = '', type = 'button' } = {}) {
    return `<button class="btn-reject" type="${type}" ${onclick ? `onclick="${onclick}"` : ''}>${label}</button>`
  }

  // ─────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────
  return {
    badge,
    BADGE,
    notice,
    kpi,
    kpiH,
    tabBar,
    emptyState,
    toast,
    showToast,
    refGrid,
    dataSection,
    checkList,
    decisionArea,
    modalShell,
    field,
    btnPrimary,
    btnSecondary,
    btnDanger,
  }

})()
