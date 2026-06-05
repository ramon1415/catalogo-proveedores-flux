// upload_helper.js — utilidades de Supabase Storage compartidas

const UPLOAD_BUCKET = "payment-receipts";
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/xml", "application/xml"];

/**
 * Inicializa un control de file-upload compuesto por:
 *   - input[type=file]  → #${id}File
 *   - button trigger    → #${id}Btn
 *   - span nombre       → #${id}Name
 *   - button clear      → #${id}Clear
 *   - contenedor área   → #${id}Area  (recibe clase has-file)
 *
 * Devuelve { getFile, reset } para usarlo desde el form.
 */
function initFileUpload(id) {
  const fileInput = document.getElementById(`${id}File`);
  const btn       = document.getElementById(`${id}Btn`);
  const nameSpan  = document.getElementById(`${id}Name`);
  const clearBtn  = document.getElementById(`${id}Clear`);
  const area      = document.getElementById(`${id}Area`);
  const hint      = document.getElementById(`${id}Hint`);

  if (!fileInput || !btn || !nameSpan) return { getFile: () => null, reset: () => {} };

  btn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0] || null;
    if (!file) return;
    if (file.size > UPLOAD_MAX_BYTES) {
      if (hint) { hint.textContent = "El archivo supera 10 MB. Elige uno más pequeño."; hint.style.color = "var(--ruby)"; }
      fileInput.value = "";
      return;
    }
    nameSpan.textContent = file.name;
    area?.classList.add("has-file");
    if (clearBtn) clearBtn.classList.remove("hidden");
    if (hint) { hint.textContent = `${(file.size / 1024).toFixed(0)} KB · listo para subir`; hint.style.color = "var(--accent-text)"; }
  });

  clearBtn?.addEventListener("click", () => reset());

  function reset() {
    fileInput.value = "";
    nameSpan.textContent = "Sin archivo";
    area?.classList.remove("has-file");
    if (clearBtn) clearBtn.classList.add("hidden");
    if (hint) { hint.textContent = hint.dataset.default || "JPG, PNG, WEBP o PDF · máx. 10 MB"; hint.style.color = ""; }
  }

  return {
    getFile: () => fileInput.files[0] || null,
    reset,
  };
}

/**
 * Sube un archivo a Supabase Storage en payment-receipts/{folder}/{timestamp}_{name}
 * Devuelve el storage path (string) o lanza error.
 */
async function uploadReceipt(file, folder) {
  if (!file) return null;
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!client) throw new Error("Cliente Supabase no disponible.");

  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;

  const { error } = await client.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`Error al subir archivo: ${error.message}`);
  return path;
}

/**
 * Devuelve una URL pública firmada (1 hora) para un storage path.
 */
async function getReceiptUrl(storagePath) {
  if (!storagePath) return null;
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!client) return null;
  const { data, error } = await client.storage.from(UPLOAD_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

window.FluxUpload = { initFileUpload, uploadReceipt, getReceiptUrl, UPLOAD_BUCKET };
