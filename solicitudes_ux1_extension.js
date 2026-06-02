;(function solicitudesUx1Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "solicitudes.html") return

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!client) return

  const dom = {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    cacheDom()
    installStyles()
    organizeRequestForm()
    prepareProviderSelector()
    ensureQuickProviderDialog()
    applyRoleUx()
    bindEvents()
    observeDetailActions()
    document.addEventListener("flux:roles-ready", applyRoleUx)
  }

  function cacheDom() {
    dom.requestForm = document.getElementById("requestForm")
    dom.isExtraordinaryAdjustment = document.getElementById("isExtraordinaryAdjustment")
    dom.proveedorId = document.getElementById("proveedorId")
    dom.providerSearch = document.getElementById("providerSearch")
  }

  function installStyles() {
    if (document.getElementById("solicitudesUx1ExtensionStyles")) return
    const style = document.createElement("style")
    style.id = "solicitudesUx1ExtensionStyles"
    style.textContent = `
      .role-hidden{display:none!important}
      .provider-summary-card{border:1px solid var(--border);border-radius:12px;padding:12px 13px;background:rgba(255,255,255,.018);display:grid;gap:5px;color:var(--text-2)}
      .provider-summary-card strong{color:var(--text-1);font-size:13px}
      .provider-summary-card span{font-size:11px;color:var(--text-3)}
      .provider-actions-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
      .request-provider-select{min-height:88px}
      .quick-provider-destination{display:none}
      .quick-provider-destination.visible{display:block}
    `
    document.head.appendChild(style)
  }

  function organizeRequestForm() {
    const container = dom.requestForm?.querySelector(".form-sections")
    if (!container || container.dataset.ux1Organized === "true") return
    container.dataset.ux1Organized = "true"

    const paymentSection = sectionByHeading("Datos generales") || container.querySelector(".form-section")
    const financialSection = sectionByHeading("Datos financieros")
    const descriptionSection = sectionByHeading("Descripcion")
    if (!paymentSection) return

    const providerSection = createSection("requestProviderSection", "Proveedor / beneficiario", "Selecciona el proveedor de forma independiente al presupuesto.")
    const budgetSection = createSection("requestBudgetSection", "Clasificacion presupuestal", "Empresa, centro de costo, partida y mes para validar presupuesto.")
    const paymentGrid = paymentSection.querySelector(".form-grid")
    const providerGrid = providerSection.querySelector(".form-grid")
    const budgetGrid = budgetSection.querySelector(".form-grid")

    const heading = paymentSection.querySelector("h3")
    if (heading) heading.textContent = "Datos del pago"

    moveControls(paymentGrid, ["requestType", "amountRequested", "currency", "exchangeRate", "isExtraordinaryAdjustment", "description", "notes"])
    moveControls(providerGrid, ["providerSearch", "proveedorId"])
    moveControls(budgetGrid, ["companyId", "costCenterId", "budgetCategoryId", "budgetMonth"])

    paymentSection.insertAdjacentElement("afterend", providerSection)
    providerSection.insertAdjacentElement("afterend", budgetSection)

    const layoutDetails = document.getElementById("requestLayoutDetails")
    const cashSection = document.getElementById("cashCheckSection")
    if (layoutDetails) budgetSection.insertAdjacentElement("afterend", layoutDetails)
    if (cashSection) (layoutDetails || budgetSection).insertAdjacentElement("afterend", cashSection)

    financialSection?.classList.add("hidden")
    descriptionSection?.classList.add("hidden")
  }

  function moveControls(grid, ids) {
    if (!grid) return
    ids.map(labelForControl).filter(Boolean).forEach((label) => grid.appendChild(label))
  }

  function sectionByHeading(text) {
    return Array.from(dom.requestForm?.querySelectorAll(".form-section") || [])
      .find((section) => normalize(section.querySelector("h3")?.textContent || "") === normalize(text))
  }

  function createSection(id, title, helpText) {
    let section = document.getElementById(id)
    if (section) return section
    section = document.createElement("section")
    section.id = id
    section.className = "form-section"
    section.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <div class="field-hint full-row">${escapeHtml(helpText)}</div>
      <div class="form-grid"></div>
    `
    return section
  }

  function prepareProviderSelector() {
    const searchLabel = labelForControl("providerSearch")
    const selectLabel = labelForControl("proveedorId")
    const quickLink = document.getElementById("addProviderQuickLink")
    if (!searchLabel || !selectLabel) return

    searchLabel.classList.add("full-row")
    selectLabel.classList.add("full-row")
    dom.providerSearch.placeholder = "Escribe alias, razon social o RFC"
    dom.proveedorId.classList.add("request-provider-select")

    if (quickLink && !document.getElementById("newProviderFromRequestBtn")) {
      quickLink.innerHTML = `
        <span class="provider-actions-row">
          <button type="button" id="newProviderFromRequestBtn" class="small-btn">Nuevo proveedor</button>
          <span id="newProviderPermissionHint">Crea el proveedor sin salir de la solicitud.</span>
        </span>
      `
    }

    if (!document.getElementById("selectedProviderSummary")) {
      const summary = document.createElement("div")
      summary.id = "selectedProviderSummary"
      summary.className = "provider-summary-card full-row"
      summary.innerHTML = "<strong>Sin proveedor seleccionado</strong><span>Busca y selecciona un proveedor para ver sus datos.</span>"
      selectLabel.insertAdjacentElement("afterend", summary)
    }
    renderProviderSummary()
  }

  function bindEvents() {
    document.getElementById("newProviderFromRequestBtn")?.addEventListener("click", openQuickProviderModal)
    dom.proveedorId?.addEventListener("change", renderProviderSummary)
    dom.requestForm?.addEventListener("submit", () => {
      if (!canApprove() && dom.isExtraordinaryAdjustment) dom.isExtraordinaryAdjustment.checked = false
    }, true)
  }

  function applyRoleUx() {
    const approver = canApprove()
    const canManage = canManageProviders()
    labelForControl("isExtraordinaryAdjustment")?.classList.toggle("role-hidden", !approver)
    document.getElementById("extraordinaryHelpText")?.classList.toggle("role-hidden", !approver)
    if (!approver && dom.isExtraordinaryAdjustment) dom.isExtraordinaryAdjustment.checked = false

    const hint = document.getElementById("newProviderPermissionHint")
    if (hint) hint.textContent = canManage ? "Crea el proveedor sin salir de la solicitud." : "Disponible solo para admin/finanzas."
    softenApprovalPanel()
  }

  function observeDetailActions() {
    const detail = document.getElementById("detailContent")
    if (!detail) return
    const observer = new MutationObserver(() => window.setTimeout(softenApprovalPanel, 120))
    observer.observe(detail, { childList: true, subtree: true })
  }

  function softenApprovalPanel() {
    if (canApprove()) return
    const detail = document.getElementById("detailContent")
    if (!detail) return
    Array.from(detail.querySelectorAll("section")).forEach((section) => {
      if (!/Decision del aprobador/i.test(section.textContent || "")) return
      section.querySelectorAll("button").forEach((button) => button.classList.add("role-hidden"))
      if (!section.querySelector("[data-requester-decision-note]")) {
        section.insertAdjacentHTML("beforeend", `<div class="decision-note neutral" data-requester-decision-note>Las acciones de aprobacion solo estan disponibles para usuarios autorizados. Esta vista queda como consulta de la solicitud.</div>`)
      }
    })
  }

  async function renderProviderSummary() {
    const summary = document.getElementById("selectedProviderSummary")
    if (!summary || !dom.proveedorId?.value) {
      if (summary) summary.innerHTML = "<strong>Sin proveedor seleccionado</strong><span>Busca y selecciona un proveedor para ver sus datos.</span>"
      return
    }

    const { data } = await client
      .from("proveedores")
      .select("id,alias,nombre_completo,banco,rfc,destination_type,beneficiary_name")
      .eq("id", dom.proveedorId.value)
      .maybeSingle()

    if (!data) return
    summary.innerHTML = `
      <strong>${escapeHtml(data.alias || data.nombre_completo || "Proveedor")}</strong>
      <span>${escapeHtml(data.nombre_completo || "Sin razon social")}</span>
      <span>${escapeHtml([data.rfc ? `RFC ${data.rfc}` : "", data.banco, destinationTypeLabel(data.destination_type)].filter(Boolean).join(" | "))}</span>
      <span>Beneficiario: ${escapeHtml(data.beneficiary_name || data.nombre_completo || data.alias || "Sin beneficiario")}</span>
    `
  }

  function ensureQuickProviderDialog() {
    if (document.getElementById("quickProviderDialog")) return
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="quickProviderDialog">
        <form id="quickProviderForm" class="modal-content">
          <div class="modal-header">
            <div>
              <h2>Nuevo proveedor</h2>
              <p>Captura los datos minimos para usarlo en esta solicitud.</p>
            </div>
            <button type="button" class="icon-btn" data-close-quick-provider>x</button>
          </div>
          <div class="form-grid">
            <label>Alias / nombre visible *<input id="quickProviderAlias" class="form-control" required></label>
            <label>Razon social / nombre completo *<input id="quickProviderName" class="form-control" required></label>
            <label>Tipo de destino de pago
              <select id="quickProviderDestinationType" class="form-control">
                <option value="">Seleccionar...</option>
                <option value="clabe">CLABE</option>
                <option value="cuenta">Cuenta bancaria</option>
                <option value="convenio">Convenio</option>
              </select>
            </label>
            <label>Metodo de pago *
              <select id="quickProviderPaymentMethod" class="form-control" required>
                <option value="Transferencia bancaria">Transferencia bancaria</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Cheque">Cheque</option>
                <option value="Otro">Otro</option>
              </select>
            </label>
            <label>Beneficiario para layout<input id="quickProviderBeneficiary" class="form-control"></label>
            <label class="quick-provider-destination" data-quick-bank>Banco<input id="quickProviderBank" class="form-control"></label>
            <label class="quick-provider-destination" data-quick-destination="clabe">CLABE<input id="quickProviderClabe" class="form-control" maxlength="18"></label>
            <label class="quick-provider-destination" data-quick-destination="cuenta">Cuenta bancaria<input id="quickProviderAccount" class="form-control"></label>
            <label class="quick-provider-destination" data-quick-destination="convenio">Numero de convenio<input id="quickProviderConvenio" class="form-control"></label>
            <label class="full-row">RFC<input id="quickProviderRfc" class="form-control"></label>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-btn" data-close-quick-provider>Cancelar</button>
            <button type="submit" class="primary-btn">Guardar proveedor</button>
          </div>
        </form>
      </dialog>
    `)
    document.querySelectorAll("[data-close-quick-provider]").forEach((button) => button.addEventListener("click", closeQuickProviderModal))
    document.getElementById("quickProviderDestinationType")?.addEventListener("change", updateQuickProviderDestinationFields)
    document.getElementById("quickProviderPaymentMethod")?.addEventListener("change", updateQuickProviderDestinationFields)
    document.getElementById("quickProviderForm")?.addEventListener("submit", saveQuickProvider)
    updateQuickProviderDestinationFields()
  }

  function openQuickProviderModal() {
    if (!canManageProviders()) {
      showToast("Permiso requerido", "No tienes permiso para crear proveedores.", "warning")
      return
    }
    document.getElementById("quickProviderForm")?.reset()
    document.getElementById("quickProviderPaymentMethod").value = "Transferencia bancaria"
    updateQuickProviderDestinationFields()
    document.getElementById("quickProviderDialog")?.showModal()
  }

  function closeQuickProviderModal() {
    document.getElementById("quickProviderDialog")?.close()
  }

  function updateQuickProviderDestinationFields() {
    const method = value("quickProviderPaymentMethod")
    const destination = value("quickProviderDestinationType")
    const hidden = method === "Efectivo" || method === "Tarjeta en plataforma"
    document.querySelectorAll("[data-quick-bank]").forEach((field) => field.classList.toggle("visible", !hidden && Boolean(destination)))
    document.querySelectorAll("[data-quick-destination]").forEach((field) => field.classList.toggle("visible", !hidden && field.dataset.quickDestination === destination))
  }

  async function saveQuickProvider(event) {
    event.preventDefault()
    if (!canManageProviders()) return

    const method = value("quickProviderPaymentMethod")
    const destination = value("quickProviderDestinationType")
    const isCash = method === "Efectivo" || method === "Tarjeta en plataforma"
    const payload = {
      alias: value("quickProviderAlias"),
      nombre_completo: value("quickProviderName"),
      metodo_pago: method,
      tipo_cuenta: destination === "clabe" ? "CLABE" : destination === "cuenta" ? "Cuenta" : null,
      destination_type: isCash ? null : destination || null,
      beneficiary_name: value("quickProviderBeneficiary"),
      banco: isCash ? null : value("quickProviderBank"),
      clabe: !isCash && destination === "clabe" ? value("quickProviderClabe") : null,
      cuenta_bancaria: !isCash && destination === "cuenta" ? value("quickProviderAccount") : null,
      convenio_number: !isCash && destination === "convenio" ? value("quickProviderConvenio") : null,
      rfc: value("quickProviderRfc"),
      tipo_proveedor: "Servicios",
      activo: true,
      updated_at: new Date().toISOString(),
    }

    if (!payload.alias || !payload.nombre_completo) return showToast("Proveedor incompleto", "Captura alias y razon social.", "warning")
    if (!isCash && !payload.destination_type) return showToast("Destino requerido", "Selecciona CLABE, cuenta bancaria o convenio.", "warning")
    if (payload.destination_type === "clabe" && !payload.clabe) return showToast("CLABE requerida", "Captura la CLABE del proveedor.", "warning")
    if (payload.destination_type === "cuenta" && !payload.cuenta_bancaria) return showToast("Cuenta requerida", "Captura la cuenta bancaria.", "warning")
    if (payload.destination_type === "convenio" && !payload.convenio_number) return showToast("Convenio requerido", "Captura el numero de convenio.", "warning")

    const { data, error } = await client.from("proveedores").insert(payload).select("id,alias,nombre_completo").single()
    if (error) {
      showToast("No se pudo crear proveedor", providerCreateFriendlyError(error), "error")
      return
    }

    closeQuickProviderModal()
    const option = document.createElement("option")
    option.value = data.id
    option.textContent = [data.alias, data.nombre_completo].filter(Boolean).join(" | ")
    option.selected = true
    dom.proveedorId.appendChild(option)
    dom.proveedorId.value = data.id
    dom.providerSearch.value = data.alias || data.nombre_completo || ""
    await renderProviderSummary()
    showToast("Proveedor creado", "Proveedor agregado y seleccionado en la solicitud.", "success")
  }

  function providerCreateFriendlyError(error) {
    const message = error?.message || String(error || "Error desconocido")
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") {
      return "No tienes permiso para crear proveedores."
    }
    return message
  }

  function labelForControl(id) {
    return document.getElementById(id)?.closest("label") || null
  }

  function canApprove() {
    return Boolean(window.FluxAuth?.canApprove?.())
  }

  function canManageProviders() {
    return Boolean(window.FluxAuth?.canManageProviders?.())
  }

  function value(id) {
    return String(document.getElementById(id)?.value || "").trim()
  }

  function destinationTypeLabel(type) {
    const labels = { clabe: "CLABE", cuenta: "Cuenta bancaria", convenio: "Convenio" }
    return labels[type] || type || "Sin destino"
  }

  function showToast(title, message, type = "success") {
    const stack = document.getElementById("toastStack")
    if (!stack) return window.alert(`${title}\n${message}`)
    const node = document.createElement("div")
    node.className = `toast ${type}`
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
    stack.appendChild(node)
    window.setTimeout(() => node.remove(), 5500)
  }

  function normalize(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }
})()
