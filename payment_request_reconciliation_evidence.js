;(function paymentRequestReceiptEvidence() {
  "use strict"

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const originalOpenRequestDetail = window.openRequestDetail
  if (!client || typeof originalOpenRequestDetail !== "function") return

  window.openRequestDetail = async function openRequestDetailWithReceipt(paymentRequestId) {
    await originalOpenRequestDetail(paymentRequestId)
    await renderReceipt(paymentRequestId)
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-request-evidence-id]")
    if (!button) return
    button.disabled = true
    try {
      await accessEvidence(
        button.dataset.requestEvidenceId,
        button.dataset.requestEvidenceAction === "download",
      )
    } catch (error) {
      toast("No se pudo abrir el comprobante", error?.message || "Intenta de nuevo.", "danger")
    } finally {
      button.disabled = false
    }
  })

  async function accessEvidence(evidenceId, download) {
    const preview = download ? null : window.open("about:blank", "_blank")
    if (!download && !preview) throw new Error("popup_blocked")
    if (preview) preview.opener = null
    try {
      const { data, error } = await client.rpc("get_payment_operation_evidence_access", {
        p_evidence_id: evidenceId,
      })
      if (error) throw error
      const signed = await client.storage
        .from(data.storage_bucket)
        .createSignedUrl(data.storage_path, Number(data.url_ttl_seconds || 300))
      if (signed.error || !signed.data?.signedUrl) {
        throw signed.error || new Error("evidence_url_unavailable")
      }
      if (!download) {
        preview.location.replace(signed.data.signedUrl)
        return
      }
      const bytes = await window.FluxSinglePagePdf.downloadAndVerifySinglePage(
        signed.data.signedUrl,
        { pdfLib: window.PDFLib },
      )
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `comprobante-${String(evidenceId).slice(-8)}.pdf`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      preview?.close()
      throw error
    }
  }

  async function renderReceipt(paymentRequestId) {
    const detail = document.getElementById("detailContent")
    if (!detail) return
    detail.querySelector(".payment-request-reconciliation")?.remove()
    const { data, error } = await client.rpc("get_payment_request_receipt_summary", {
      p_payment_request_id: paymentRequestId,
    })
    if (error) return

    const link = data?.link && typeof data.link === "object" ? data.link : null
    const section = document.createElement("section")
    section.className = "payment-request-reconciliation"
    section.innerHTML = `
      <div class="payment-request-reconciliation-header">
        <div><h3>Comprobante de pago</h3><p>Vista interna de Finanzas. El importe proviene del comprobante bancario vinculado.</p></div>
        <span class="payment-final-status ${link ? "success" : "neutral"}">${link ? "Pagada" : "Sin comprobante"}</span>
      </div>
      <div class="payment-request-reconciliation-grid">
        <div><span>Importe aprobado</span><strong>${formatMinor(data.authorized_minor, data.currency)}</strong></div>
        <div><span>Importe pagado</span><strong>${formatMinor(link?.amount_minor || 0, data.currency)}</strong></div>
        <div><span>Estado</span><strong>${link ? "Pagada" : "Pendiente de comprobante"}</strong></div>
      </div>
      ${link ? `
        <article class="payment-request-reconciliation-entry">
          <div><strong>${escapeHtml(link.request_number || "Solicitud pagada")}</strong><span>${escapeHtml(link.payment_date || "Sin fecha")} · referencia ${escapeHtml(link.reference_hint || "—")}</span></div>
          <div class="payment-request-reconciliation-actions">
            <button class="small-btn" type="button" data-request-evidence-action="view" data-request-evidence-id="${escapeHtml(link.evidence_id)}">Ver comprobante</button>
            <button class="small-btn" type="button" data-request-evidence-action="download" data-request-evidence-id="${escapeHtml(link.evidence_id)}">Descargar comprobante</button>
          </div>
        </article>`
        : `<div class="receipt-match-result none"><strong>Esta solicitud todavía no tiene un comprobante individual vinculado.</strong></div>`}
      <p class="payment-request-provider-block"><strong>Acceso externo deshabilitado:</strong> todavía no existe una relación verificada entre el usuario autenticado y el proveedor. No se expone el comprobante mediante correo, RFC ni enlaces compartidos.</p>
    `
    detail.append(section)
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
