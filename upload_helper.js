// upload_helper.js — utilidades de Supabase Storage compartidas

const UPLOAD_BUCKET = "payment-receipts";
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/xml", "application/xml"];

/**
 * Inicializa validación sobre un input[type=file] nativo.
 * id corresponde al id del <input> directamente.
 * Devuelve { getFile, reset }.
 */
function initFileUpload(id) {
  const fileInput = document.getElementById(`${id}File`) || document.getElementById(id);
  const hint = document.getElementById(`${id}Hint`);

  if (!fileInput) return { getFile: () => null, reset: () => {} };

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0] || null;
    if (!file) return;
    if (!UPLOAD_ACCEPTED.includes(file.type)) {
      if (hint) { hint.textContent = "Tipo no permitido. Usa JPG, PNG, WEBP, PDF o XML."; hint.style.color = "var(--ruby)"; }
      fileInput.value = "";
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      if (hint) { hint.textContent = "El archivo supera 10 MB. Elige uno más pequeño."; hint.style.color = "var(--ruby)"; }
      fileInput.value = "";
      return;
    }
    if (hint) { hint.textContent = `${(file.size / 1024).toFixed(0)} KB · listo para subir`; hint.style.color = "var(--accent-text)"; }
  });

  function reset() {
    fileInput.value = "";
    if (hint) { hint.textContent = hint.dataset.default || ""; hint.style.color = ""; }
  }

  return { getFile: () => fileInput.files[0] || null, reset };
}

function isXmlUpload(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type === "text/xml" || type === "application/xml" || name.endsWith(".xml");
}

/**
 * FB-2: después de subir un XML de una Solicitud, intenta extraer y persistir
 * hechos CFDI. Este análisis es deliberadamente no bloqueante: si falla, el
 * archivo ya subido y la solicitud siguen siendo válidos y vinculables.
 */
async function tryIngestRequestCfdi(file, folder, storagePath, client) {
  if (!isXmlUpload(file)) return null;
  const match = String(folder || "").match(/^solicitudes\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (!match) return null;

  try {
    const { ingestRequestCfdi } = await import("./lib/contpaq/cfdiIngestion.js?v=20260826-fb2");
    const result = await ingestRequestCfdi({
      file,
      paymentRequestId: match[1],
      storagePath,
      client,
    });

    window.dispatchEvent(new CustomEvent("flux:cfdi-ingestion", { detail: result }));
    if (result?.parseError && typeof window.showToast === "function") {
      window.showToast("CFDI requiere revisión", result.parseError, "warning");
    } else if (result?.validation?.status === "review_required" && typeof window.showToast === "function") {
      window.showToast("CFDI requiere revisión", "El XML se guardó, pero uno o más datos no coinciden con la solicitud.", "warning");
    }
    return result;
  } catch (error) {
    console.warn("[Flux][CONTPAQ][FB-2] El archivo se subió, pero la ingestión CFDI no pudo completarse.", error);
    window.dispatchEvent(new CustomEvent("flux:cfdi-ingestion", {
      detail: { skipped: false, ingestionError: error?.message || String(error) },
    }));
    if (typeof window.showToast === "function") {
      window.showToast("Archivo vinculado", "El XML se guardó; el análisis CFDI quedó pendiente de revisión.", "warning");
    }
    return null;
  }
}

/**
 * Sube un archivo a Supabase Storage en payment-receipts/{folder}/{timestamp}_{random}.{ext}
 * Devuelve el storage path (string) o lanza error.
 */
async function uploadReceipt(file, folder) {
  if (!file) return null;
  const client = window.supabaseClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!client) throw new Error("Cliente Supabase no disponible.");

  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;

  const { error } = await client.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`Error al subir archivo: ${error.message}`);

  await tryIngestRequestCfdi(file, folder, path, client);
  return path;
}

/**
 * Devuelve una URL pública firmada (1 hora) para un storage path.
 */
async function getReceiptUrl(storagePath) {
  if (!storagePath) return null;
  const client = window.supabaseClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!client) return null;
  const { data, error } = await client.storage.from(UPLOAD_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

window.FluxUpload = { initFileUpload, uploadReceipt, getReceiptUrl, UPLOAD_BUCKET };
