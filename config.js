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
    company_bank_account_id: 'Falta seleccionar la cuenta bancaria de la empresa en la solicitud.',
    source_account_number: 'Falta capturar el numero de cuenta origen en la cuenta bancaria de la empresa.',
    destination_type: 'Falta definir el tipo de destino de pago del proveedor: CLABE, cuenta o convenio.',
    destination_value: 'Falta completar el destino de pago del proveedor segun su tipo de destino.',
    beneficiary_name: 'Falta beneficiario para layout o nombre completo del proveedor.',
    company_name: 'Falta nombre de la empresa origen.',
    proveedor_id: 'Falta proveedor en la solicitud.',
    clabe: 'Falta CLABE del proveedor.',
    cuenta_bancaria: 'Falta cuenta bancaria del proveedor.',
    convenio_number: 'Falta numero de convenio del proveedor.',
    payment_reference: 'Falta referencia de pago en la solicitud.',
    payment_concept: 'Falta concepto de pago en la solicitud.',
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

  function applyProviderLayoutFields() {
    if (pageName !== 'proveedores.html') return

    const tipoCuenta = document.getElementById('tipo_cuenta')
    if (!tipoCuenta) return

    if (!document.getElementById('destination_type')) {
      tipoCuenta.closest('label')?.insertAdjacentHTML('afterend', `
        <label>Tipo de destino de pago
          <select id="destination_type">
            <option value="">Seleccionar...</option>
            <option value="clabe">CLABE</option>
            <option value="cuenta">Cuenta bancaria</option>
            <option value="convenio">Convenio</option>
          </select>
        </label>
      `)
    }

    const banco = document.getElementById('banco')
    if (banco && !document.getElementById('beneficiary_name')) {
      banco.closest('label')?.insertAdjacentHTML('beforebegin', `
        <label>Beneficiario para layout<input id="beneficiary_name" placeholder="Nombre que aparece en el layout"></label>
      `)
    }

    const cuenta = document.getElementById('cuenta_bancaria')
    if (cuenta && !document.getElementById('convenio_number')) {
      cuenta.closest('label')?.insertAdjacentHTML('afterend', `
        <label>Número de convenio<input id="convenio_number" placeholder="Convenio de pago"></label>
      `)
    }

    const destinationType = document.getElementById('destination_type')
    destinationType?.addEventListener('change', () => {
      if (destinationType.value === 'clabe') tipoCuenta.value = 'CLABE'
      if (destinationType.value === 'cuenta') tipoCuenta.value = 'Cuenta'
      if (destinationType.value === 'convenio') tipoCuenta.value = ''
    })
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

    installSolicitudLayoutPatch()
  }

  function installSolicitudLayoutPatch() {
    const detailContent = document.getElementById('detailContent')
    if (!detailContent || document.getElementById('layoutDataDialog')) return

    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="layoutDataDialog">
        <form id="layoutDataForm" class="modal-content">
          <div class="modal-header">
            <div>
              <h2>Datos para layout de pago</h2>
              <p>Completa la información necesaria para que esta solicitud pueda entrar al archivo de pagos.</p>
            </div>
            <button type="button" id="closeLayoutDataModalBtn" class="icon-btn" aria-label="Cerrar">x</button>
          </div>
          <input type="hidden" id="layoutDataRequestId">
          <div class="form-grid">
            <label class="full-row">Cuenta origen *
              <select id="layoutDataBankAccountId" class="form-control" required></select>
            </label>
            <label>Fecha programada de pago *
              <input id="layoutDataScheduledPaymentDate" class="form-control" type="date" required>
            </label>
            <label>Referencia de pago *
              <input id="layoutDataPaymentReference" class="form-control" type="text" placeholder="Recibo, factura o referencia bancaria" required>
            </label>
            <label class="full-row">Concepto de pago *
              <input id="layoutDataPaymentConcept" class="form-control" type="text" placeholder="Concepto que aparecera en el layout" required>
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" id="cancelLayoutDataBtn" class="secondary-btn">Cancelar</button>
            <button type="submit" id="saveLayoutDataBtn" class="primary-btn">Guardar datos de layout</button>
          </div>
        </form>
      </dialog>
    `)

    const originalOpenRequestDetail = window.openRequestDetail
    if (typeof originalOpenRequestDetail === 'function' && !originalOpenRequestDetail.__layoutPatch) {
      window.openRequestDetail = function patchedOpenRequestDetail(paymentRequestId) {
        originalOpenRequestDetail(paymentRequestId)
        window.setTimeout(() => enhanceSolicitudLayoutDetail(paymentRequestId), 120)
      }
      window.openRequestDetail.__layoutPatch = true
    }

    const params = new URLSearchParams(window.location.search)
    const linkedRequestId = params.get('request_id')
    if (linkedRequestId) {
      const tryOpenLinkedRequest = () => {
        if (typeof window.openRequestDetail === 'function') {
          window.openRequestDetail(linkedRequestId)
          return
        }
        window.setTimeout(tryOpenLinkedRequest, 250)
      }
      window.setTimeout(tryOpenLinkedRequest, 750)
    }

    document.getElementById('closeLayoutDataModalBtn')?.addEventListener('click', closeDemoLayoutDataModal)
    document.getElementById('cancelLayoutDataBtn')?.addEventListener('click', closeDemoLayoutDataModal)
    document.getElementById('layoutDataForm')?.addEventListener('submit', saveDemoLayoutData)

    window.openDemoLayoutDataModal = openDemoLayoutDataModal
  }

  async function enhanceSolicitudLayoutDetail(paymentRequestId) {
    const detailContent = document.getElementById('detailContent')
    if (!detailContent || !paymentRequestId) return

    const data = await fetchSolicitudLayoutData(paymentRequestId)
    if (!data?.request) return

    document.getElementById('layoutReadinessSection')?.remove()
    const section = renderSolicitudLayoutReadiness(data)
    detailContent.insertAdjacentHTML('beforeend', section)
  }

  async function fetchSolicitudLayoutData(paymentRequestId) {
    const client = getDemoSupabaseClient()
    if (!client) return null

    const { data: request, error } = await client
      .from('payment_requests')
      .select('id,request_number,status,company_id,proveedor_id,company_bank_account_id,scheduled_payment_date,payment_reference,payment_concept')
      .eq('id', paymentRequestId)
      .maybeSingle()

    if (error || !request) return null

    const [{ data: proveedor }, { data: currentAccount }] = await Promise.all([
      request.proveedor_id
        ? client.from('proveedores').select('id,alias,nombre_completo,destination_type,beneficiary_name,clabe,cuenta_bancaria,convenio_number').eq('id', request.proveedor_id).maybeSingle()
        : Promise.resolve({ data: null }),
      request.company_bank_account_id
        ? client.from('company_bank_accounts').select('id,name,bank_name,account_number,last4,company_id,active').eq('id', request.company_bank_account_id).maybeSingle()
        : Promise.resolve({ data: null })
    ])

    return { request, proveedor, currentAccount }
  }

  function renderSolicitudLayoutReadiness(data) {
    const { request } = data
    const items = getSolicitudLayoutItems(data)
    const missingCount = items.filter(item => !item.complete).length
    const canEdit = ['submitted', 'approved', 'changes_requested', 'finance_validation', 'scheduled'].includes(request.status)

    return `
      <section id="layoutReadinessSection" class="detail-card full layout-readiness-card">
        <span>Preparacion para layout</span>
        <strong>${missingCount ? 'Faltan datos para generar el layout' : 'Lista para layout de pago'}</strong>
        <div class="layout-checklist">
          ${items.map(item => `
            <div class="layout-checkitem ${item.complete ? 'complete' : 'missing'}">
              <b>${item.complete ? 'Completo' : 'Faltante'}</b>
              <p>${escapeDemoHtml(item.label)}</p>
            </div>
          `).join('')}
        </div>
        ${canEdit ? `<button type="button" class="secondary-btn" onclick="openDemoLayoutDataModal('${escapeDemoHtml(request.id)}')">Completar datos para layout</button>` : ''}
        ${request.status === 'paid' ? `<div class="decision-note neutral">Esta solicitud ya fue pagada y no se puede editar.</div>` : ''}
      </section>
    `
  }

  function getSolicitudLayoutItems({ request, proveedor, currentAccount }) {
    return [
      { label: 'Cuenta bancaria de la empresa', complete: Boolean(request.company_bank_account_id) },
      { label: 'Numero de cuenta origen', complete: Boolean(currentAccount?.account_number) },
      { label: 'Tipo de destino del proveedor', complete: Boolean(proveedor?.destination_type) },
      { label: 'Destino de pago del proveedor', complete: Boolean(getProviderDestinationValue(proveedor)) },
      { label: 'Referencia de pago', complete: Boolean(isNotBlank(request.payment_reference)) },
      { label: 'Concepto de pago', complete: Boolean(isNotBlank(request.payment_concept)) }
    ]
  }

  async function openDemoLayoutDataModal(paymentRequestId) {
    const dialog = document.getElementById('layoutDataDialog')
    const requestInput = document.getElementById('layoutDataRequestId')
    const accountSelect = document.getElementById('layoutDataBankAccountId')
    if (!dialog || !requestInput || !accountSelect) return

    const data = await fetchSolicitudLayoutData(paymentRequestId)
    if (!data?.request) {
      showDemoToast('No se pudo cargar la solicitud.', 'error')
      return
    }

    const request = data.request
    requestInput.value = request.id
    document.getElementById('layoutDataScheduledPaymentDate').value = request.scheduled_payment_date ? String(request.scheduled_payment_date).slice(0, 10) : ''
    document.getElementById('layoutDataPaymentReference').value = request.payment_reference || ''
    document.getElementById('layoutDataPaymentConcept').value = request.payment_concept || ''

    await renderDemoBankAccountOptions(request.company_id, request.company_bank_account_id)
    dialog.showModal()
  }

  async function renderDemoBankAccountOptions(companyId, selectedId) {
    client = getDemoSupabaseClient()
    const accountSelect = document.getElementById('layoutDataBankAccountId')
    if (!client || !accountSelect) return

    let query = client
      .from('company_bank_accounts')
      .select('id,name,bank_name,account_number,last4,company_id,active')
      .eq('active', true)
      .order('name', { ascending: true })

    if (companyId) query = query.eq('company_id', companyId)

    let { data: accounts, error } = await query
    if ((!accounts || !accounts.length) && companyId) {
      const fallback = await client
        .from('company_bank_accounts')
        .select('id,name,bank_name,account_number,last4,company_id,active')
        .eq('active', true)
        .order('name', { ascending: true })
      accounts = fallback.data || []
      error = fallback.error
    }

    if (error) {
      accountSelect.innerHTML = '<option value="">No se pudieron cargar cuentas</option>'
      return
    }

    accountSelect.innerHTML = [
      '<option value="">Seleccionar cuenta origen...</option>',
      ...(accounts || []).map(account => `<option value="${escapeDemoHtml(account.id)}">${escapeDemoHtml(formatBankAccountLabel(account))}</option>`)
    ].join('')
    accountSelect.value = selectedId || ''
  }

  async function saveDemoLayoutData(event) {
    event.preventDefault()

    const client = getDemoSupabaseClient()
    const requestId = document.getElementById('layoutDataRequestId')?.value
    const submitBtn = document.getElementById('saveLayoutDataBtn')
    const payload = {
      company_bank_account_id: document.getElementById('layoutDataBankAccountId')?.value || null,
      scheduled_payment_date: document.getElementById('layoutDataScheduledPaymentDate')?.value || null,
      payment_reference: document.getElementById('layoutDataPaymentReference')?.value.trim() || null,
      payment_concept: document.getElementById('layoutDataPaymentConcept')?.value.trim() || null,
      updated_at: new Date().toISOString()
    }

    if (!client || !requestId) return
    if (!payload.company_bank_account_id) return showDemoToast('Selecciona la cuenta origen.', 'error')
    if (!payload.scheduled_payment_date) return showDemoToast('Captura la fecha programada de pago.', 'error')
    if (!payload.payment_reference) return showDemoToast('Captura la referencia de pago.', 'error')
    if (!payload.payment_concept) return showDemoToast('Captura el concepto de pago.', 'error')

    setDemoButtonLoading(submitBtn, true, 'Guardando...')
    const { error } = await client.from('payment_requests').update(payload).eq('id', requestId)
    setDemoButtonLoading(submitBtn, false)

    if (error) {
      showDemoToast(error.message || 'No se pudieron guardar los datos de layout.', 'error')
      return
    }

    closeDemoLayoutDataModal()
    showDemoToast('Datos de layout actualizados correctamente.', 'success')
    if (typeof window.loadPaymentRequests === 'function') window.loadPaymentRequests()
    window.setTimeout(() => {
      if (typeof window.openRequestDetail === 'function') window.openRequestDetail(requestId)
    }, 250)
  }

  function closeDemoLayoutDataModal() {
    document.getElementById('layoutDataDialog')?.close()
  }

  function getProviderDestinationValue(proveedor) {
    if (!proveedor?.destination_type) return ''
    if (proveedor.destination_type === 'clabe') return proveedor.clabe || ''
    if (proveedor.destination_type === 'cuenta') return proveedor.cuenta_bancaria || ''
    if (proveedor.destination_type === 'convenio') return proveedor.convenio_number ? `CONVENIO ${proveedor.convenio_number}` : ''
    return ''
  }

  function formatBankAccountLabel(account) {
    const number = account.account_number ? `CTA ${account.account_number}` : (account.last4 ? `termina ${account.last4}` : 'sin numero de cuenta')
    return [account.name, account.bank_name, number].filter(Boolean).join(' · ')
  }

  function getDemoSupabaseClient() {
    if (!window.supabase || !window.SUPABASE_URL && typeof SUPABASE_URL === 'undefined') return null
    if (!window.__fluxDemoSupabaseClient) {
      window.__fluxDemoSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    }
    return window.__fluxDemoSupabaseClient
  }

  function showDemoToast(message, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(type === 'error' ? 'Revisa la informacion' : 'Listo', message, type)
      return
    }
    window.alert(message)
  }

  function setDemoButtonLoading(button, loading, text) {
    if (!button) return
    if (loading) {
      button.dataset.originalText = button.textContent
      button.textContent = text || 'Guardando...'
      button.disabled = true
      return
    }
    button.textContent = button.dataset.originalText || 'Guardar datos de layout'
    button.disabled = false
  }

  function isNotBlank(value) {
    return value !== null && value !== undefined && String(value).trim() !== ''
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
        const link = item.querySelector('a[href*="solicitudes.html"]')?.getAttribute('href') || ''
        const rawFields = item.textContent.replace(request, '').replace(':', '')
        return { request, link, fields: formatLayoutMissingFields(rawFields) }
      }).filter(item => item.fields)

      if (!items.length) return

      formattingInvalidBox = true
      invalidBox.innerHTML = `
        <strong>${layoutIncompleteMessage}</strong>
        <p class="field-hint">Completa esos datos en la solicitud, proveedor o cuenta bancaria de empresa segun corresponda.</p>
        <ul class="layout-invalid-list">
          ${items.map(item => `<li><strong>${escapeDemoHtml(item.request)}</strong><span class="layout-invalid-fields">${escapeDemoHtml(item.fields)}</span>${item.link ? `<a class="small-btn" href="${escapeDemoHtml(item.link)}">Ver solicitud</a>` : ''}</li>`).join('')}
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
        return source && !String(label).endsWith('.') ? `${label} (${source})` : label
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
    applyProviderLayoutFields()
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
