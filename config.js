// Configuración Supabase
// Reemplaza la publishable key por la de tu proyecto.
// No uses la secret key.
const SUPABASE_URL = "https://scsirgbuqjcwoaxfacth.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_JNDHMoacW6ySHEtmI1Rgdw_zVZElQL2"

;(function prepareDemoShell() {
  const pageName = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase()

  const modules = [
    { file: 'proveedores.html', href: './proveedores.html', icon: '◇', label: 'Proveedores' },
    { file: 'presupuesto.html', href: './presupuesto.html', icon: '▣', label: 'Motor de Presupuesto' },
    { file: 'solicitudes.html', href: './solicitudes.html', icon: 'S', label: 'Solicitudes de pago' },
    { file: 'layouts.html', href: './layouts.html', icon: 'L', label: 'Layouts de pago' }
  ]

  const subtitles = {
    'proveedores.html': 'Proveedores',
    'presupuesto.html': 'Motor de Presupuesto',
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

  function applyDemoCopy() {
    applyLoginCopy()
    applyDemoNavigation()
    applyBranding()
    applyProviderCopy()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDemoCopy)
  } else {
    applyDemoCopy()
  }
})()
