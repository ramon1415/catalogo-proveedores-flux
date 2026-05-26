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

  function applyDemoStyles() {
    if (document.getElementById('demoUxStyle')) return

    const style = document.createElement('style')
    style.id = 'demoUxStyle'
    style.textContent = `
      .field-hint a { color: var(--accent-text); font-weight: 700; text-decoration: none; }
      .field-hint a:hover { text-decoration: underline; }
      .field-hint.full-row { grid-column: 1 / -1; }
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
    applyDemoStyles()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDemoCopy)
  } else {
    applyDemoCopy()
  }
})()
