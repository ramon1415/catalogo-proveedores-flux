;(function paymentRequestReconciliationEvidence() {
  "use strict"

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const originalOpenRequestDetail = window.openRequestDetail
  if (!client || typeof originalOpenRequestDetail !== "function") return

  window.openRequestDetail = async function openRequestDetailWithEvidence(paymentRequestId) {
    await originalOpenRequestDetail(paymentRequestId)
    await renderReconciliation(paymentRequestId)
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-request-evidence-id]")
    if (!button) return
    button.disabled = true
    try {
      const { data, error } = await client.rpc("get_payment_operation_evidence_access", {
        p_evidence_id: button.dataset.requestEvidenceId,
      })
      if (error) throw error
      const signed = await client.storage
        .from(data.storage_bucket)
        .createSignedUrl(data.storage_path, Number(data.url_ttl_seconds || 300))
      if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("evidence_url_unavailable")
      window.open(signed.data.signedUrl, "_blank", "noopener,noreferrer")
    } catch (error) {
      toast("No se pudo abrir la evidencia", error?.message || "Intenta de nuevo.", "danger")
    } finally {
      button.disabled = false
    }
  })

  async function renderReconciliation(paymentRequestId) {
    const detail = document.getElementById("detailContent")
    if (!detail) return
    detail.querySelector(".payment-request-reconciliation")?.remove()
    const { data, error } = await client.rpc("get_payment_request_reconciliation_summary", {
      p_payment_request_id: paymentRequestId,
    })
    if (error) return

    const entries = Array.isArray(data.entries) ? data.entries : []
    const section = document.createElement("section")
    section.className = "payment-request-reconciliation"
    section.innerHTML = `
      <div class="payment-request-reconciliation-header">
        <div><h3>Pagos conciliados y evidencia</h3><p>Vista interna de Finanzas. Los importes provienen del ledger de conciliación.</p></div>
        <span class="payment-final-status ${data.reconciliation_state === "paid" ? "success" : data.reconciliation_state === "partially_paid" ? "warning" : "neutral"}">${escapeHtml(stateLabel(data.reconciliation_state))}</span>
      </div>
      <div class="payment-request-reconciliation-grid">
        <div><span>Monto autorizado</span><strong>${formatMinor(data.authorized_minor, data.currency)}</strong></div>
        <div><span>Conciliado</span><strong>${formatMinor(data.confirmed_minor, data.currency)}</strong></div>
        <div><span>Saldo pendiente</span><strong>${formatMinor(data.balance_minor, data.currency)}</strong></div>
      </div>
      <div class="payment-request-reconciliation-list">
        ${entries.length ? entries.map(renderEntry).join("") : `<div class="payment-final-guard"><strong>Sin pagos conciliados</strong><span>La solicitud todavía no tiene movimientos confirmados en el ledger.</span></div>`}
      </div>
      <p class="payment-request-provider-block"><strong>Acceso externo deshabilitado:</strong> todavía no existe una relación confiable entre el usuario autenticado y el proveedor. No se exponen comprobantes por correo, RFC ni URL compartida.</p>
    `
    detail.append(section)
  }

  function renderEntry(entry) {
    const signedAmount = entry.movement_type === "reversal"
      ? -Number(entry.amount_minor || 0)
      : Number(entry.amount_minor || 0)
    return `
      <article class="payment-request-reconciliation-entry">
        <div><strong>${escapeHtml(entry.movement_type === "reversal" ? "Reverso" : "Pago confirmado")}</strong><span>${escapeHtml(entry.operation_date || "Sin fecha")} · referencia terminación ${escapeHtml(entry.reference_hint || "—")}</span></div>
        <strong>${formatMinor(signedAmount, entry.currency)}</strong>
        ${entry.evidence_id && entry.evidence_status === "shareable"
          ? `<button class="small-btn" type="button" data-request-evidence-id="${escapeHtml(entry.evidence_id)}">Ver comprobante</button>`
          : `<span>Evidencia no disponible</span>`}
      </article>
    `
  }

  function stateLabel(value) {
    return ({
      not_payable: "Sin snapshot pagable",
      unpaid: "Sin conciliar",
      partially_paid: "Pago parcial",
      paid: "Pagada",
    })[value] || "Sin conciliar"
  }

  function formatMinor(value, currency = "MXN") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      minimumFractionDigits: 2,
    }).format(Number(value || 0) / 100)
  }

  function toast(title, desc, variant) {
    if (window.Components?.showToast) return window.Components.showToast({ title, desc, variant })
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;")
  }
})()
