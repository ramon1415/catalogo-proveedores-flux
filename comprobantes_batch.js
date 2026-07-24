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
    candidates: "find_payment_receipt_candidates",
    linkPreview: "get_payment_receipt_link_preview",
    correctExtraction: "correct_payment_document_extraction",
    prepareEvidence: "prepare_payment_operation_evidence",
    finalizeEvidence: "finalize_payment_operation_evidence",
    reviewEvidence: "review_payment_operation_evidence",
    evidenceAccess: "get_payment_operation_evidence_access",
    linkReceipt: "link_payment_receipt_to_request",
  })
  const PDF_WORKER = "./pdfjs-worker-3.11.174.min.js?v=20260723-vendored-root"
  const TRANSIENT_RPC_RETRY_LIMIT = 2
  const TRANSIENT_RPC_RETRY_DELAY_MS = 250

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const parser = window.FluxPaymentBatchParser
  const state = {
    context: null, batches: [], selectedId: null, detail: null, operation: null,
    candidates: [], candidateOperationId: null, candidateSearchCompleted: false,
    operationLinkStatuses: {},
    selectedRequestId: null, linkPreview: null, individualReceipt: null,
    duplicateBatch: null, summaryFilter: "", trigger: null, busy: false,
    detailRequest: 0, candidateRequest: 0, previewRequest: 0,
    commandKeys: new Map(),
  }
  const dom = {}

  async function privateStorageBucket(bucketId) {
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    const accessToken = data?.session?.access_token
    if (!accessToken) throw new Error("storage_session_unavailable")
    if (typeof client.storage?.setAuth === "function") client.storage.setAuth(accessToken)
    return client.storage.from(bucketId)
  }

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
    ;[
      "userName","userEmail","logoutBtn","themeToggle","accessState","accessTitle",
      "accessMessage","accessHome","batchWorkspace","refreshBtn","newBatchBtn",
      "batchSearch","batchStatusFilter","batchList","batchDetail","countTotal",
      "countProcessing","countReview","countCompleted","countFailed","newBatchDialog",
      "newBatchForm","closeNewBatchBtn","cancelNewBatchBtn","batchCompanyId",
      "batchPdfFile","batchPdfHint","uploadProgress","uploadProgressFill",
      "uploadProgressText","uploadError","submitNewBatchBtn","duplicateBatchDialog",
      "closeDuplicateBatchBtn","dismissDuplicateBatchBtn","openDuplicateBatchBtn",
      "duplicateBatchFolio","duplicateBatchStatus","operationDialog","operationTitle",
      "operationSubtitle","operationContent","closeOperationBtn","openReceiptPdfBtn",
      "acceptExtractionBtn","findCandidatesBtn","confirmOperationBtn",
      "operationActionReason","operationSecondaryActions","openCorrectionBtn",
      "extractionCorrectionDialog","extractionCorrectionForm","closeCorrectionBtn",
      "cancelCorrectionBtn","markReceiptUnusableBtn","correctionDate",
      "correctionAmount","correctionCurrency","correctionReference",
      "correctionBeneficiary","correctionConcept","correctionReason",
      "linkConfirmationDialog","linkConfirmationForm","closeLinkConfirmationBtn",
      "cancelLinkConfirmationBtn","linkConfirmationCopy","linkConfirmationSummary",
      "linkConfirmationCheck","submitLinkConfirmationBtn",
    ].forEach((id) => { dom[id] = document.getElementById(id) })
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
    dom.closeDuplicateBatchBtn.addEventListener("click", closeDuplicateBatch)
    dom.dismissDuplicateBatchBtn.addEventListener("click", closeDuplicateBatch)
    dom.openDuplicateBatchBtn.addEventListener("click", openDuplicateBatch)
    dom.batchSearch.addEventListener("input", renderBatchList)
    dom.batchStatusFilter.addEventListener("change", renderBatchList)
    dom.batchList.addEventListener("click", (event) => { const button = event.target.closest("[data-batch-id]"); if (button) openBatch(button.dataset.batchId) })
    dom.batchDetail.addEventListener("click", (event) => { const button = event.target.closest("[data-operation-id]"); if (button) openOperation(button.dataset.operationId, button) })
    document.querySelectorAll("[data-summary-filter]").forEach((button) => button.addEventListener("click", () => { state.summaryFilter = button.dataset.summaryFilter; updateSummaryFilter(); renderBatchList() }))
    dom.closeOperationBtn.addEventListener("click", () => dom.operationDialog.close())
    dom.operationDialog.addEventListener("close", () => {
      state.candidateRequest += 1
      state.previewRequest += 1
      state.candidates = []
      state.candidateOperationId = null
      state.candidateSearchCompleted = false
      state.selectedRequestId = null
      clearIndividualReceipt()
      state.trigger?.focus()
    })
    dom.openReceiptPdfBtn.addEventListener("click", openIndividualReceipt)
    dom.acceptExtractionBtn.addEventListener("click", acceptExtraction)
    dom.findCandidatesBtn.addEventListener("click", loadCandidates)
    dom.confirmOperationBtn.addEventListener("click", openLinkConfirmation)
    dom.openCorrectionBtn.addEventListener("click", openCorrection)
    dom.closeCorrectionBtn.addEventListener("click", () => dom.extractionCorrectionDialog.close())
    dom.cancelCorrectionBtn.addEventListener("click", () => dom.extractionCorrectionDialog.close())
    dom.extractionCorrectionForm.addEventListener("submit", submitCorrection)
    dom.markReceiptUnusableBtn.addEventListener("click", markReceiptUnusable)
    dom.closeLinkConfirmationBtn.addEventListener("click", () => dom.linkConfirmationDialog.close())
    dom.cancelLinkConfirmationBtn.addEventListener("click", () => dom.linkConfirmationDialog.close())
    dom.linkConfirmationForm.addEventListener("submit", executeLink)
    dom.linkConfirmationCheck.addEventListener("change", () => {
      dom.submitLinkConfirmationBtn.disabled = !dom.linkConfirmationCheck.checked || state.busy
    })
    dom.operationContent.addEventListener("change", (event) => {
      const radio = event.target.closest("[data-candidate-radio]")
      if (!radio) return
      state.selectedRequestId = radio.value
      renderOperation()
    })
    dom.operationContent.addEventListener("click", (event) => {
      const button = event.target.closest("[data-evidence-action]")
      if (!button) return
      openPersistedEvidence(button.dataset.evidenceId, button.dataset.evidenceAction === "download")
    })
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
    state.operationLinkStatuses = {}
    state.candidateRequest += 1
    if (dom.operationDialog.open) dom.operationDialog.close()
    renderBatchList()
    dom.batchDetail.innerHTML = `<div class="receipt-batch-empty">Cargando detalle…</div>`
    const { data, error } = await client.rpc(RPC.batchDetail, { p_batch_id: batchId })
    if (requestId !== state.detailRequest || state.selectedId !== batchId) return
    if (error) { dom.batchDetail.innerHTML = `<div class="receipt-batch-empty">${escapeHtml(friendlyError(error))}</div>`; return }
    state.detail = object(data)
    const operationLinkStatuses = await loadOperationLinkStatuses(state.detail)
    if (requestId !== state.detailRequest || state.selectedId !== batchId) return
    state.operationLinkStatuses = operationLinkStatuses
    renderBatchDetail()
    refreshOpenOperationFromDetail()
  }

  async function loadOperationLinkStatuses(detail) {
    const operations = batchOperations(detail).filter((operation) => operation.bank_operation_id)
    const entries = await Promise.all(operations.map(async (operation) => {
      const { data, error } = await client.rpc(RPC.linkPreview, {
        p_operation_id: operation.bank_operation_id,
      })
      const preview = object(data)
      return [
        operation.bank_operation_id,
        !error && object(preview.link).id ? "linked" : (operation.reconciliation_status || "unreconciled"),
      ]
    }))
    return Object.fromEntries(entries)
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
    const operation = batchOperations(state.detail).find((item) => item.id === operationId)
    if (!operation) return
    state.operation = operation
    state.candidates = []
    state.candidateOperationId = null
    state.candidateSearchCompleted = false
    state.selectedRequestId = null
    state.linkPreview = null
    state.candidateRequest += 1
    state.previewRequest += 1
    state.trigger = trigger
    clearIndividualReceipt()
    dom.operationTitle.textContent = `Comprobante · página ${operation.source_page || operation.page_number || "—"}`
    dom.operationSubtitle.textContent = operation.bank_unique_folio || operation.bank_reference || "Sin referencia bancaria"
    renderOperation()
    dom.operationDialog.showModal()
    refreshLinkPreview()
  }

  function renderOperation() {
    const operation = state.operation
    if (!operation) return
    const issues = array(operation.review_issues || operation.issues)
    const preview = object(state.linkPreview)
    const evidence = object(preview.evidence)
    const link = object(preview.link)
    const sourceDocument = object(state.detail?.document || array(state.detail?.documents)[0])
    const extractionStatus = operationStatus(operation)
    const bankOperationId = operation.bank_operation_id
    dom.operationContent.innerHTML = `${operationWorkflow(extractionStatus, bankOperationId, evidence, link)}
      <div class="receipt-operation-summary">${operationCard("Fecha", operation.application_date || operation.operation_date || "Sin fecha")}${operationCard("Importe del comprobante", formatMinor(amountMinor(operation), operation.currency))}${operationCard("Moneda", operation.currency || "Sin moneda")}${operationCard("Beneficiario", operation.beneficiary_name || "Por identificar")}${operationCard("Referencia", operation.bank_unique_folio || operation.bank_reference || "Sin referencia")}${operationCard("Extracción", statusLabel(extractionStatus))}</div>
      ${extractionNotice(extractionStatus, issues, operation.rejection_reason)}
      <section class="data-section"><div class="section-heading">Datos leídos del PDF</div><p class="receipt-section-help">Abre el comprobante individual de una sola página y compara fecha, importe, beneficiario y referencia.</p><pre class="receipt-evidence">${escapeHtml(array(operation.evidence_excerpt).join("\n") || "Sin extracto disponible.")}</pre></section>
      ${link.id ? renderLinkedReceipt(link, evidence) : `
        <section class="data-section"><div class="section-heading">Solicitud aprobada para este comprobante</div>
          <p class="receipt-candidate-explanation">Busca solicitudes aprobadas que aún no tienen comprobante y compara proveedor, moneda e importe con este pago. Este botón solo realiza una búsqueda; no modifica ni marca ninguna solicitud como pagada.</p>
          <div class="receipt-candidate-list" id="candidateList">${renderCandidates(operation, evidence)}</div>
          ${renderSelectedComparison(operation)}
        </section>`}`
    const sourceAvailable = sourceDocument.storage_bucket === "payment-batch-documents"
      && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.pdf$/i.test(sourceDocument.storage_path || "")
    dom.openReceiptPdfBtn.disabled = (!sourceAvailable && !evidence.id) || state.busy
    dom.openReceiptPdfBtn.title = evidence.id
      ? "Abrir el comprobante privado de una sola página"
      : sourceAvailable
        ? `Crear y abrir únicamente la página ${operation.page_number || 1}`
        : "No existe una página privada disponible."
    dom.openReceiptPdfBtn.setAttribute("aria-label", dom.openReceiptPdfBtn.title)
    syncOperationActions()
  }

  function operationWorkflow(extractionStatus, bankOperationId, evidence, link) {
    const receiptReady = evidence.status === "shareable"
    const searched = state.candidateOperationId === bankOperationId && state.candidateSearchCompleted
    const selected = Boolean(selectedCandidate())
    const linked = Boolean(link.id)
    const steps = [
      { number: "1", label: "Revisar comprobante", hint: receiptReady ? "Datos y página aceptados" : extractionStatus === "rejected" ? "Revisión cerrada" : "Compara una sola página", state: receiptReady ? "done" : extractionStatus === "rejected" ? "blocked" : "active" },
      { number: "2", label: "Buscar solicitud aprobada", hint: searched ? "Búsqueda terminada" : "Consulta sin escrituras", state: searched ? "done" : receiptReady ? "active" : "" },
      { number: "3", label: "Confirmar coincidencia", hint: selected || linked ? "Coincidencia seleccionada" : "Importes de solo lectura", state: linked ? "done" : selected ? "active" : "" },
      { number: "4", label: "Comprobante vinculado", hint: linked ? "Solicitud pagada" : "Confirmación humana", state: linked ? "done" : selected ? "active" : "" },
    ]
    return `<ol class="receipt-operation-workflow" aria-label="Progreso del comprobante">${steps.map((step) => `<li class="receipt-operation-step ${step.state}"><span>${step.number}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.hint)}</small></li>`).join("")}</ol>`
  }

  function syncOperationActions() {
    const operation = state.operation
    if (!operation) return
    const extractionId = operation.extraction_id || operation.payment_document_extraction_id
    const extractionStatus = operationStatus(operation)
    const bankOperationId = operation.bank_operation_id
    const evidence = object(state.linkPreview?.evidence)
    const linked = Boolean(state.linkPreview?.link?.id)
    const receiptReviewed = state.individualReceipt?.extractionId === extractionId
      && state.individualReceipt?.pageCount === 1
    const showAccept = Boolean(extractionId) && !linked && (
      extractionStatus === "review_required"
      || (Boolean(bankOperationId) && evidence.status !== "shareable")
    )
    const contractReady = can("can_match") && can("can_link")
    dom.acceptExtractionBtn.hidden = !showAccept
    dom.acceptExtractionBtn.textContent = bankOperationId
      ? "Comprobante revisado, continuar"
      : "Datos correctos, continuar"
    dom.acceptExtractionBtn.disabled = !can("can_review") || !contractReady
      || !operation.extraction_updated_at || !receiptReviewed || state.busy
    dom.findCandidatesBtn.hidden = !bankOperationId || evidence.status !== "shareable" || linked
    dom.findCandidatesBtn.disabled = !can("can_match") || state.busy
    dom.confirmOperationBtn.hidden = linked || !selectedCandidate()
    dom.confirmOperationBtn.disabled = !can("can_link") || !selectedCandidate()
      || evidence.status !== "shareable" || state.busy
    dom.openCorrectionBtn.hidden = linked || !["review_required","blocked"].includes(extractionStatus)
    dom.openCorrectionBtn.disabled = !can("can_review") || !contractReady || state.busy
    dom.operationSecondaryActions.hidden = dom.openCorrectionBtn.hidden
    dom.operationActionReason.textContent = nextActionReason(operation, evidence, linked, contractReady)
  }

  function nextActionReason(operation, evidence, linked, contractReady) {
    const extractionStatus = operationStatus(operation)
    if (!contractReady) return "El contrato 1:1 todavía no está instalado en este ambiente. La interfaz permanece en modo seguro."
    if (linked) return "Paso 4 de 4: el comprobante está vinculado y la solicitud quedó pagada."
    if (extractionStatus === "rejected") return "Este registro no puede utilizarse como comprobante individual."
    if (evidence.status !== "shareable") return "Paso 1 de 4: abre el comprobante individual, revisa los datos y confírmalos."
    if (state.candidateOperationId !== operation.bank_operation_id) return "Paso 2 de 4: busca solicitudes aprobadas compatibles. La búsqueda no modifica datos."
    if (!selectedCandidate()) return state.candidates.length
      ? "Paso 3 de 4: selecciona la solicitud correcta."
      : "No existe una coincidencia exacta. El caso requiere revisión."
    return "Paso 3 de 4: revisa la comparación y confirma la coincidencia."
  }

  function extractionNotice(status, issues, rejectionReason) {
    if (status === "blocked") return `<div class="notice-v2 warning"><span class="notice-icon">!</span><span><span class="notice-title">Extracción bloqueada</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(issues.length ? issues.map(issueLabel).join(", ") : "Faltan datos bancarios válidos; revisa el comprobante individual.")}</span></span></div>`
    if (status === "rejected") return `<div class="notice-v2 danger"><span class="notice-icon">!</span><span><span class="notice-title">Revisión cerrada</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(rejectionReason ? `Motivo: ${rejectionReason}` : "No puede utilizarse como comprobante individual.")}</span></span></div>`
    if (status === "accepted") return `<div class="notice-v2 success"><span class="notice-icon">✓</span><span><span class="notice-title">Datos aceptados</span><span class="notice-sep">—</span><span class="notice-desc">El importe y la moneda del comprobante quedaron inmutables para el matching.</span></span></div>`
    if (issues.length) return `<div class="notice-v2 warning"><span class="notice-icon">!</span><span><span class="notice-title">Revisión requerida</span><span class="notice-sep">—</span><span class="notice-desc">${escapeHtml(issues.map(issueLabel).join(", "))}</span></span></div>`
    return `<div class="notice-v2 success"><span class="notice-icon">✓</span><span><span class="notice-title">Extracción lista para revisión</span><span class="notice-sep">—</span><span class="notice-desc">Abre el comprobante individual y valida los datos antes de aceptar.</span></span></div>`
  }

  function renderCandidates(operation, evidence) {
    if (!operation.bank_operation_id) return `<div class="receipt-batch-empty"><strong>Primero revisa el comprobante.</strong><span>Aceptar los datos crea la operación bancaria necesaria para buscar la solicitud.</span></div>`
    if (evidence.status !== "shareable") return `<div class="receipt-batch-empty"><strong>Primero termina la revisión.</strong><span>La búsqueda solo se habilita cuando el comprobante individual fue aceptado.</span></div>`
    if (state.candidateOperationId !== operation.bank_operation_id || !state.candidateSearchCompleted) return `<div class="receipt-batch-empty"><strong>Aún no has buscado solicitudes.</strong><span>Usa “Buscar solicitud aprobada”. La consulta no cambia estados ni crea registros.</span></div>`
    if (!state.candidates.length) return `<div class="receipt-match-result none"><strong>No encontramos una solicitud aprobada que coincida con el proveedor, la moneda y el importe de este comprobante.</strong><span>No puedes forzar otro importe. Revisa los datos o remite el caso para análisis.</span></div>`
    const message = state.candidates.length === 1
      ? "Encontramos una solicitud aprobada compatible con este comprobante."
      : "Encontramos varias solicitudes compatibles. Selecciona la solicitud correcta."
    return `<div class="receipt-match-result exact"><strong>${message}</strong></div>${state.candidates.map((candidate) => `
      <label class="receipt-candidate${state.selectedRequestId === candidate.payment_request_id ? " selected" : ""}">
        <input type="radio" name="receiptCandidate" data-candidate-radio value="${escapeHtml(candidate.payment_request_id)}"${state.selectedRequestId === candidate.payment_request_id ? " checked" : ""}>
        <span class="receipt-candidate-main"><strong>${escapeHtml(candidate.request_number || "Solicitud")}</strong><span>${escapeHtml(candidate.proveedor_name || "Proveedor")}</span><span class="muted-line">Concepto: ${escapeHtml(candidate.concept || "Sin concepto")}</span></span>
        <span class="receipt-candidate-facts">
          <span><small>Solicitud</small><strong>${escapeHtml(formatMinor(candidate.amount_minor, candidate.currency))}</strong></span>
          <span><small>Comprobante</small><strong>${escapeHtml(formatMinor(amountMinor(operation), operation.currency))}</strong></span>
          <span><small>Moneda</small><strong>${escapeHtml(candidate.currency)}</strong></span>
          <span><small>Coincidencia</small><strong>${candidate.account_match ? "Cuenta bancaria" : "Beneficiario"}</strong></span>
          <span><small>Estado</small><strong>Aprobada</strong></span>
        </span>
      </label>`).join("")}`
  }

  function renderSelectedComparison(operation) {
    const candidate = selectedCandidate()
    if (!candidate) return ""
    return `<section class="receipt-match-comparison" aria-label="Comparación de coincidencia">
      <div class="section-heading">Confirmar coincidencia</div>
      <dl>
        <div><dt>Folio de solicitud</dt><dd>${escapeHtml(candidate.request_number || "—")}</dd></div>
        <div><dt>Proveedor</dt><dd>${escapeHtml(candidate.proveedor_name || "Proveedor")}</dd></div>
        <div><dt>Beneficiario del comprobante</dt><dd>${escapeHtml(operation.beneficiary_name || "Por identificar")}</dd></div>
        <div><dt>Importe de la solicitud</dt><dd>${escapeHtml(formatMinor(candidate.amount_minor, candidate.currency))}</dd></div>
        <div><dt>Importe del comprobante</dt><dd>${escapeHtml(formatMinor(amountMinor(operation), operation.currency))}</dd></div>
        <div><dt>Moneda</dt><dd>${escapeHtml(operation.currency || "—")}</dd></div>
        <div><dt>Fecha del pago</dt><dd>${escapeHtml(operation.application_date || "Sin fecha")}</dd></div>
        <div><dt>Referencia bancaria</dt><dd>${escapeHtml(operation.bank_unique_folio || operation.bank_reference || "Sin referencia")}</dd></div>
        <div><dt>Estado actual</dt><dd>Aprobada</dd></div>
      </dl>
      <p>Los importes provienen del PDF aceptado y del snapshot aprobado. Son de solo lectura.</p>
    </section>`
  }

  function renderLinkedReceipt(link, evidence) {
    return `<section class="receipt-linked-card">
      <span class="payment-final-status success">Comprobante vinculado</span>
      <h3>${escapeHtml(link.request_number || "Solicitud")}</h3>
      <dl>
        <div><dt>Estado</dt><dd>Pagada</dd></div>
        <div><dt>Importe pagado</dt><dd>${escapeHtml(formatMinor(link.amount_minor, link.currency))}</dd></div>
        <div><dt>Fecha de pago</dt><dd>${escapeHtml(link.payment_date || "Sin fecha")}</dd></div>
        <div><dt>Referencia</dt><dd>${escapeHtml(link.reference_hint || "—")}</dd></div>
      </dl>
      <div class="receipt-linked-actions">
        <button class="secondary-btn" type="button" data-evidence-action="view" data-evidence-id="${escapeHtml(evidence.id || link.evidence_id)}">Ver comprobante</button>
        <button class="secondary-btn" type="button" data-evidence-action="download" data-evidence-id="${escapeHtml(evidence.id || link.evidence_id)}">Descargar comprobante</button>
      </div>
    </section>`
  }

  async function acceptExtraction() {
    const extractionId = state.operation?.extraction_id || state.operation?.payment_document_extraction_id
    if (!extractionId || !state.operation?.extraction_updated_at || !can("can_review")
      || !can("can_link") || state.individualReceipt?.extractionId !== extractionId) return
    setBusy(true)
    try {
      let operationId = state.operation.bank_operation_id
      if (!operationId) {
        const accepted = await rpcIdempotent("extraction.accept", extractionId, RPC.acceptExtraction, {
          p_extraction_id: extractionId,
          p_expected_updated_at: state.operation.extraction_updated_at,
        })
        operationId = accepted.operation_id
      }
      await persistIndividualReceipt(operationId)
      toast("Comprobante revisado", "Los datos y la evidencia individual quedaron listos para buscar una solicitud.", "success")
      await loadBatches()
    } catch (error) {
      toast("No se pudo aceptar el comprobante", friendlyError(error), "danger")
      await loadBatches()
    } finally { setBusy(false) }
  }

  async function openIndividualReceipt() {
    const sourceDocument = object(state.detail?.document || array(state.detail?.documents)[0])
    const pageNumber = Math.max(1, Number(state.operation?.page_number) || 1)
    const evidenceId = state.linkPreview?.evidence?.id || state.linkPreview?.link?.evidence_id
    if (evidenceId && state.linkPreview?.evidence?.status === "shareable") return openPersistedEvidence(evidenceId, false)
    if (state.busy) return
    if (!window.FluxSinglePagePdf || !window.PDFLib) {
      return toast("Runtime PDF no disponible", "Recarga la página. Si el problema continúa, informa a soporte antes de revisar el comprobante.", "danger")
    }
    if (sourceDocument.storage_bucket !== "payment-batch-documents"
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.pdf$/i.test(sourceDocument.storage_path || "")) return
    const preview = window.open("about:blank", "_blank")
    if (!preview) return toast("Ventana bloqueada", "Permite ventanas emergentes para abrir el comprobante.", "warning")
    preview.opener = null
    setBusy(true)
    let receiptStage = "download_source"
    let sourceBlobUrl = null
    try {
      const sourceBucket = await privateStorageBucket(sourceDocument.storage_bucket)
      const { data, error } = await sourceBucket.download(sourceDocument.storage_path)
      if (error || !data) throw error || new Error("source_pdf_download_unavailable")
      sourceBlobUrl = URL.createObjectURL(data)
      receiptStage = "derive_page"
      const bytes = await window.FluxSinglePagePdf.deriveSinglePageFromUrl({ sourceUrl: sourceBlobUrl, pageNumber, pdfLib: window.PDFLib })
      receiptStage = "validate_page"
      await window.FluxSinglePagePdf.assertSinglePageBytes(bytes, window.PDFLib)
      clearIndividualReceipt()
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      state.individualReceipt = {
        extractionId: state.operation.extraction_id || state.operation.payment_document_extraction_id,
        bytes, blobUrl, pageCount: 1,
        sha256: await sha256Hex(bytes),
      }
      preview.location.replace(blobUrl)
      renderOperation()
    } catch (error) {
      preview.close()
      const diagnostic = [receiptStage, error?.name, error?.code, error?.status]
        .filter((value) => value !== undefined && value !== null && String(value).trim())
        .map((value) => String(value).replace(/[^a-z0-9_.-]/gi, "").slice(0, 48))
        .join(":")
      console.warn("[Flux] No se pudo aislar el comprobante", {
        stage: receiptStage,
        name: error?.name || null,
        code: error?.code || null,
        status: error?.status || null,
      })
      toast(
        "No se pudo aislar el comprobante",
        `${friendlyError(error)}${diagnostic ? ` Código de soporte: ${diagnostic}.` : ""}`,
        "danger",
      )
    } finally {
      if (sourceBlobUrl) URL.revokeObjectURL(sourceBlobUrl)
      setBusy(false)
    }
  }

  function normalizeEvidenceIdentifier(value) {
    const evidence = object(value)
    const evidenceId = evidence.id ?? evidence.evidence_id
    if (!evidenceId) throw new Error("payment_evidence_identifier_missing")
    return evidence.id === evidenceId ? evidence : { ...evidence, id: evidenceId }
  }

  async function persistIndividualReceipt(operationId) {
    const receipt = state.individualReceipt
    if (!receipt?.bytes || receipt.pageCount !== 1) throw new Error("single_page_receipt_required")
    let evidence = object(state.linkPreview?.evidence)
    if (evidence.status === "shareable") return evidence
    if (evidence.evidence_id && !evidence.id) evidence = normalizeEvidenceIdentifier(evidence)
    if (!evidence.id) evidence = normalizeEvidenceIdentifier(
      await rpcIdempotent("evidence.prepare", operationId, RPC.prepareEvidence, { p_operation_id: operationId }),
    )
    if (evidence.status === "pending_upload") {
      const blob = new Blob([receipt.bytes], { type: "application/pdf" })
      let evidenceBytes = receipt.bytes
      let evidenceSha256 = receipt.sha256
      const evidenceBucket = await privateStorageBucket(evidence.storage_bucket)
      const upload = await evidenceBucket.upload(evidence.storage_path, blob, { contentType: "application/pdf", upsert: false })
      if (upload.error) {
        if (!/duplicate|already exists|409/i.test(upload.error.message || "")) throw upload.error
        const existing = await evidenceBucket.download(evidence.storage_path)
        if (existing.error || !existing.data) throw existing.error || new Error("existing_evidence_unavailable")
        const existingBytes = new Uint8Array(await existing.data.arrayBuffer())
        await window.FluxSinglePagePdf.assertSinglePageBytes(existingBytes, window.PDFLib)
        evidenceBytes = existingBytes
        evidenceSha256 = await sha256Hex(existingBytes)
      }
      evidence = normalizeEvidenceIdentifier(
        await rpcIdempotent("evidence.finalize", evidence.id, RPC.finalizeEvidence, {
          p_evidence_id: evidence.id,
          p_derived_sha256: evidenceSha256,
          p_file_size_bytes: evidenceBytes.byteLength,
          p_page_count: 1,
        }),
      )
    }
    if (evidence.status === "pending_review") evidence = normalizeEvidenceIdentifier(
      await rpcIdempotent("evidence.review", evidence.id, RPC.reviewEvidence, {
        p_evidence_id: evidence.id,
        p_shareable: true,
        p_single_operation_attested: true,
        p_reason: "Datos y comprobante individual revisados por Finanzas",
      }),
    )
    if (evidence.status !== "shareable") throw new Error("shareable_single_page_evidence_required")
    return evidence
  }

  async function loadCandidates() {
    const operationId = state.operation?.bank_operation_id
    if (!operationId || !can("can_match") || state.linkPreview?.evidence?.status !== "shareable") return
    const requestId = ++state.candidateRequest
    state.candidates = []
    state.candidateOperationId = null
    state.candidateSearchCompleted = false
    state.selectedRequestId = null
    setBusy(true)
    try {
      const { data, error } = await client.rpc(RPC.candidates, { p_operation_id: operationId, p_limit: 20 })
      if (requestId !== state.candidateRequest || state.operation?.bank_operation_id !== operationId || !dom.operationDialog.open) return
      if (error) throw error
      state.candidates = array(data?.items || data)
      state.candidateOperationId = operationId
      state.candidateSearchCompleted = true
      state.selectedRequestId = state.candidates.length === 1 ? state.candidates[0].payment_request_id : null
      renderOperation()
    } catch (error) {
      if (requestId === state.candidateRequest && state.operation?.bank_operation_id === operationId) toast("No se pudieron buscar solicitudes", friendlyError(error), "danger")
    } finally { setBusy(false) }
  }

  function selectedCandidate() {
    return state.candidates.find((candidate) => candidate.payment_request_id === state.selectedRequestId) || null
  }

  function openLinkConfirmation() {
    const operation = state.operation
    const candidate = selectedCandidate()
    if (!operation?.bank_operation_id || !candidate || !can("can_link")) return
    const amount = formatMinor(amountMinor(operation), operation.currency)
    dom.linkConfirmationCopy.textContent = `Vas a vincular el comprobante de ${amount} con la solicitud ${candidate.request_number || "seleccionada"} y marcarla como pagada. El importe se toma del comprobante y no puede modificarse.`
    dom.linkConfirmationSummary.innerHTML = `<div><dt>Solicitud</dt><dd>${escapeHtml(candidate.request_number || "—")}</dd></div><div><dt>Proveedor</dt><dd>${escapeHtml(candidate.proveedor_name || "Proveedor")}</dd></div><div><dt>Importe</dt><dd>${escapeHtml(amount)}</dd></div><div><dt>Moneda</dt><dd>${escapeHtml(operation.currency || "—")}</dd></div>`
    dom.linkConfirmationCheck.checked = false
    dom.submitLinkConfirmationBtn.disabled = true
    dom.linkConfirmationDialog.showModal()
  }

  async function executeLink(event) {
    event.preventDefault()
    const operationId = state.operation?.bank_operation_id
    const candidate = selectedCandidate()
    if (!operationId || !candidate || !dom.linkConfirmationCheck.checked || !can("can_link") || state.busy) return
    setBusy(true)
    try {
      const result = await rpcIdempotent("receipt.link", `${operationId}:${candidate.payment_request_id}`, RPC.linkReceipt, {
        p_operation_id: operationId,
        p_payment_request_id: candidate.payment_request_id,
      })
      dom.linkConfirmationDialog.close()
      toast("Comprobante vinculado", `${result.request_number || "La solicitud"} quedó marcada como pagada.`, "success")
      state.candidates = []
      state.selectedRequestId = null
      await loadBatches()
    } catch (error) {
      toast("No se pudo vincular", friendlyError(error), "danger")
      await refreshLinkPreview()
    } finally { setBusy(false) }
  }

  async function refreshLinkPreview() {
    const operationId = state.operation?.bank_operation_id
    if (!operationId || !can("can_link")) return
    const requestId = ++state.previewRequest
    const { data, error } = await client.rpc(RPC.linkPreview, { p_operation_id: operationId })
    if (requestId !== state.previewRequest || state.operation?.bank_operation_id !== operationId || !dom.operationDialog.open) return
    if (error) return
    state.linkPreview = object(data)
    renderOperation()
  }

  async function openPersistedEvidence(evidenceId, download) {
    if (!evidenceId || state.busy) return
    const preview = download ? null : window.open("about:blank", "_blank")
    if (!download && !preview) return toast("Ventana bloqueada", "Permite ventanas emergentes para abrir el comprobante.", "warning")
    if (preview) preview.opener = null
    setBusy(true)
    try {
      const { data, error } = await client.rpc(RPC.evidenceAccess, { p_evidence_id: evidenceId })
      if (error) throw error
      const evidenceBucket = await privateStorageBucket(data.storage_bucket)
      const file = await evidenceBucket.download(data.storage_path)
      if (file.error || !file.data) throw file.error || new Error("evidence_download_failed")
      const bytes = new Uint8Array(await file.data.arrayBuffer())
      await window.FluxSinglePagePdf.assertSinglePageBytes(bytes, window.PDFLib)
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      if (!download) {
        preview.location.replace(url)
        setTimeout(() => URL.revokeObjectURL(url), 60000)
      } else {
        const identity = await getLinkedDownloadIdentity()
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = buildEvidenceFilename(identity, evidenceId)
        anchor.style.display = "none"
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch (error) {
      preview?.close()
      toast("No se pudo abrir el comprobante", friendlyError(error), "danger")
    } finally { setBusy(false) }
  }

  async function getLinkedDownloadIdentity() {
    const link = object(state.linkPreview?.link)
    const fallback = {
      requestNumber: link.request_number || "Solicitud",
      providerName: "Proveedor",
    }
    if (!link.payment_request_id) return fallback

    const requestResult = await client
      .from("payment_requests")
      .select("request_number,proveedor_id")
      .eq("id", link.payment_request_id)
      .maybeSingle()
    if (requestResult.error || !requestResult.data) return fallback

    const identity = {
      requestNumber: requestResult.data.request_number || fallback.requestNumber,
      providerName: fallback.providerName,
    }
    if (!requestResult.data.proveedor_id) return identity

    const providerResult = await client
      .from("proveedores")
      .select("alias,nombre_completo")
      .eq("id", requestResult.data.proveedor_id)
      .maybeSingle()
    identity.providerName = providerResult.data?.alias
      || providerResult.data?.nombre_completo
      || fallback.providerName
    return identity
  }

  function buildEvidenceFilename(identity, evidenceId) {
    const requestNumber = sanitizeFilenamePart(
      identity?.requestNumber,
      `Solicitud-${String(evidenceId).slice(-8)}`,
    )
    const providerName = sanitizeFilenamePart(identity?.providerName, "Proveedor").slice(0, 80)
    return `${requestNumber}_${providerName}_Comprobante.pdf`
  }

  function sanitizeFilenamePart(value, fallback) {
    return String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || fallback
  }

  function openCorrection() {
    const operation = state.operation
    if (!operation || !["review_required","blocked"].includes(operationStatus(operation))) return
    dom.correctionDate.value = operation.application_date || operation.operation_date || ""
    dom.correctionAmount.value = minorToDecimal(amountMinor(operation)) || ""
    dom.correctionCurrency.value = operation.currency || "MXN"
    dom.correctionReference.value = operation.bank_unique_folio || operation.bank_reference || ""
    dom.correctionBeneficiary.value = operation.beneficiary_name || ""
    dom.correctionConcept.value = operation.payment_reason || operation.concept || ""
    dom.correctionReason.value = ""
    dom.extractionCorrectionDialog.showModal()
  }

  async function submitCorrection(event) {
    event.preventDefault()
    const extractionId = state.operation?.extraction_id || state.operation?.payment_document_extraction_id
    const amount = parser.parseMoneyToMinor(dom.correctionAmount.value)
    const reason = dom.correctionReason.value.trim()
    if (!extractionId || !Number.isInteger(amount) || amount <= 0 || reason.length < 10) return toast("Corrección incompleta", "Captura datos válidos y un motivo de al menos 10 caracteres.", "warning")
    setBusy(true)
    try {
      await rpcIdempotent("extraction.correct", extractionId, RPC.correctExtraction, {
        p_extraction_id: extractionId,
        p_expected_updated_at: state.operation.extraction_updated_at,
        p_application_date: dom.correctionDate.value,
        p_amount_minor: amount,
        p_currency: dom.correctionCurrency.value.trim().toUpperCase(),
        p_bank_unique_folio: dom.correctionReference.value.trim().toUpperCase(),
        p_beneficiary_name: dom.correctionBeneficiary.value.trim(),
        p_payment_reason: dom.correctionConcept.value.trim(),
        p_reason: reason,
      })
      dom.extractionCorrectionDialog.close()
      clearIndividualReceipt()
      toast("Corrección guardada", "Los datos quedaron auditados y deben revisarse nuevamente.", "success")
      await loadBatches()
    } catch (error) {
      toast("No se pudo corregir", friendlyError(error), "danger")
      await loadBatches()
    } finally { setBusy(false) }
  }

  async function markReceiptUnusable() {
    const extractionId = state.operation?.extraction_id || state.operation?.payment_document_extraction_id
    const reason = dom.correctionReason.value.trim()
    if (!extractionId || reason.length < 10) return toast("Motivo requerido", "Explica por qué la página no es un comprobante individual.", "warning")
    setBusy(true)
    try {
      await rpcIdempotent("extraction.reject", extractionId, RPC.rejectExtraction, {
        p_extraction_id: extractionId,
        p_expected_updated_at: state.operation.extraction_updated_at,
        p_reason: reason,
      })
      dom.extractionCorrectionDialog.close()
      clearIndividualReceipt()
      toast("Comprobante enviado a revisión", "La página no podrá vincularse ni compartirse.", "success")
      await loadBatches()
    } catch (error) {
      toast("No se pudo cerrar la revisión", friendlyError(error), "danger")
    } finally { setBusy(false) }
  }

  async function rpcIdempotent(scope, targetId, rpcName, args) {
    const key = `${scope}:${targetId}`
    const idempotencyKey = state.commandKeys.get(key) || commandId()
    state.commandKeys.set(key, idempotencyKey)
    for (let attempt = 0; attempt <= TRANSIENT_RPC_RETRY_LIMIT; attempt += 1) {
      const { data, error } = await client.rpc(rpcName, { ...args, p_idempotency_key: idempotencyKey })
      if (!error) {
        state.commandKeys.delete(key)
        return object(data)
      }
      if (error.code !== "PGRST202" || attempt === TRANSIENT_RPC_RETRY_LIMIT) throw error
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RPC_RETRY_DELAY_MS * (attempt + 1)))
    }
    throw new Error("rpc_retry_exhausted")
  }

  function clearIndividualReceipt() {
    if (state.individualReceipt?.blobUrl) URL.revokeObjectURL(state.individualReceipt.blobUrl)
    state.individualReceipt = null
  }

  function openNewBatch() { dom.newBatchForm.reset(); dom.uploadError.textContent = ""; dom.uploadProgress.hidden = true; dom.newBatchDialog.showModal(); dom.batchCompanyId.focus() }
  function closeNewBatch() { if (!state.busy) dom.newBatchDialog.close() }
  function closeDuplicateBatch() { state.duplicateBatch = null; dom.duplicateBatchDialog.close() }
  async function openDuplicateBatch() {
    const batchId = state.duplicateBatch?.id
    if (!batchId) return
    state.duplicateBatch = null
    dom.duplicateBatchDialog.close()
    await openBatch(batchId)
  }
  function showDuplicateBatch(batch) {
    state.duplicateBatch = batch
    dom.duplicateBatchFolio.textContent = batch.folio
    dom.duplicateBatchStatus.textContent = statusLabel(batch.status)
    dom.duplicateBatchDialog.showModal()
  }
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
        await surfaceDuplicateBatch(created, batchId)
        return
      }
      if (created?.duplicate) {
        await surfaceDuplicateBatch(created, batchId)
        return
      }
      if (!resumeExtraction) {
        setProgress(50, "Subiendo al bucket privado autorizado…")
        const bucket = await privateStorageBucket(bucketId)
        const upload = await bucket.upload(storagePath, file, { contentType: "application/pdf", upsert: false })
        if (upload.error) throw upload.error
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

  async function surfaceDuplicateBatch(created, batchId) {
    setProgress(100, "Este archivo ya fue cargado. No se creó otro lote.")
    await loadBatches()
    const existing = state.batches.find((batch) => batch.id === batchId) || {}
    dom.newBatchDialog.close()
    showDuplicateBatch({
      id: batchId,
      folio: existing.batch_number || existing.public_folio || created?.batch_number || created?.public_folio || shortId(batchId),
      status: existing.batch_status || existing.status || created?.status || "awaiting_upload",
    })
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
  function actionReason() { if (!can("can_review") && !can("can_match") && !can("can_link")) return state.context?.block_reason || "Acciones no autorizadas."; return "Las capacidades se revalidan en cada RPC." }
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
    const refreshed = batchOperations(state.detail).find((item) => item.id === state.operation.id)
    if (!refreshed) return dom.operationDialog.close()
    state.operation = refreshed
    state.linkPreview = null
    renderOperation()
    refreshLinkPreview()
  }
  function reconciliationStatus(item) { return state.operationLinkStatuses[item.bank_operation_id] || item.reconciliation_status || "unreconciled" }
  function batchStatus(item) { return item.batch_status || item.status || "awaiting_upload" }
  function amountMinor(item) { const exact = safeMinorInteger(item.amount_minor); if (exact !== null) return exact; return parser.parseMoneyToMinor(item.amount) || 0 }
  function statusLabel(status) { return ({ awaiting_upload:"Esperando carga",extracting:"Extrayendo",review_required:"Por revisar",accepted:"Aceptada",blocked:"Bloqueada",ready:"Listo",available:"Disponible",linked:"Vinculado",draft:"Borrador",reserved:"Reservado",active:"Activa",released:"Liberado",rejected:"Rechazado",cancelled:"Cancelado",expired:"Expirado",unreconciled:"Pendiente de conciliación",failed:"Con incidencia" })[status] || String(status || "Sin estado") }
  function statusTone(status) { if (["accepted","ready","available","linked"].includes(status)) return "success"; if (["failed","rejected"].includes(status)) return "danger"; if (["awaiting_upload","extracting","reserved","review_required","blocked"].includes(status)) return "warning"; if (status === "draft") return "violet"; return "neutral" }
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
      payment_evidence_identifier_missing: "El servidor no devolvió un identificador válido para la evidencia.",
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
