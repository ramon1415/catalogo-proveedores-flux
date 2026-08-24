import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const ui = read("contpaq_mapper_extension.js")
const evidenceContract = read("supabase/migrations/20260824231800_contpaq_mapper_evidence_contract.sql")
const detailContract = read("supabase/migrations/20260824234000_contpaq_account_detail_tree_consistency.sql")
const accessGate = read("supabase/migrations/20260825001000_contpaq_mapper_trigger_access_gate.sql")
const serverEvidence = read("supabase/migrations/20260825002500_contpaq_mapping_evidence_server_managed.sql")

// La interfaz distingue evidencia reproducible de razón formal.
assert.match(ui, /evidence: "contpaqMapperEvidence"/)
assert.match(ui, /Evidencia técnica del seed/)
assert.match(ui, /readonly aria-readonly="true"/)
assert.match(ui, /Razón formal de Finanzas/)
assert.match(ui, /mapping_evidence,mapping_reason/)
assert.match(ui, /mapping\?\.mapping_evidence/)
assert.match(ui, /wasReview && !needsReview && reason\.length < 8/)
assert.match(ui, /evidence\.length < 8 && reason\.length < 8/)
assert.doesNotMatch(ui, /Razón \/ evidencia/)
assert.doesNotMatch(ui, /updated_by: state\.profileId/)
assert.doesNotMatch(ui, /updated_at: new Date\(\)\.toISOString\(\)/)
assert.doesNotMatch(ui, /mapping_evidence:\s*evidence/)

// La evidencia derivada tiene su propia columna y no sustituye la razón formal.
assert.match(evidenceContract, /ADD COLUMN IF NOT EXISTS mapping_evidence text/)
assert.match(evidenceContract, /no sustituye la razón formal de Finanzas/)
assert.match(evidenceContract, /contpaq_mapping_review_reason_required/)
assert.match(evidenceContract, /mapping_reason/)
assert.match(evidenceContract, /mapping_evidence/)

// cta_mayor=2 no se equipara erróneamente con hoja/detalle.
assert.match(detailContract, /CHECK \(NOT is_detail OR cta_mayor = 2\)/)
assert.doesNotMatch(detailContract, /is_detail = \(cta_mayor = 2\)/)
assert.match(detailContract, /la condición de hoja se evalúa con cta_sup/)

// El acceso se corta antes de hacer búsquedas de dominio.
const accessPosition = accessGate.indexOf("contpaq_mapper_company_access(NEW.company_id)")
const lookupPosition = accessGate.indexOf("FROM public.contpaq_accounts")
assert.ok(accessPosition >= 0 && lookupPosition >= 0 && accessPosition < lookupPosition)
assert.match(accessGate, /contpaq_mapper_company_access_denied/)

// mapping_evidence solo puede establecerse o cambiarse mediante un actor privilegiado.
assert.match(serverEvidence, /v_privileged boolean/)
assert.match(serverEvidence, /TG_OP = 'INSERT' AND NEW\.mapping_evidence IS NOT NULL/)
assert.match(serverEvidence, /TG_OP = 'UPDATE' AND NEW\.mapping_evidence IS DISTINCT FROM OLD\.mapping_evidence/)
assert.match(serverEvidence, /contpaq_mapping_evidence_server_managed/g)
assert.match(serverEvidence, /contpaq_mapping_review_reason_required/)

// No deben regresar los cargadores temporales que dependían de secretos inexistentes.
assert.equal(fs.existsSync(".github/workflows/contpaq-dev-seed-one-shot.yml"), false)
assert.equal(fs.existsSync("ops/contpaq-mapper/apply-dev-seed.sh"), false)
assert.equal(fs.existsSync(".github/workflows/contpaq-ui-evidence-patch.yml"), false)

console.log("PASS CONTPAQ mapper hardening contract")
