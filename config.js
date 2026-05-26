// Configuración Supabase
// Reemplaza la publishable key por la de tu proyecto.
// No uses la secret key.
const SUPABASE_URL = "https://scsirgbuqjcwoaxfacth.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_JNDHMoacW6ySHEtmI1Rgdw_zVZElQL2"

;(function prepareDemoShell() {
  const pageName = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase()

  const modules = [
    { file: 'proveedores.html', href: './proveedores.html', icon: '◇', label: 'Proveedores' },
    { file: 'solicitudes.html', href: './solicitudes.html', icon: 'S', label: 'Solicitudes de pago' },
    { file: 'layouts.html', href: './layouts.html', icon: 'L', label: 'Layouts de pago' }
  ]

  const subtitles = {
    'proveedores.html': 'Proveedores',
    'solicitudes.html': 'Solicitudes de pago',
    'layouts.html': 'Layouts de pago'
  }

  const layoutIncompleteMessage = 'Se encontraron solicitudes aprobadas en el periodo, pero algunas no pueden incluirse porque tienen datos bancarios incompletos.'
  const layoutFieldLabels = {
    company_bank_account_id: 'Cuenta bancaria de la empresa',
    source_account_number: 'Cuenta origen',
    destination_type: 'Tipo de destino',
    destination_value: 'Destino de pago',
    beneficiary_name: 'Beneficiario',
    company_name: 'Empresa origen',
    proveedor_id: 'Proveedor',
    clabe: 'CLABE del proveedor',
    cuenta_bancaria: 'Cuenta bancaria del proveedor',
    convenio_number: 'Numero de convenio',
    payment_reference: 'Referencia de pago',
    payment_concept: 'Concepto de pago',
    amount: 'Monto',
    amount_requested: 'Monto solicitado'
  }
  const layoutFieldSources = {
    company_bank_account_id: 'se selecciona en la solicitud',
    source_account_number: 'viene de la cuenta bancaria de la empresa',
    destination_type: 'viene del proveedor',
    destination_value: 'se arma con CLABE, cuenta o convenio del proveedor',
    beneficiary_name: 'viene del proveedor',
    clabe: 'viene del proveedor',
    cuenta_bancaria: 'viene del proveedor',
    convenio_number: 'viene del proveedor',
    payment_reference: 'se captura en la solicitud',
    payment_concept: 'se captura en la solicitud'
  }

  function applyLoginCopy() {
    if (pageName !== 'index.html' && pageName !== '') return

    document.title = 'Acceso | Flux Operadora'

    const logo = document.querySelector('.login-card .logo')
    const title = document.querySelector('.login-card h1')
    const description = document.querySelector('.login-card p:not(.note)')
    const note = document.querySelector('.login-card .note')

    if (logo) logo.textContent = 'FL'
    if (title) title.textContent = 'Flux Operadora'
    if (description) {
      description.textContent = 'Centraliza proveedores, presupuesto, solicitudes de pago, layouts y seguimiento financiero en un solo sistema.'
    }
    if (note) note.textContent = 'Acceso protegido con Supabase Auth.'
  }

  function applyDemoNavigation() {
    const nav = document.querySelector('.nav')
    if (!nav) return

    const usesNavLink = Boolean(document.querySelector('.nav-link'))

    nav.innerHTML = modules.map((item) => {
      const isActive = pageName === item.file
      if (usesNavLink) {
        return `<a href="${item.href}" class="nav-link ${isActive ? 'active' : 'muted'}"><span>${item.icon}</span> ${item.label}</a>`
      }
      return `<a href="${item.href}"${isActive ? ' class="active"' : ''}>${item.icon} ${item.label}</a>`
    }).join('')
  }

  function applyBranding() {
    const logo = document.querySelector('.brand-logo, .brand-badge')
    const title = document.querySelector('.brand-title')
    const subtitle = document.querySelector('.brand-subtitle')

    if (logo) logo.textContent = 'FL'
    if (title) title.textContent = 'Flux Operadora'
    if (subtitle && subtitles[pageName]) subtitle.textContent = subtitles[pageName]
  }

  function applyProviderCopy() {
    if (pageName !== 'proveedores.html') return

    const heading = Array.from(document.querySelectorAll('h1')).find((item) => item.textContent.trim().toLowerCase().includes('catálogo'))
    const subtitle = heading?.parentElement?.querySelector('p')

    if (heading) heading.textContent = 'Proveedores'
    if (subtitle) subtitle.textContent = 'Administra proveedores, métodos de pago, datos bancarios y estatus operativo.'
  }

  function applySolicitudesDemoUx() {
    if (pageName !== 'solicitudes.html') return

    const providerSearch = document.getElementById('providerSearch')
    const proveedorId = document.getElementById('proveedorId')

    if (providerSearch) {
      providerSearch.placeholder = 'Buscar por alias, razon social o RFC'

      let providerHelp = document.getElementById('providerHelp')
      if (!providerHelp) {
        providerHelp = document.createElement('span')
        providerHelp.id = 'providerHelp'
        providerHelp.className = 'field-hint'
        providerSearch.insertAdjacentElement('afterend', providerHelp)
      }

      providerHelp.textContent = 'Escribe para filtrar y luego selecciona el proveedor.'

      providerSearch.addEventListener('input', () => {
        window.setTimeout(() => {
          const query = providerSearch.value.trim()
          const optionsCount = proveedorId ? Array.from(proveedorId.options).filter(option => option.value).length : 0
          const hasNoResults = Boolean(query) && optionsCount === 0
          providerHelp.textContent = hasNoResults
            ? 'No se encontraron proveedores.'
            : 'Escribe para filtrar y luego selecciona el proveedor.'
          providerHelp.classList.toggle('warning', hasNoResults)
        }, 0)
      })
    }

    if (proveedorId && !document.getElementById('addProviderQuickLink')) {
      const providerLink = document.createElement('span')
      providerLink.id = 'addProviderQuickLink'
      providerLink.className = 'field-hint'
      providerLink.innerHTML = 'No encuentras el proveedor? <a href="./proveedores.html" target="_blank" rel="noopener">Agregar proveedor</a>'
      proveedorId.insertAdjacentElement('afterend', providerLink)
    }

    const extraCheckbox = document.getElementById('isExtraordinaryAdjustment')
    if (extraCheckbox) {
      const label = extraCheckbox.closest('label')
      if (label && !label.querySelector('.help-dot')) {
        const helpDot = document.createElement('span')
        helpDot.className = 'help-dot'
        helpDot.textContent = '?'
        helpDot.title = 'Marca esta opcion cuando el pago no estaba previsto en el presupuesto o requiere autorizacion especial. La solicitud se tratara como excepcion y debera ser revisada.'
        label.appendChild(helpDot)
      }

      if (label && !document.getElementById('extraordinaryHelpText')) {
        const helpText = document.createElement('div')
        helpText.id = 'extraordinaryHelpText'
        helpText.className = 'field-hint full-row'
        helpText.textContent = 'Marca esta opcion cuando el pago no estaba previsto en el presupuesto o requiere autorizacion especial. No genera pago automatico ni brinca aprobacion; el aprobador todavia debe autorizarla.'
        label.insertAdjacentElement('afterend', helpText)
      }
    }
  }

  function applyLayoutsDemoUx() {
    if (pageName !== 'layouts.html') return

    const bankAccountSelect = document.getElementById('layoutBankAccountId')
    if (bankAccountSelect && !document.getElementById('layoutBankAccountHelp')) {
      const help = document.createElement('span')
      help.id = 'layoutBankAccountHelp'
      help.className = 'field-hint'
      help.textContent = 'Todas las cuentas no asigna una cuenta origen; cada solicitud debe tener cuenta bancaria de empresa y numero de cuenta capturados.'
      bankAccountSelect.insertAdjacentElement('afterend', help)
    }

    const invalidBox = document.getElementById('layoutInvalidBox')
    if (!invalidBox) return

    let formattingInvalidBox = false
    const observer = new MutationObserver(() => {
      if (formattingInvalidBox || invalidBox.classList.contains('hidden')) return

      const text = invalidBox.textContent || ''
      const shouldClarify = text.includes('company_bank_account_id') ||
        text.includes('source_account_number') ||
        text.includes('destination_type') ||
        text.includes('payment_reference') ||
        text.includes('payment_concept')

      if (!shouldClarify) return

      const items = Array.from(invalidBox.querySelectorAll('li')).map((item) => {
        const request = item.querySelector('strong')?.textContent?.trim() || 'Solicitud'
        const rawFields = item.textContent.replace(request, '').replace(':', '')
        return { request, fields: formatLayoutMissingFields(rawFields) }
      }).filter(item => item.fields)

      if (!items.length) return

      formattingInvalidBox = true
      invalidBox.innerHTML = `
        <strong>${layoutIncompleteMessage}</strong>
        <p class="field-hint">Completa esos datos en la solicitud, proveedor o cuenta bancaria de empresa segun corresponda.</p>
        <ul class="layout-invalid-list">
          ${items.map(item => `<li><strong>${escapeDemoHtml(item.request)}</strong><span class="layout-invalid-fields">${escapeDemoHtml(item.fields)}</span></li>`).join('')}
        </ul>
      `
      formattingInvalidBox = false
    })

    observer.observe(invalidBox, { childList: true, subtree: true })
  }

  function formatLayoutMissingFields(rawFields) {
    return String(rawFields || '')
      .split(',')
      .map(field => field.trim())
      .filter(Boolean)
      .map(field => {
        const label = layoutFieldLabels[field] || field.replace(/_/g, ' ')
        const source = layoutFieldSources[field]
        return source ? `${label} (${source})` : label
      })
      .join('; ')
  }

  function applyDemoStyles() {
    if (document.getElementById('demoUxStyle')) return

    const style = document.createElement('style')
    style.id = 'demoUxStyle'
    style.textContent = `
      .field-hint a { color: var(--accent-text); font-weight: 700; text-decoration: none; }
      .field-hint a:hover { text-decoration: underline; }
      .field-hint.full-row { grid-column: 1 / -1; }
      .layout-invalid-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding-left: 18px; }
      .layout-invalid-list strong { color: var(--text-1); }
      .layout-invalid-fields { display: block; margin-top: 2px; color: var(--text-2); font-size: 12px; line-height: 1.45; }
      .help-dot {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: auto;
        background: var(--accent-dim);
        border: 1px solid rgba(15,118,110,0.24);
        color: var(--accent-text);
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        cursor: help;
        flex-shrink: 0;
      }
    `
    document.head.appendChild(style)
  }

  function applyDemoCopy() {
    applyLoginCopy()
    applyDemoNavigation()
    applyBranding()
    applyProviderCopy()
    applySolicitudesDemoUx()
    applyLayoutsDemoUx()
    applyDemoStyles()
  }

  function escapeDemoHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDemoCopy)
  } else {
    applyDemoCopy()
  }
})()
