;(function paymentBatchUi() {
  "use strict"

  const RPC = Object.freeze({
    context: "get_payment_batch_context",
    createBatch: "create_payment_ingestion_batch",
    finalizeBatch: "finalize_payment_ingestion_upload",
    submitExtractions: "submit_payment_document_extractions",
    listBatches: "list_payment_ingestion_batches",
    batchDetail: "get_payment_ingestion_batch_detail",
    acceptExtraction: "accept_payment_document_extraction",
    rejectExtraction: "reject_payment_document_extraction",
    candidates: "find_payment_allocation_candidates",
    propose: "propose_payment_allocations",
    reserve: "reserve_payment_allocations",
    expireReservation: "expire_payment_reservation",
    releaseReservation: "release_payment_reservation",
    cancelPlan: "cancel_payment_allocation_plan",
  })
  const PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const parser = window.FluxPaymentBatchParser
  const state = { context: null, batches: [], selectedId: null, detail: null, operation: null, candidates: [], candidateOperationId: null, summaryFilter: "", trigger: null, busy: false, detailRequest: 0, candidateRequest: 0 }
  const dom = {}

  document.addEventListener("DOMContentLoaded", init)

  async function init() {
    bindDom()
    bindEvents()
    applyTheme()
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER
    if (!client || !parser || !window.pdfjsLib) return renderBlocked("Módulo incompleto", "No se cargaron las dependencias seguras de conciliación.")
    if (window.FluxAuth?.ready) await window.FluxAuth.ready()
    const session = window.FluxAuth?.state?.session
    const profile = window.FluxAuth?.getProfile?.()
    if (!session) return window.location.replace("./index.html")
    dom.userName.textContent = profile?.full_name || session.user?.email || "Usuario"
    dom.userEmail.textContent = profile?.email || session.user?.email || "Sesión activa"
    try {
      const { data, error } = await client.rpc(RPC.context)
      if (error) throw error
      state.context = object(data)
      if (state.context.allowed === false || state.context.can_access === false) return renderBlocked("Acceso restringido", state.context.block_reason || "No tienes capacidad asignada para consultar conciliaciones.")
      populateCompanies(array(state.context.companies))
      dom.accessState.hidden = true
      dom.batchWorkspace.hidden = false
      syncCapabilities()
      await loadBatches()
    } catch (error) {
      renderBlocked("Backend pendiente", friendlyError(error))
    }
  }

  function bindDom() {
    ;["userName","userEmail","logoutBtn","themeToggle","accessState","accessTitle","accessMessage","accessHome","batchWorkspace","refreshBtn","newBatchBtn","batchSearch","batchStatusFilter","batchList","batchDetail","countTotal","countProcessing","countReview","countCompleted","countFailed","newBatchDialog","newBatchForm","closeNewBatchBtn","cancelNewBatchBtn","batchCompanyId","batchPdfFile","batchPdfHint","uploadProgress","uploadProgressFill","uploadProgressText","uploadError","submitNewBatchBtn","operationDialog","operationTitle","operationSubtitle","operationContent","closeOperationBtn","openSourcePdfBtn","acceptExtractionBtn","rejectExtractionBtn","findCandidatesBtn","proposePlanBtn","reservePlanBtn","expireReservationBtn","releaseReservationBtn","cancelPlanBtn","confirmOperationBtn","operationActionReason","operationReasonInput"].forEach((id) => { dom[id] = document.getElementById(id) })
  }

  function bindEvents() {
    dom.logoutBtn.addEventListener("click", async () => { await client?.auth.signOut(); window.location.href = "./index.html" })
    dom.themeToggle.addEventListener("click", toggleTheme)
    dom.refreshBtn.addEventListener("click", () => loadBatches(true))
    dom.newBatchBtn.addEventListener("click", openNewBatch)
    dom.closeNewBatchBtn.addEventListener("click", closeNewBatch)
    dom.cancelNewBatchBtn.addEventListener("click", closeNewBatch)
    dom.newBatchForm.addEventListener("submit", submitBatch)
    dom.batchPdfFile.addEventListener("change", validateSelectedFile)
    dom.batchSearch.addEventListener("input", renderBatchList)
    dom.batchStatusFilter.addEventListener("change", renderBatchList)
    dom.batchList.addEventListener("click", (event) => { const button = event.target.closest("[data-batch-id]"); if (button) openBatch(button.dataset.batchId) })
    dom.batchDetail.addEventListener("click", (event) => { const button = event.target.closest("[data-operation-id]"); if (button) openOperation(button.dataset.operationId, button) })
    document.querySelectorAll("[data-summary-filter]").forEach((button) => button.addEventListener("click", () => { state.summaryFilter = button.dataset.summaryFilter; updateSummaryFilter(); renderBatchList() }))
    dom.closeOperationBtn.addEventListener("click", () => dom.operationDialog.close())
    dom.operationDialog.addEventListener("close", () => { state.candidateRequest += 1; state.candidates = []; state.candidateOperationId = null; state.trigger?.focus() })
    dom.openSourcePdfBtn.addEventListener("click", openSourcePdf)
    dom.acceptExtractionBtn.addEventListener("click", acceptExtraction)
    dom.rejectExtractionBtn.addEventListener("click", rejectExtraction)
    dom.findCandidatesBtn.addEventListener("click", loadCandidates)
    dom.proposePlanBtn.addEventListener("click", proposePlan)
    dom.reservePlanBtn.addEventListener("click", reservePlan)
    dom.expireReservationBtn.addEventListener("click", expireReservation)
    dom.releaseReservationBtn.addEventListener("click", releaseReservation)
    dom.cancelPlanBtn.addEventListener("click", cancelPlan)
    dom.operationReasonInput.addEventListener("input", syncOperationActions)
  }

  function applyTheme() { const theme = localStorage.getItem("flux-theme"); if (theme) document.documentElement.dataset.theme = theme }
  function toggleTheme() { const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; localStorage.setItem("flux-theme", next) }
  function renderBlocked(title, message) { dom.batchWorkspace.hidden = true; dom.accessState.hidden = false; dom.accessTitle.textContent = title; dom.accessMessage.textContent = message; dom.accessHome.hidden = false }

  function capabilities() { const nested = object(state.context?.capabilities); return Object.keys(nested).length ? nested : object(state.context) }
  function can(name) { return capabilities()[name] === true }
  function syncCapabilities() { dom.newBatchBtn.hidden = !can("can_ingest"); dom.newBatchBtn.disabled = !can("can_ingest") }
  function populateCompanies(companies) { dom.batchCompanyId.innerHTML = `<option value="">Selecciona…</option>${companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.legal_name || company.name || "Empresa")}</option>`).join("")}` }

  async function loadBatches(announce = false) {
    setBusy(true)
    try {
      const { data, error } = await client.rpc(RPC.listBatches, { p_company_id: null, p_status: null, p_limit: 50 })
      if (error) throw error
      state.batches = array(data?.items || data)
      renderSummary()
      renderBatchList()
      if (state.selectedId && state.batches.some((batch) => batch.id === state.selectedId)) await openBatch(state.selectedId)
      if (announce) toast("Bandeja actualizada", "Se consultó el estado más reciente.", "success")
    } catch (error) {
      dom.batchList.innerHTML = `<div class="receipt-batch-empty">${escapeHtml(friendlyError(error))}</div>`
      toast("No se pudieron cargar los batches", friendlyError(error), "danger")
    } finally { setBusy(false) }
  }

  function renderSummary() {
    const count = (statuses) => state.batches.filter((batch) => statuses.includes(batchStatus(batch))).length
    dom.countTotal.textContent = String(state.batches.length)
    dom.countProcessing.textContent = String(count(["awaiting_upload","extracting"]))
    dom.countReview.textContent = String(count(["review_required"]))
    dom.countCompleted.textContent = String(count(["ready"]))
    dom.countFailed.textContent = String(count(["failed","cancelled"]))
  }

  function renderBatchList() {
    const query = normalize(dom.batchSearch.value)
    const selectStatus = dom.batchStatusFilter.value
    const rows = state.batches.filter((batch) => {
      const status = batchStatus(batch)
      const summaryMatch = !state.summaryFilter
        || status === state.summaryFilter
        || (state.summaryFilter === "processing" && ["awaiting_upload","extracting"].includes(status))
        || (state.summaryFilter === "failed" && status === "cancelled")
      return summaryMatch && (!selectStatus || status === selectStatus) && normalize([batch.batch_number,batch.public_folio,batch.company_name,batch.original_file_name].join(" ")).includes(query)
    })
    dom.batchList.innerHTML = rows.length ? rows.map((batch) => `<button class="receipt-batch-list-item${batch.id === state.selectedId ? " active" : ""}" type="button" data-batch-id="${escapeHtml(batch.id)}"><span class="receipt-batch-list-head"><strong>${escapeHtml(batch.batch_number || batch.public_folio || shortId(batch.id))}</strong>${badge(statusLabel(batchStatus(batch)), statusTone(batchStatus(batch)))}</span><span>${escapeHtml(batch.company_name || "Empresa")}</span><span class="receipt-batch-meta"><span>${escapeHtml(batch.original_file_name || "Documento PDF")}</span><span>${formatDateTime(batch.created_at)}</span></span></button>`).join("") : `<div class="receipt-batch-empty">No hay batches para este filtro.</div>`
  }

  async function openBatch(batchId) {
    const requestId = ++state.detailRequest
    state.selectedId = batchId
    state.operation = null
    state.candidates = []
    state.candidateOperationId = null
    state.candidateRequest += 1
    if (dom.operationDialog.open) dom.operationDialog.close()
    renderBatchList()
    dom.batchDetail.innerHTML = `<div class="receipt-batch-empty">Cargando detalle…</div>`
    const { data, error } = await client.rpc(RPC.batchDetail, { p_batch_id: batchId })
    if (requestId !== state.detailRequest || state.selectedId !== batchId) return
    if (error) { dom.batchDetail.innerHTML = `<div class="receipt-batch-empty">${escapeHtml(friendlyError(error))}</div>`; return }
    state.detail = object(data)
    renderBatchDetail()
    refreshOpenOperationFromDetail()
  }

  function renderBatchDetail() {
    const batch = object(state.detail.batch || state.detail.ingestion_batch)
    const documents = state.detail.document ? [object(state.detail.document)] : array(state.detail.documents)
    const operations = batchOperations(state.detail)
    const events = array(state.detail.events)
    dom.batchDetail.innerHTML = `<div class="receipt-batch-detail-head"><div><h2>${escapeHtml(batch.batch_number || batch.public_folio || shortId(batch.id))}</h2><p>${escapeHtml(batch.company_name || "Empresa")} · ${escapeHtml(batch.original_file_name || "Documento PDF")}</p></div>${badge(statusLabel(batchStatus(batch)), statusTone(batchStatus(batch)))}</div><div class="receipt-batch-metrics">${metric("Documentos", documents.length)}${metric("Páginas / extracciones", operations.length)}${metric("Por revisar", operations.filter((item) => operationStatus(item) === "review_required").length)}${metric("Aceptadas", operations.filter((item) => Boolean(item.bank_operation_id)).length)}</div><section class="receipt-batch-section"><h3>Operaciones extraídas</h3><div class="receipt-batch-table-wrap"><table class="receipt-batch-table"><caption class="sr-only">Operaciones bancarias extraídas</caption><thead><tr><th scope="col">Página</th><th scope="col">Fecha / referencia</th><th scope="col">Beneficiario / concepto</th><th scope="col">Importe</th><th scope="col">Extracción</th><th scope="col">Conciliación</th><th scope="col"><span class="sr-only">Acción</span></th></tr></thead><tbody>${operations.length ? operations.map(operationRow).join("") : `<tr><td colspan="7" class="empty-state"><strong>Sin operaciones</strong>La extracción puede seguir en proceso.</td></tr>`}</tbody></table></div></section><section class="receipt-batch-section"><h3>Historial</h3>${events.length ? `<ol class="receipt-batch-event-list">${events.map((event) => `<li class="receipt-batch-event"><strong>${escapeHtml(event.label || event.event_type || "Evento")}</strong>${escapeHtml(event.actor_name || "Sistema")} · ${formatDateTime(event.created_at)}</li>`).join("")}</ol>` : `<div class="receipt-batch-empty">Sin eventos visibles.</div>`}</section>`
  }

  function operationRow(operation) {
    const amount = amountMinor(operation)
    return `<tr><td class="receipt-batch-page-ref">${escapeHtml(operation.source_page || operation.page_number || "—")}</td><td><strong>${escapeHtml(operation.application_date || operation.operation_date || "Sin fecha")}</strong><span class="muted-line">${escapeHtml(operation.bank_unique_folio || operation.bank_reference || "Sin referencia")}</span></td><td><strong>${escapeHtml(operation.beneficiary_name || "Por identificar")}</strong><span class="muted-line">${escapeHtml(operation.payment_reason || operation.concept || "Sin concepto")}</span></td><td><strong>${formatMinor(amount, operation.currency)}</strong></td><td>${badge(statusLabel(operationStatus(operation)), statusTone(operationStatus(operation)))}</td><td>${badge(statusLabel(reconciliationStatus(operation)), statusTone(reconciliationStatus(operation)))}</td><td><button class="small-btn" type="button" data-operation-id="${escapeHtml(operation.id)}">Revisar</button></td></tr>`
  }

  function openOperation(operationId, trigger) {
    const operations = batchOperations(state.detail)
    const operation = operations.find((item) => item.id === operationId)
    if (!operation) return
    state.operation = operation
    state.candidates = []
    state.candidateOperationId = null
    state.candidateRequest += 1
    state.trigger = trigger
    dom.operationReasonInput.value = ""
    dom.operationTitle.textContent = `Operación · página ${operation.source_page || operation.page_number || "—"}`
    dom.operationSubtitle.textContent = operation.bank_unique_folio || operation.bank_reference || "Sin referencia bancaria"
    renderOperation()
    dom.operationDialog.showModal()
  }

  function renderOperation() {
    const operation = state.operation
    const issues = array(operation.review_issues || operation.issues)
    const plan = object(operation.plan || operation.allocation_plan)
    const sourceDocument = object(state.detail?.document || array(state.detail?.documents)[0])
    const extractionId = operation.extraction_id || operation.payment_document_extraction_id
    const extractionStatus = operationStatus(operation)
    const bankOperationId = operation.bank_operation_id
    dom.operationContent.innerHTML = `<div class="receipt-operation-summary">${operationCard("Fecha", operation.application_date || operation.operation_date || "Sin fecha")}${operationCard("Importe", formatMinor(amountMinor(operation), operation.currency))}${operationCard("Remanente financiero", formatMinor(operation.financial_remainder_minor ?? amountMinor(operation), operation.currency))}${operationCard("Disponible para reservar", formatMinor(operation.available_minor ?? amountMinor(operation), operation.currency))}${operationCard("Beneficiario", operation.beneficiary_name || "Por identificar")}${operationCard("Referencia", operation.bank_unique_folio || operation.bank_reference || "Sin referencia")}${operationCard("Extracción", statusLabel(extractionStatus))}</div>${extractionNotice(extractionStatus, issues, operation.rejection_reason)}<section class="data-section"><div class="section-heading">Evidencia extraída y redactada</div><pre class="receipt-evidence">${escapeHtml(array(operation.evidence_excerpt).join("\n") || "Sin extracto disponible.")}</pre></section><section class="data-section"><div class="section-heading">Candidatas pagables</div><div class="receipt-candidate-list" id="candidateList">${renderCandidates(operation, plan)}</div></section>${planNotice(plan)}`
    const sourceAvailable = sourceDocument.storage_bucket === "payment-batch-documents"
      && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.pdf$/i.test(sourceDocument.storage_path || "")
    dom.openSourcePdfBtn.disabled = !sourceAvailable || state.busy
    dom.openSourcePdfBtn.title = sourceAvailable ? `Abrir la página ${operation.page_number || 1} del PDF fuente` : "El backend aún no expone la ruta privada del PDF."
    dom.openSourcePdfBtn.setAttribute("aria-label", dom.openSourcePdfBtn.title)
    syncOperationActions()
  }

  function syncOperationActions() {
    const operation = state.operation
    if (!operation) return
    const plan = object(operation.plan || operation.allocation_plan)
    const extractionId = operation.extraction_id || operation.payment_document_extraction_id
    const extractionStatus = operationStatus(operation)
    const bankOperationId = operation.bank_operation_id
    const openPlan = ["draft","reserved"].includes(plan.status)
    const planItems = array(plan.items)
    const activeReservation = plan.reservation_status === "active" && Boolean(plan.reservation_id)
    const expirableReservation = plan.status === "reserved"
      && plan.reservation_status === "expired"
      && plan.reservation_expired === true
      && Boolean(plan.reservation_id)
    const validReason = dom.operationReasonInput.value.trim().length >= 10
    dom.acceptExtractionBtn.hidden = !extractionId
    dom.acceptExtractionBtn.disabled = !can("can_review") || !extractionId || !operation.extraction_updated_at || extractionStatus !== "review_required" || state.busy
    dom.rejectExtractionBtn.hidden = !extractionId
    dom.rejectExtractionBtn.disabled = !can("can_review") || !extractionId || !operation.extraction_updated_at || !["review_required","blocked"].includes(extractionStatus) || !validReason || state.busy
    dom.findCandidatesBtn.disabled = !can("can_propose") || !bankOperationId || openPlan || state.busy
    dom.proposePlanBtn.disabled = !can("can_propose") || !bankOperationId || openPlan || state.candidateOperationId !== bankOperationId || !state.candidates.length || state.busy
    dom.reservePlanBtn.disabled = !can("can_reserve") || !plan.id || plan.status !== "draft" || !planItems.length || state.busy
    dom.expireReservationBtn.disabled = !can("can_reserve") || !expirableReservation || state.busy
    dom.releaseReservationBtn.disabled = !can("can_reserve") || !activeReservation || !validReason || state.busy
    dom.cancelPlanBtn.disabled = !can("can_propose") || !plan.id || !openPlan || expirableReservation || !validReason || state.busy
    dom.operationReasonInput.disabled = state.busy || !(
      (can("can_review") && ["review_required","blocked"].includes(extractionStatus))
      || (can("can_reserve") && activeReservation)
      || (can("can_propose") && openPlan && !expirableReservation)
    )
    dom.confirmOperationBtn.disabled = true
    dom.operationActionReason.textContent = actionReason()
  }

  function extractionNotice(status, issues, rejectionReason) {
    if (status === "blocked") return `<div class="notice-v2 warning"><span class="notice-icon">!</span><span><span class="notice-title">Extracción bloqueada</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(issues.length ? issues.map(issueLabel).join(", ") : "Faltan datos bancarios válidos; revisa el PDF fuente y rechaza si corresponde.")}</span></span></div>`
    if (status === "rejected") return `<div class="notice-v2 danger"><span class="notice-icon">!</span><span><span class="notice-title">Extracción rechazada</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(rejectionReason ? `Motivo: ${rejectionReason}` : "No puede convertirse en operación bancaria.")}</span></span></div>`
    if (status === "accepted") return `<div class="notice-v2 success"><span class="notice-icon">✓</span><span><span class="notice-title">Extracción aceptada</span><span class="notice-sep">—</span><span class="notice-desc">La operación bancaria canónica ya fue creada.</span></span></div>`
    if (issues.length) return `<div class="notice-v2 warning"><span class="notice-icon">!</span><span><span class="notice-title">Revisión requerida</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(issues.map(issueLabel).join(", "))}</span></span></div>`
    return `<div class="notice-v2 success"><span class="notice-icon">✓</span><span><span class="notice-title">Extracción lista para revisión</span><span class="notice-sep">—</span><span class="notice-desc">Abre el PDF fuente y valida los datos antes de aceptar.</span></span></div>`
  }

  function planNotice(plan) {
    if (!plan.id) return ""
    const status = [statusLabel(plan.status || "draft")]
    if (plan.reservation_status) status.push(`Reserva ${statusLabel(plan.reservation_status).toLowerCase()}`)
    const reason = plan.cancel_reason || plan.close_reason
    if (reason) status.push(`Motivo: ${reason}`)
    return `<div class="notice-v2 info"><span class="notice-icon">i</span><span><span class="notice-title">Plan ${escapeHtml(shortId(plan.id))}</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(status.join(" · "))}</span></span></div>`
  }

  function renderCandidates(operation, plan) {
    if (!operation.bank_operation_id) return `<div class="receipt-batch-empty">Acepta una extracción válida para crear la operación bancaria antes de buscar candidatas.</div>`
    if (["draft","reserved"].includes(plan.status)) return renderPlanItems(plan)
    if (state.candidateOperationId !== operation.bank_operation_id || !state.candidates.length) return `<div class="receipt-batch-empty">Busca solicitudes candidatas después de aceptar la extracción.</div>`
    return state.candidates.map((candidate) => `<label class="receipt-candidate"><input type="checkbox" data-candidate-check value="${escapeHtml(candidate.snapshot_id)}"><span class="receipt-candidate-main"><strong>${escapeHtml(candidate.request_number || "Solicitud")}</strong><span>${escapeHtml(candidate.proveedor_name || "Proveedor")} · saldo ${escapeHtml(formatMinor(candidate.available_minor ?? 0, candidate.currency))}</span></span><input class="f-ctrl" type="text" inputmode="decimal" data-candidate-amount placeholder="0.00" aria-label="Monto a asignar a ${escapeHtml(candidate.request_number || "solicitud")}"></label>`).join("")
  }

  function renderPlanItems(plan) {
    const items = array(plan.items)
    if (!items.length) return `<div class="receipt-batch-empty">El plan no expone asignaciones verificables; no puede reservarse.</div>`
    return items.map((item) => `<div class="receipt-candidate receipt-candidate-readonly"><span class="receipt-plan-position">${escapeHtml(item.position || "—")}</span><span class="receipt-candidate-main"><strong>${escapeHtml(item.request_number || "Solicitud")}</strong><span>${escapeHtml(item.proveedor_name || "Proveedor")} · snapshot ${escapeHtml(shortId(item.snapshot_id))}</span></span><strong class="receipt-plan-amount">${escapeHtml(formatMinor(item.amount_minor || 0, item.currency || plan.currency))}</strong></div>`).join("")
  }

  async function acceptExtraction() {
    const extractionId = state.operation?.extraction_id || state.operation?.payment_document_extraction_id
    if (!extractionId || !state.operation?.extraction_updated_at || operationStatus(state.operation) !== "review_required" || !can("can_review")) return
    await mutate(RPC.acceptExtraction, {
      p_extraction_id: extractionId,
      p_expected_updated_at: state.operation.extraction_updated_at,
      p_idempotency_key: commandId(),
    }, "Extracción aceptada")
  }

  async function openSourcePdf() {
    const sourceDocument = object(state.detail?.document || array(state.detail?.documents)[0])
    const pageNumber = Math.max(1, Number(state.operation?.page_number) || 1)
    if (state.busy || sourceDocument.storage_bucket !== "payment-batch-documents"
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.pdf$/i.test(sourceDocument.storage_path || "")) return
    const preview = window.open("about:blank", "_blank")
    if (!preview) return toast("Ventana bloqueada", "Permite ventanas emergentes para abrir el PDF fuente.", "warning")
    preview.opener = null
    setBusy(true)
    try {
      const { data, error } = await client.storage
        .from(sourceDocument.storage_bucket)
        .createSignedUrl(sourceDocument.storage_path, 300)
      if (error || !data?.signedUrl) throw error || new Error("source_pdf_url_unavailable")
      const signedUrl = new URL(data.signedUrl, window.location.origin)
      signedUrl.hash = `page=${pageNumber}`
      preview.location.replace(signedUrl.href)
    } catch (error) {
      preview.close()
      toast("No se pudo abrir el PDF", friendlyError(error), "danger")
    } finally { setBusy(false) }
  }

  async function rejectExtraction() {
    const extractionId = state.operation?.extraction_id || state.operation?.payment_document_extraction_id
    const reason = dom.operationReasonInput.value.trim()
    if (!can("can_review") || !extractionId || !state.operation?.extraction_updated_at || !["review_required","blocked"].includes(operationStatus(state.operation))) return
    if (reason.length < 10) return toast("Motivo requerido", "Describe el rechazo con al menos 10 caracteres.", "warning")
    await mutate(RPC.rejectExtraction, {
      p_extraction_id: extractionId,
      p_expected_updated_at: state.operation.extraction_updated_at,
      p_reason: reason,
      p_idempotency_key: commandId(),
    }, "Extracción rechazada")
  }

  async function loadCandidates() {
    const operationId = state.operation?.bank_operation_id
    const plan = object(state.operation?.plan || state.operation?.allocation_plan)
    if (!operationId || !can("can_propose") || ["draft","reserved"].includes(plan.status)) return
    const requestId = ++state.candidateRequest
    state.candidates = []
    state.candidateOperationId = null
    setBusy(true)
    try {
      const { data, error } = await client.rpc(RPC.candidates, { p_operation_id: operationId, p_limit: 20 })
      if (requestId !== state.candidateRequest
        || state.operation?.bank_operation_id !== operationId
        || !dom.operationDialog.open) return
      if (error) throw error
      state.candidates = array(data?.items || data)
      state.candidateOperationId = operationId
      renderOperation()
    } catch (error) {
      if (requestId === state.candidateRequest && state.operation?.bank_operation_id === operationId) {
        toast("No se pudieron buscar candidatas", friendlyError(error), "danger")
      }
    } finally { setBusy(false) }
  }

  async function proposePlan() {
    const operationId = state.operation?.bank_operation_id
    const plan = object(state.operation?.plan || state.operation?.allocation_plan)
    if (!operationId || state.candidateOperationId !== operationId || !can("can_propose") || ["draft","reserved"].includes(plan.status)) return
    const rows = Array.from(dom.operationContent.querySelectorAll(".receipt-candidate"))
    const selectedRows = rows.filter((row) => row.querySelector("[data-candidate-check]")?.checked)
    if (!selectedRows.length) return toast("Asignaciones requeridas", "Selecciona al menos una solicitud candidata.", "warning")
    const allocations = selectedRows.map((row) => ({ snapshot_id: row.querySelector("[data-candidate-check]").value, amount_minor: parser.parseMoneyToMinor(row.querySelector("[data-candidate-amount]").value) }))
    if (allocations.some((item) => !item.snapshot_id || !Number.isInteger(item.amount_minor) || item.amount_minor <= 0)) return toast("Importes inválidos", "Cada solicitud seleccionada necesita un importe válido mayor a cero.", "warning")
    await mutate(RPC.propose, { p_operation_id: operationId, p_allocations: allocations, p_idempotency_key: commandId() }, "Plan propuesto")
  }

  async function reservePlan() {
    const plan = object(state.operation?.plan || state.operation?.allocation_plan)
    if (!can("can_reserve") || !plan.id || plan.status !== "draft" || !array(plan.items).length) return
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    await mutate(RPC.reserve, { p_plan_id: plan.id, p_expires_at: expires, p_idempotency_key: commandId() }, "Capacidad reservada")
  }

  async function expireReservation() {
    const plan = object(state.operation?.plan || state.operation?.allocation_plan)
    if (!can("can_reserve") || !plan.reservation_id || plan.status !== "reserved"
      || plan.reservation_status !== "expired" || plan.reservation_expired !== true) return
    await mutate(RPC.expireReservation, {
      p_reservation_id: plan.reservation_id,
      p_idempotency_key: commandId(),
    }, "Reserva expirada")
  }

  async function releaseReservation() {
    const plan = object(state.operation?.plan || state.operation?.allocation_plan)
    const reason = dom.operationReasonInput.value.trim()
    if (!can("can_reserve") || !plan.reservation_id || plan.reservation_status !== "active") return
    if (reason.length < 10) return toast("Motivo requerido", "Describe la liberación con al menos 10 caracteres.", "warning")
    await mutate(RPC.releaseReservation, {
      p_reservation_id: plan.reservation_id,
      p_reason: reason,
      p_idempotency_key: commandId(),
    }, "Reserva liberada")
  }

  async function cancelPlan() {
    const plan = object(state.operation?.plan || state.operation?.allocation_plan)
    const reason = dom.operationReasonInput.value.trim()
    if (!can("can_propose") || !plan.id || !["draft","reserved"].includes(plan.status)) return
    if (reason.length < 10) return toast("Motivo requerido", "Describe la cancelación con al menos 10 caracteres.", "warning")
    await mutate(RPC.cancelPlan, {
      p_plan_id: plan.id,
      p_reason: reason,
      p_idempotency_key: commandId(),
    }, "Plan cancelado")
  }

  async function mutate(name, args, successTitle) {
    setBusy(true)
    try {
      const { error } = await client.rpc(name, args)
      if (error) throw error
      toast(successTitle, "El servidor registró la operación con idempotencia.", "success")
      state.candidates = []
      state.candidateOperationId = null
      dom.operationReasonInput.value = ""
      await loadBatches()
    } catch (error) {
      toast("No se pudo completar", friendlyError(error), "danger")
      state.candidates = []
      state.candidateOperationId = null
      await loadBatches()
    } finally { setBusy(false) }
  }

  function openNewBatch() { dom.newBatchForm.reset(); dom.uploadError.textContent = ""; dom.uploadProgress.hidden = true; dom.newBatchDialog.showModal(); dom.batchCompanyId.focus() }
  function closeNewBatch() { if (!state.busy) dom.newBatchDialog.close() }
  function validateSelectedFile() { const error = validateFile(dom.batchPdfFile.files[0]); dom.uploadError.textContent = error || ""; dom.batchPdfHint.textContent = error || (dom.batchPdfFile.files[0] ? `${formatBytes(dom.batchPdfFile.files[0].size)} · listo para procesar` : "Solo PDF. El límite y bucket los autoriza el servidor.") }

  async function submitBatch(event) {
    event.preventDefault()
    if (state.busy) return
    const companyId = String(dom.batchCompanyId.value || "")
    const file = dom.batchPdfFile.files[0]
    if (!companyId) { dom.uploadError.textContent = "Selecciona una empresa."; return }
    const validation = validateFile(file)
    if (validation) { dom.uploadError.textContent = validation; return }
    setBusy(true); setProgress(5, "Leyendo y verificando PDF…")
    try {
      const bytes = await file.arrayBuffer()
      if (!hasPdfSignature(bytes)) throw new Error("invalid_pdf_signature")
      const sha256 = await sha256Hex(bytes)
      const parsed = await parsePdf(bytes, file.name)
      const pages = parsed.operations.map((operation) => ({
        page_number: operation.source_page,
        amount: minorToDecimal(operation.amount_minor),
        currency: operation.currency,
        bank_name: operation.bank_name,
        bank_status: operation.bank_status,
        bank_unique_folio: operation.bank_unique_folio,
        application_date: operation.application_date,
        beneficiary_name: operation.beneficiary_name,
        payment_reason: operation.payment_reason,
        source_account: operation.source_account,
        destination_account: operation.destination_account,
        confidence: operation.review_issues.length === 0 ? 0.99 : operation.review_issues.length <= 2 ? 0.75 : 0.4,
      }))
      setProgress(35, `Extracción local: ${parsed.page_count} página(s).`)
      const createKey = commandId()
      const { data: created, error: createError } = await client.rpc(RPC.createBatch, {
        p_company_id: companyId,
        p_file_name: file.name,
        p_file_size_bytes: file.size,
        p_document_sha256: sha256,
        p_idempotency_key: createKey,
      })
      if (createError) throw createError
      const batchId = created?.batch_id
      const documentId = created?.document_id
      const bucketId = created?.storage_bucket
      const storagePath = created?.storage_path
      if (!batchId || !documentId || !bucketId || !storagePath) throw new Error("upload_contract_incomplete")
      const resumeExtraction = created?.duplicate && created?.status === "extracting"
      if (created?.duplicate && !["awaiting_upload","extracting"].includes(created?.status)) {
        setProgress(100, "El PDF ya existe; se abrió el batch original sin duplicarlo.")
        state.selectedId = batchId
        toast("Batch ya registrado", "Se reutilizó la ingesta existente por su huella SHA-256.", "success")
        await loadBatches()
        dom.newBatchDialog.close()
        return
      }
      if (!resumeExtraction) {
        setProgress(50, "Subiendo al bucket privado autorizado…")
        const bucket = client.storage.from(bucketId)
        const upload = await bucket.upload(storagePath, file, { contentType: "application/pdf", upsert: false })
        if (upload.error && !(created?.duplicate && /exist|duplicate|409/i.test(`${upload.error.statusCode || ""} ${upload.error.message || ""}`))) throw upload.error
        setProgress(68, "Finalizando documento…")
        const { error: finalizeError } = await client.rpc(RPC.finalizeBatch, {
          p_batch_id: batchId,
          p_page_count: parsed.page_count,
          p_idempotency_key: commandId(),
        })
        if (finalizeError) throw finalizeError
      }
      setProgress(78, resumeExtraction ? "Retomando extracción interrumpida…" : "Enviando extracción a revisión interna…")
      const { error: extractionError } = await client.rpc(RPC.submitExtractions, {
        p_batch_id: batchId,
        p_parser_version: parser.PARSER_VERSION,
        p_pages: pages,
        p_idempotency_key: commandId(),
      })
      if (extractionError) throw extractionError
      setProgress(100, "Batch recibido; extracción enviada a revisión.")
      state.selectedId = batchId
      toast("Batch recibido", `${parsed.page_count} página(s) fueron procesadas con ${parser.PARSER_VERSION}.`, "success")
      await loadBatches()
      dom.newBatchDialog.close()
    } catch (error) { dom.uploadError.textContent = friendlyError(error); toast("No se pudo completar la ingesta", friendlyError(error), "danger") } finally { setBusy(false) }
  }

  async function parsePdf(buffer, fileName) {
    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      isEvalSupported: false,
    }).promise
    const maxPages = Number(state.context?.upload_policy?.max_pages || 500)
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) {
      throw new Error("invalid_pdf_page_count")
    }
    const pages = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setProgress(8 + Math.round((pageNumber / pdf.numPages) * 22), `Extrayendo página ${pageNumber} de ${pdf.numPages}…`)
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push({ pageNumber, items: content.items })
    }
    return parser.parseBbvaDocument(pages, { fileName })
  }

  function validateFile(file) {
    if (!file) return "Selecciona un archivo PDF."
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "Solo se admite PDF válido."
    const max = Number(state.context?.upload_policy?.max_file_bytes || 25 * 1024 * 1024)
    if (file.size < 1 || file.size > max) return `El PDF debe pesar máximo ${formatBytes(max)}.`
    return ""
  }

  function setBusy(busy) { state.busy = busy; dom.refreshBtn.disabled = busy; dom.submitNewBatchBtn.disabled = busy; dom.batchCompanyId.disabled = busy; dom.batchPdfFile.disabled = busy; if (dom.operationDialog.open) renderOperation() }
  function setProgress(percent, text) { dom.uploadProgress.hidden = false; dom.uploadProgressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`; dom.uploadProgressText.textContent = text }
  function updateSummaryFilter() { document.querySelectorAll("[data-summary-filter]").forEach((button) => { const active = button.dataset.summaryFilter === state.summaryFilter; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)) }) }
  function actionReason() { if (!can("can_review") && !can("can_propose") && !can("can_reserve")) return state.context?.block_reason || "Acciones no autorizadas."; return "Las capacidades se revalidan en cada RPC." }
  function operationStatus(item) { return item.extraction_status || item.operation_status || item.status || "review_required" }
  function batchOperations(detail) {
    const extractions = new Map(array(detail?.extractions).map((extraction) => [extraction.id, extraction]))
    return array(detail?.operations || detail?.bank_operations).map((operation) => {
      const extraction = object(extractions.get(operation.extraction_id))
      return {
        ...extraction,
        ...operation,
        extraction_id: operation.extraction_id || extraction.id,
        extraction_status: operation.extraction_status || extraction.status,
        extraction_updated_at: operation.extraction_updated_at || extraction.updated_at,
        rejection_reason: operation.rejection_reason || extraction.rejection_reason,
      }
    })
  }
  function refreshOpenOperationFromDetail() {
    if (!state.operation || !dom.operationDialog.open) return
    const operationId = state.operation.id
    const extractionId = state.operation.extraction_id || state.operation.payment_document_extraction_id
    const refreshed = batchOperations(state.detail)
      .find((item) => item.id === operationId || item.extraction_id === extractionId)
    if (!refreshed) { state.operation = null; dom.operationDialog.close(); return }
    state.operation = refreshed
    renderOperation()
  }
  function reconciliationStatus(item) { return item.reconciliation_status || "unreconciled" }
  function batchStatus(item) { return item.batch_status || item.status || "awaiting_upload" }
  function amountMinor(item) { const exact = safeMinorInteger(item.amount_minor); if (exact !== null) return exact; return parser.parseMoneyToMinor(item.amount) || 0 }
  function statusLabel(status) { return ({ awaiting_upload:"Esperando carga",extracting:"Extrayendo",review_required:"Por revisar",accepted:"Aceptada",blocked:"Bloqueada",ready:"Listo",available:"Disponible",draft:"Borrador",reserved:"Reservado",active:"Activa",released:"Liberado",rejected:"Rechazado",cancelled:"Cancelado",expired:"Expirado",unreconciled:"Sin conciliar",failed:"Con incidencia" })[status] || String(status || "Sin estado") }
  function statusTone(status) { if (["accepted","ready","available"].includes(status)) return "success"; if (["failed","rejected"].includes(status)) return "danger"; if (["awaiting_upload","extracting","reserved","review_required","blocked"].includes(status)) return "warning"; if (status === "draft") return "violet"; return "neutral" }
  function issueLabel(value) { return ({ bank_not_identified:"Banco no identificado",operation_date_missing:"Fecha faltante",amount_missing_or_invalid:"Importe inválido",currency_missing_or_invalid:"Moneda inválida",bank_reference_missing:"Referencia faltante",bank_unique_folio_missing:"Folio único faltante",strong_bank_identity_missing:"Cuenta origen empresarial completa faltante",beneficiary_missing:"Beneficiario faltante",bank_status_not_operated:"Estado bancario distinto de Operado" })[value] || value }
  function metric(label, value) { return `<div class="receipt-batch-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` }
  function operationCard(label, value) { return `<div class="receipt-operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` }
  function badge(text, tone) { return `<span class="b b-${tone}">${escapeHtml(text)}</span>` }
  function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {} }
  function array(value) { return Array.isArray(value) ? value : [] }
  function commandId() { if (!crypto?.randomUUID) throw new Error("secure_id_unavailable"); return crypto.randomUUID() }
  async function sha256Hex(buffer) { const digest = await crypto.subtle.digest("SHA-256", buffer); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") }
  function hasPdfSignature(buffer) { return new TextDecoder("ascii").decode(new Uint8Array(buffer.slice(0, 5))) === "%PDF-" }
  function minorToDecimal(value) { if (!Number.isInteger(value)) return null; const sign = value < 0 ? "-" : ""; const digits = String(Math.abs(value)).padStart(3, "0"); return `${sign}${digits.slice(0,-2)}.${digits.slice(-2)}` }
  function safeMinorInteger(value) { const number = typeof value === "number" ? value : /^-?\d+$/.test(String(value || "")) ? Number(value) : NaN; return Number.isSafeInteger(number) ? number : null }
  function formatMinor(value, currency = "MXN") { return parser.formatMinorForDisplay(value, currency) }
  function formatDateTime(value) { if (!value) return "Sin fecha"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-MX", { dateStyle:"medium", timeStyle:"short" }).format(date) }
  function formatBytes(value) { const bytes = Number(value || 0); return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
  function shortId(value) { return String(value || "—").slice(0, 8).toUpperCase() }
  function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() }
  function friendlyError(error) {
    const message = error?.message
    const code = error?.code
    const known = {
      upload_contract_incomplete: "El servidor no devolvió bucket, ruta y documento autorizados.",
      invalid_pdf_signature: "El archivo no contiene la firma válida %PDF-.",
      invalid_pdf_page_count: "El PDF no tiene páginas válidas o supera el límite autorizado.",
      secure_id_unavailable: "El navegador no puede generar una clave idempotente segura.",
      source_pdf_url_unavailable: "No se pudo generar el acceso temporal al PDF fuente.",
      stale_payment_extraction: "La extracción cambió en otra sesión; se actualizaron los datos.",
      payment_reservation_not_active: "La reserva ya no está activa; se actualizaron los datos.",
      payment_reservation_not_expired: "La reserva todavía no venció según el reloj del servidor.",
      payment_reservation_expired_use_expire: "La reserva ya venció; aplica la acción Expirar reserva.",
      payment_allocation_plan_not_cancellable: "El plan ya no se puede cancelar; se actualizó la operación.",
      payment_allocation_plan_not_draft: "El plan ya no está en borrador; se actualizó la operación.",
      bank_payment_operation_not_available: "La operación bancaria ya no está disponible; se actualizaron los datos.",
      bank_payment_operation_folio_duplicate: "Ese Folio único BBVA ya identifica otra operación de la empresa.",
      bank_payment_operation_company_account_mismatch: "La cuenta origen no coincide con una cuenta bancaria activa de la empresa.",
      bank_payment_operation_company_account_ambiguous: "La cuenta origen coincide con más de una cuenta BBVA activa; corrige el catálogo antes de aceptar.",
      open_allocation_plan_exists: "La operación ya tiene un plan abierto.",
      bank_payment_operation_capacity_exceeded: "El remanente de la operación cambió; revisa los importes.",
      payable_snapshot_capacity_exceeded: "El saldo pagable cambió; revisa los importes.",
      idempotency_key_conflict: "La misma clave idempotente recibió datos distintos.",
      PGRST202: "El contrato RPC todavía no está disponible en este ambiente.",
    }
    const knownKey = known[message] ? message : known[code] ? code : null
    if (knownKey) return known[knownKey]
    const detail = [message, code].filter(Boolean).join(" ") || String(error || "error")
    if (/permission|42501|row-level|not authorized/i.test(detail)) return "No tienes permisos para esta operación."
    return message || code || detail
  }
  function toast(title, desc, variant) { if (typeof Components !== "undefined" && Components.showToast) return Components.showToast({ title, desc, variant }); const node = document.createElement("div"); node.className = `toast-v2 ${variant}`; node.textContent = `${title}: ${desc}`; document.getElementById("toastStack").append(node); setTimeout(() => node.remove(), 5000) }
  function escapeHtml(value) { return String(value == null ? "" : value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;") }
})()
