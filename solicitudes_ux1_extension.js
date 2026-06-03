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
      .request-provider-select.provider-live-results{min-height:158px}
      #quickProviderDialog{width:min(720px,calc(100vw - 28px));max-width:720px;margin:auto 20px auto auto}
      #quickProviderDialog .modal-content{max-height:90vh;overflow:auto}
      .quick-provider-destination{display:none}
      .quick-provider-destination.visible{display:block}
      .visit-context-placeholder{border:1px dashed var(--border-strong);border-radius:12px;padding:12px;background:rgba(255,255,255,.018);display:grid;gap:6px;color:var(--text-2)}
      .visit-context-placeholder strong{color:var(--text-1)}
      .visit-context-placeholder span{font-size:12px;color:var(--text-3)}
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
    const visitContextSection = createSection("requestVisitContextSection", "Contexto operativo", "Campo opcional para relacionar el pago con una visita o incidencia cuando el modelo quede activo.")
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
    budgetSection.insertAdjacentElement("afterend", visitContextSection)
    prepareVisitAssociationPlaceholder(visitContextSection)

    const layoutDetails = document.getElementById("requestLayoutDetails")
    const cashSection = document.getElementById("cashCheckSection")
    if (layoutDetails) visitContextSection.insertAdjacentElement("afterend", layoutDetails)
    if (cashSection) (layoutDetails || visitContextSection).insertAdjacentElement("afterend", cashSection)

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

  function prepareVisitAssociationPlaceholder(section) {
    if (!section || section.dataset.visitReady === "true") return
    section.dataset.visitReady = "true"
    const grid = section.querySelector(".form-grid")
    if (!grid) return
    grid.innerHTML = `
      <label class="full-row">Visita / Incidencia asociada
        <select id="requestVisitIncidentPlaceholder" class="form-control" disabled>
          <option>Modelo de visitas/incidencias pendiente de conexion</option>
        </select>
      </label>
      <div class="visit-context-placeholder full-row">
        <strong>Asociacion opcional, no requerida para guardar.</strong>
        <span>La solicitud podra vincularse a una visita/evento cuando exista soporte backend. Por ahora el pago se registra normal y esta relacion queda como pendiente funcional.</span>
      </div>
    `
  }

  function bindEvents() {
    document.getElementById("newProviderFromRequestBtn")?.addEventListener("click", openQuickProviderModal)
    dom.proveedorId?.addEventListener("change", renderProviderSummary)
    dom.providerSearch?.addEventListener("input", scheduleProviderResultsOpen)
    dom.providerSearch?.addEventListener("focus", scheduleProviderResultsOpen)
    dom.proveedorId?.addEventListener("change", syncProviderSearchFromSelection)
    dom.proveedorId?.addEventListener("change", collapseProviderResults)
    document.getElementById("closeRequestModalBtn")?.addEventListener("click", collapseProviderResults)
    document.getElementById("cancelRequestBtn")?.addEventListener("click", collapseProviderResults)
    dom.requestForm?.addEventListener("submit", () => {
      if (!canApprove() && dom.isExtraordinaryAdjustment) dom.isExtraordinaryAdjustment.checked = false
    }, true)
  }

  function scheduleProviderResultsOpen() {
    if (typeof window.renderProveedorOptions === "function") {
      window.renderProveedorOptions(dom.providerSearch?.value || "")
    }
    window.setTimeout(openProviderResultsFromCurrentOptions, 0)
  }

  function openProviderResultsFromCurrentOptions() {
    if (!dom.providerSearch || !dom.proveedorId) return
    const query = dom.providerSearch.value.trim()
    const help = document.getElementById("providerHelp")

    if (!query) {
      collapseProviderResults()
      setProviderHelp(help, "Escribe para filtrar y luego selecciona el proveedor.", false)
      return
    }

    const matches = Math.max(dom.proveedorId.options.length - 1, 0)
    dom.proveedorId.size = Math.min(Math.max(matches + 1, 2), 8)
    dom.proveedorId.classList.add("provider-live-results")

    if (!matches) {
      setProviderHelp(help, "No se encontraron proveedores con esa busqueda.", true)
      return
    }

    setProviderHelp(help, `Mostrando ${matches} proveedor${matches === 1 ? "" : "es"}. Selecciona una opcion de la lista.`, false)
  }

  function collapseProviderResults() {
    if (!dom.proveedorId) return
    dom.proveedorId.removeAttribute("size")
    dom.proveedorId.classList.remove("provider-live-results")
  }

  function syncProviderSearchFromSelection() {
    if (!dom.providerSearch || !dom.proveedorId?.value) return
    const selected = dom.proveedorId.options[dom.proveedorId.selectedIndex]
    if (!selected) return
    dom.providerSearch.value = cleanProviderOptionLabel(selected.textContent)
  }

  function cleanProviderOptionLabel(label) {
    return String(label || "").split("|")[0].split(" - ")[0].trim()
  }

  function setProviderHelp(help, text, warning) {
    if (!help) return
    help.textContent = text
    help.classList.toggle("warning", Boolean(warning))
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
    if (document.getElementById("quickProviderDialog")) {
      upgradeQuickProviderDialog()
      return
    }
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="quickProviderDialog">
        <form id="quickProviderForm" class="modal-content">
          <div class="modal-header">
            <div>
              <h2>Nuevo proveedor</h2>
              <p>Alta rapida sin salir de la solicitud.</p>
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
            <label>RFC<input id="quickProviderRfc" class="form-control"></label>
            <label>Telefono<input id="quickProviderPhone" class="form-control"></label>
            <label class="full-row">Email<input id="quickProviderEmail" class="form-control" type="email"></label>
            <label class="quick-provider-destination" data-quick-bank>Banco<input id="quickProviderBank" class="form-control"></label>
            <label class="quick-provider-destination" data-quick-destination="clabe">CLABE<input id="quickProviderClabe" class="form-control" maxlength="18"></label>
            <label class="quick-provider-destination" data-quick-destination="cuenta">Cuenta bancaria<input id="quickProviderAccount" class="form-control"></label>
            <label class="quick-provider-destination" data-quick-destination="convenio">Numero de convenio<input id="quickProviderConvenio" class="form-control"></label>
            <label class="full-row">Notas<textarea id="quickProviderNotes" class="form-control"></textarea></label>
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
    document.getElementById("quickProviderForm").dataset.ux1Bound = "true"
    upgradeQuickProviderDialog()
    updateQuickProviderDestinationFields()
  }

  function upgradeQuickProviderDialog() {
    const dialog = document.getElementById("quickProviderDialog")
    const form = document.getElementById("quickProviderForm")
    const grid = form?.querySelector(".form-grid")
    if (!dialog || !form || !grid) return
    dialog.style.width = "min(720px, calc(100vw - 28px))"
    dialog.style.maxWidth = "720px"
    dialog.style.margin = "auto 20px auto auto"
    form.style.maxHeight = "90vh"
    form.style.overflow = "auto"
    const subtitle = form.querySelector(".modal-header p")
    if (subtitle) subtitle.textContent = "Alta rapida sin salir de la solicitud."
    insertQuickField("quickProviderRfc", "RFC", "input", { beforeId: "quickProviderBank" })
    insertQuickField("quickProviderPhone", "Telefono", "input", { beforeId: "quickProviderBank" })
    insertQuickField("quickProviderEmail", "Email", "input", { beforeId: "quickProviderBank", fullRow: true, type: "email" })
    insertQuickField("quickProviderNotes", "Notas", "textarea", { fullRow: true })
    if (form.dataset.ux1Bound !== "true") {
      form.dataset.ux1Bound = "true"
      document.querySelectorAll("[data-close-quick-provider]").forEach((button) => button.addEventListener("click", closeQuickProviderModal))
      document.getElementById("quickProviderDestinationType")?.addEventListener("change", updateQuickProviderDestinationFields)
      document.getElementById("quickProviderPaymentMethod")?.addEventListener("change", updateQuickProviderDestinationFields)
      form.addEventListener("submit", saveQuickProvider)
    }
  }

  function insertQuickField(id, label, tag, options = {}) {
    if (document.getElementById(id)) return
    const grid = document.getElementById("quickProviderForm")?.querySelector(".form-grid")
    if (!grid) return
    const wrapper = document.createElement("label")
    if (options.fullRow) wrapper.className = "full-row"
    wrapper.append(document.createTextNode(label))
    const control = document.createElement(tag)
    control.id = id
    control.className = "form-control"
    if (tag === "input" && options.type) control.type = options.type
    wrapper.append(control)
    const before = options.beforeId ? document.getElementById(options.beforeId)?.closest("label") : null
    grid.insertBefore(wrapper, before || null)
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
      telefono: value("quickProviderPhone") || null,
      email: value("quickProviderEmail") || null,
      notas: value("quickProviderNotes") || null,
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
