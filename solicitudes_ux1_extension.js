;(function solicitudesUx1Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "solicitudes.html") return

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!client) return

  const dom = {}
  const state = {
    visitIncidents: [],
    visitMembersById: new Map(),
  }

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
      .provider-select-shell{display:grid;grid-template-columns:minmax(0,1fr) 56px;gap:10px;align-items:stretch}
      .provider-select-shell.full-row{grid-column:1/-1}
      .provider-select-shell label{margin:0}
      .provider-select-label{display:grid;gap:8px}
      .provider-plus-btn{width:36px;height:36px;min-height:36px;flex-shrink:0;align-self:flex-start;border:1px solid var(--border-strong);border-radius:7px;background:var(--bg-input);color:var(--text-2);font-size:18px;font-weight:600;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;padding:0;transition:border-color .18s ease,background .18s ease}
      .provider-plus-btn:hover{border-color:var(--accent);background:var(--bg-hover);color:var(--text-1)}
      .provider-quick-hint{grid-column:1/-1;font-size:12px;color:var(--text-3);margin-top:-4px}
      .request-provider-select{min-height:88px}
      .request-provider-select.provider-live-results{min-height:158px}
      #quickProviderDialog{width:min(720px,calc(100vw - 28px));max-width:720px;margin:auto}
      #quickProviderDialog .modal-content{max-height:90vh;overflow:hidden}
      .quick-provider-destination{display:none}
      .quick-provider-destination.visible{display:flex;flex-direction:column;gap:5px}
      .visit-context-placeholder{border:1px dashed var(--border-strong);border-radius:12px;padding:12px;background:rgba(255,255,255,.018);display:grid;gap:6px;color:var(--text-2)}
      .visit-context-placeholder strong{color:var(--text-1)}
      .visit-context-placeholder span{font-size:12px;color:var(--text-3)}
      .visit-context-placeholder.success{border-style:solid;border-color:rgba(45,212,191,.32);background:rgba(45,212,191,.08)}
      .visit-context-placeholder.warning{border-style:solid;border-color:rgba(245,158,11,.34);background:rgba(245,158,11,.08)}
      .visit-context-placeholder.error{border-style:solid;border-color:rgba(244,63,94,.34);background:rgba(244,63,94,.08)}
      @media (max-width:720px){
        .provider-select-shell{grid-template-columns:1fr}
        .provider-plus-btn{width:100%;min-height:46px}
      }
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
    const visitContextSection = createSection("requestVisitContextSection", "Contexto operativo", "Campo opcional para relacionar el pago con una visita o incidencia registrada.")
    const paymentGrid = paymentSection.querySelector(".form-grid")
    const providerGrid = providerSection.querySelector(".form-grid")
    const budgetGrid = budgetSection.querySelector(".form-grid")

    const heading = paymentSection.querySelector("h3")
    if (heading) heading.textContent = "Datos del pago"

    moveControls(paymentGrid, ["requestType", "amountRequested", "currency", "exchangeRate", "isExtraordinaryAdjustment", "description", "notes", "requestFile"])
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
    if (document.getElementById("providerDropdown")) return
    const searchLabel = labelForControl("providerSearch")
    const selectLabel = labelForControl("proveedorId")
    const quickLink = document.getElementById("addProviderQuickLink")
    if (!searchLabel || !selectLabel) return

    searchLabel.classList.add("full-row")
    selectLabel.classList.add("full-row")
    dom.providerSearch.placeholder = "Escribe alias, razon social o RFC"
    dom.proveedorId.classList.add("request-provider-select")

    const providerShell = ensureProviderQuickCreateRow(selectLabel)
    quickLink?.remove()

    if (!document.getElementById("selectedProviderSummary")) {
      const summary = document.createElement("div")
      summary.id = "selectedProviderSummary"
      summary.className = "provider-summary-card full-row"
      summary.innerHTML = "<strong>Sin proveedor seleccionado</strong><span>Busca y selecciona un proveedor para ver sus datos.</span>"
      providerShell.insertAdjacentElement("afterend", summary)
    }
    renderProviderSummary()
  }

  function ensureProviderQuickCreateRow(selectLabel) {
    let shell = document.getElementById("requestProviderSelectShell")
    if (!shell) {
      shell = document.createElement("div")
      shell.id = "requestProviderSelectShell"
      shell.className = "provider-select-shell full-row"
      selectLabel.insertAdjacentElement("beforebegin", shell)
      shell.appendChild(selectLabel)
    } else if (!shell.contains(selectLabel)) {
      shell.insertBefore(selectLabel, shell.firstChild)
    }

    selectLabel.classList.remove("full-row")
    selectLabel.classList.add("provider-select-label")

    let button = document.getElementById("newProviderFromRequestBtn")
    if (!button) {
      button = document.createElement("button")
      button.id = "newProviderFromRequestBtn"
      button.type = "button"
    }
    button.className = "provider-plus-btn"
    button.textContent = "+"
    button.title = "Crear proveedor sin salir de la solicitud"
    button.setAttribute("aria-label", "Crear proveedor sin salir de la solicitud")
    if (button.parentElement !== shell) shell.appendChild(button)

    let hint = document.getElementById("newProviderPermissionHint")
    if (!hint) {
      hint = document.createElement("span")
      hint.id = "newProviderPermissionHint"
    }
    hint.className = "provider-quick-hint"
    if (hint.parentElement !== shell) shell.appendChild(hint)

    return shell
  }

  function prepareVisitAssociationPlaceholder(section) {
    if (!section || section.dataset.visitReady === "true") return
    section.dataset.visitReady = "true"
    const grid = section.querySelector(".form-grid")
    if (!grid) return
    grid.innerHTML = `
      <label class="full-row">Visita / Incidencia asociada
        <select id="requestVisitIncidentId" class="form-control">
          <option value="">Sin visita/incidencia asociada</option>
          <option value="" disabled>Cargando visitas/incidencias...</option>
        </select>
      </label>
      <div id="requestVisitIncidentSummary" class="visit-context-placeholder full-row">
        <strong>Asociacion opcional, no requerida para guardar.</strong>
        <span>Selecciona una visita/incidencia si este pago corresponde a un cargo registrado en Ingresos e incidencias. La referencia se guardara en notas de la solicitud.</span>
      </div>
    `
    loadVisitIncidentOptions()
  }

  function bindEvents() {
    document.getElementById("newProviderFromRequestBtn")?.addEventListener("click", openQuickProviderModal)
    document.getElementById("requestVisitIncidentId")?.addEventListener("change", renderVisitIncidentSummaryFromSelection)
    if (!document.getElementById("providerDropdown")) {
      dom.proveedorId?.addEventListener("change", renderProviderSummary)
      dom.providerSearch?.addEventListener("input", scheduleProviderResultsOpen)
      dom.providerSearch?.addEventListener("focus", scheduleProviderResultsOpen)
      dom.proveedorId?.addEventListener("change", syncProviderSearchFromSelection)
      dom.proveedorId?.addEventListener("change", collapseProviderResults)
    }
    document.getElementById("closeRequestModalBtn")?.addEventListener("click", collapseProviderResults)
    document.getElementById("cancelRequestBtn")?.addEventListener("click", collapseProviderResults)
    dom.requestForm?.addEventListener("submit", () => {
      if (!canApprove() && dom.isExtraordinaryAdjustment) dom.isExtraordinaryAdjustment.checked = false
    }, true)
    dom.requestForm?.addEventListener("submit", attachVisitIncidentToNotes, true)
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

  async function loadVisitIncidentOptions() {
    const select = document.getElementById("requestVisitIncidentId")
    if (!select) return

    try {
      const [incidentsResult, membersResult] = await Promise.all([
        client
          .from("incident_charges")
          .select("id,member_id,external_name,description,amount,incident_date,status")
          .order("incident_date", { ascending: false })
          .limit(100),
        client
          .from("members")
          .select("id,full_name")
          .eq("active", true),
      ])

      if (incidentsResult.error) throw incidentsResult.error

      state.visitMembersById = new Map((membersResult.data || []).map((member) => [member.id, member.full_name]))
      state.visitIncidents = incidentsResult.data || []

      select.innerHTML = `<option value="">Sin visita/incidencia asociada</option>`
      state.visitIncidents.forEach((incident) => {
        const option = document.createElement("option")
        option.value = incident.id
        option.textContent = visitIncidentOptionLabel(incident)
        select.appendChild(option)
      })

      if (!state.visitIncidents.length) {
        renderVisitIncidentSummary("warning", "No hay visitas/incidencias disponibles.", "Crea primero una visita/incidencia en Ingresos e incidencias o guarda la solicitud sin asociarla.")
        return
      }

      renderVisitIncidentSummary("neutral", "Asociacion opcional, no requerida para guardar.", "Selecciona una visita/incidencia si este pago corresponde a un cargo registrado. La referencia se guardara en notas de la solicitud.")
    } catch (error) {
      state.visitIncidents = []
      select.innerHTML = `<option value="">Sin visita/incidencia asociada</option>`
      renderVisitIncidentSummary("error", "No se pudieron cargar visitas/incidencias.", visitIncidentFriendlyError(error))
    }
  }

  function renderVisitIncidentSummaryFromSelection() {
    const incident = selectedVisitIncident()
    if (!incident) {
      renderVisitIncidentSummary("neutral", "Asociacion opcional, no requerida para guardar.", "Selecciona una visita/incidencia si este pago corresponde a un cargo registrado. La referencia se guardara en notas de la solicitud.")
      return
    }

    renderVisitIncidentSummary(
      "success",
      "Visita/incidencia vinculada a esta solicitud.",
      `${visitIncidentReceiverName(incident)} | ${formatDate(incident.incident_date)} | ${formatCurrency(incident.amount)} | ${incidentStatusLabel(incident.status)}`
    )
  }

  function renderVisitIncidentSummary(type, title, text) {
    const summary = document.getElementById("requestVisitIncidentSummary")
    if (!summary) return
    summary.classList.remove("success", "warning", "error")
    if (type && type !== "neutral") summary.classList.add(type)
    summary.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`
  }

  function selectedVisitIncident() {
    const id = document.getElementById("requestVisitIncidentId")?.value || ""
    if (!id) return null
    return state.visitIncidents.find((incident) => incident.id === id) || null
  }

  function attachVisitIncidentToNotes() {
    const notes = document.getElementById("notes")
    if (!notes) return

    const cleanNotes = String(notes.value || "").replace(/\n?\[Visita\/incidencia asociada:[^\]]+\]/g, "").trim()
    const incident = selectedVisitIncident()
    if (!incident) {
      notes.value = cleanNotes
      return
    }

    const marker = `[Visita/incidencia asociada: ${incident.id} - ${visitIncidentOptionLabel(incident)}]`
    notes.value = [cleanNotes, marker].filter(Boolean).join("\n")
  }

  function visitIncidentOptionLabel(incident) {
    return [
      formatDate(incident.incident_date),
      visitIncidentReceiverName(incident),
      incident.description || "Sin descripcion",
      formatCurrency(incident.amount),
      incidentStatusLabel(incident.status),
    ].filter(Boolean).join(" | ")
  }

  function visitIncidentReceiverName(incident) {
    if (!incident) return "Sin receptor"
    if (incident.member_id) return state.visitMembersById.get(incident.member_id) || "Socio"
    return incident.external_name || "Externo"
  }

  function incidentStatusLabel(status) {
    const labels = { open: "Abierta", invoiced: "Facturada", paid: "Pagada", cancelled: "Cancelada" }
    return labels[status] || status || "Sin estatus"
  }

  function visitIncidentFriendlyError(error) {
    const message = error?.message || String(error || "Error desconocido")
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") {
      return "No tienes permiso para consultar visitas/incidencias. Puedes guardar la solicitud sin asociarla."
    }
    return "Puedes guardar la solicitud sin asociarla y revisar el modulo de Ingresos e incidencias despues."
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
              <h2 style="color:var(--text-1)">Nuevo proveedor</h2>
              <p>Alta rapida sin salir de la solicitud.</p>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="demo-fill-btn" data-demo-quick-provider>⚡ Demo</button>
              <button type="button" class="icon-btn" data-close-quick-provider>✕</button>
            </div>
          </div>
          <div class="modal-scroll">
          <div class="form-grid">
            <label>Alias / nombre visible *<input id="quickProviderAlias" class="form-control" required></label>
            <label>Razon social / nombre completo *<input id="quickProviderName" class="form-control" required></label>
            <label>Tipo de destino de pago * <span style="font-weight:400;text-transform:none">(no aplica para efectivo)</span>
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
    document.querySelector("[data-demo-quick-provider]")?.addEventListener("click", fillDemoQuickProvider)
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

  // Botón Demo: rellena el form de proveedor con datos de prueba.
  function fillDemoQuickProvider() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val }
    const stamp = String(Date.now()).slice(-4)
    set("quickProviderAlias", `Test - Proveedor Demo ${stamp}`)
    set("quickProviderName", `Test - Proveedor Demo ${stamp} SA de CV`)
    set("quickProviderPaymentMethod", "Transferencia bancaria")
    set("quickProviderDestinationType", "clabe")
    updateQuickProviderDestinationFields()
    set("quickProviderBeneficiary", `Test - Proveedor Demo ${stamp} SA de CV`)
    set("quickProviderRfc", "XAXX010101000")
    set("quickProviderPhone", "5512345678")
    set("quickProviderEmail", "demo@example.com")
    set("quickProviderBank", "BBVA")
    set("quickProviderClabe", "012180001234567895")
    set("quickProviderNotes", "Proveedor generado con el botón Demo")
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

    const { data, error } = await client.from("proveedores").insert(payload).select("id,alias,nombre_completo,rfc,banco,clabe,cuenta_bancaria,activo").single()
    if (error) {
      showToast("No se pudo crear proveedor", providerCreateFriendlyError(error), "error")
      return
    }

    closeQuickProviderModal()
    // Inyectar al combobox de solicitudes.js y seleccionarlo
    if (typeof window.fluxRegisterProvider === "function") {
      window.fluxRegisterProvider(data)
    } else {
      if (dom.proveedorId) dom.proveedorId.value = data.id
      if (dom.providerSearch) dom.providerSearch.value = data.alias || data.nombre_completo || ""
    }
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

  function formatCurrency(value) {
    const amount = Number(value || 0)
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number.isFinite(amount) ? amount : 0)
  }

  function formatDate(value) {
    if (!value) return "Sin fecha"
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date)
  }

  function destinationTypeLabel(type) {
    const labels = { clabe: "CLABE", cuenta: "Cuenta bancaria", convenio: "Convenio" }
    return labels[type] || type || "Sin destino"
  }

  function showToast(title, message, type = "success") {
    // Usar el toast global de components.js (popover → visible sobre modales).
    // variant: components usa "danger"/"warning"/"info"/"success".
    if (window.Components?.showToast) {
      const variant = type === "error" ? "danger" : type
      window.Components.showToast({ title, desc: message, variant })
      return
    }
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
