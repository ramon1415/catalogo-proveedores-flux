import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (name) => fs.readFileSync(path.join(root, name), "utf8")
const migrationDir = path.join(root, "supabase", "migrations")
const names = fs.readdirSync(migrationDir).sort()
const migration045Name = names.find((name) => name.endsWith("_045_provider_intake_ramon_uat_product_improvements.sql"))
const migration046Names = names.filter((name) => name.endsWith("_046_provider_aware_intake_links.sql"))
assert.ok(migration045Name)
assert.equal(migration046Names.length, 1)
const migration046Name = migration046Names[0]
const migration046 = read(path.join("supabase", "migrations", migration046Name))
const internalHtml = read("provider_intakes.html")
const internalJs = read("provider_intakes.js")
const internalCss = read("provider_intakes.css")
const publicHtml = read("solicitar.html")
const publicJs = read("solicitar.js")
const publicCore = read("solicitar-core.js")
const edgeHandler = read("supabase/functions/provider-intake/handler.ts")
const edgeRepository = read("supabase/functions/provider-intake/repository.ts")

test("045 stays byte-identical and exactly one later dynamic 046 exists", () => {
  const bytes = fs.readFileSync(path.join(migrationDir, migration045Name))
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "563dda79b2a25994deb2d94d682a25ec5c3609ea647da012e93fc3be022ec1b4")
  assert.match(migration046Name, /^20\d{12}_046_provider_aware_intake_links\.sql$/)
  assert.ok(migration046Name > migration045Name)
})

test("provider-aware model is additive and legacy links remain generic", () => {
  assert.match(migration046, /add column proveedor_id uuid null/)
  assert.match(migration046, /add column link_target_proveedor_id uuid null/)
  assert.match(migration046, /add column bank_data_confirmation text null/)
  assert.doesNotMatch(migration046, /update public\.intake_links[\s\S]{0,300}set proveedor_id/i)
  assert.doesNotMatch(migration046, /delete from|truncate table|drop table/i)
  assert.doesNotMatch(migration046, /INT-2026-000014|INT-2026-000016|SOL-2026-0105|SOL-2026-0106/)
})

test("active uniqueness is exact per generic or company-provider scope without time expressions", () => {
  const indexes = [...migration046.matchAll(/create unique index[\s\S]*?;/gi)].map((match) => match[0]).join("\n")
  assert.match(indexes, /one_active_generic_per_company[\s\S]*?proveedor_id is null/)
  assert.match(indexes, /one_active_per_company_provider[\s\S]*?company_id, proveedor_id[\s\S]*?proveedor_id is not null/)
  assert.doesNotMatch(indexes, /now\s*\(/i)
  assert.match(migration046, /proveedor_id is not distinct from p_proveedor_id/)
})

test("link mutations remain company-authorized, scoped and token-safe", () => {
  for (const name of ["find_provider_intake_link_providers", "get_provider_intake_link_scope", "create_provider_intake_link_v2", "regenerate_provider_intake_link_v2"]) {
    const fn = migration046.match(new RegExp(`create function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] || ""
    assert.match(fn, /security definer\s+set search_path = public, pg_temp/i)
    assert.match(migration046, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to authenticated`, "i"))
  }
  assert.match(migration046, /provider_intake_link_require_company_access/)
  assert.match(migration046, /extensions\.gen_random_bytes\(32\)/)
  assert.match(migration046, /extensions\.digest\(convert_to\(v_token, 'UTF8'\), 'sha256'\)/)
  assert.doesNotMatch(migration046, /insert into public\.intake_links\([^)]*raw_token/i)
  assert.match(internalJs, /hash = `token=\$\{result\.raw_token\}`/)
  assert.doesNotMatch(internalJs, /\?token=/)
})

test("public prefill is token-bound, cache-closed and has no catalog search", () => {
  assert.match(edgeRepository, /resolve_provider_aware_intake_link_internal/)
  assert.match(edgeHandler, /provider_target: link\.provider_target/)
  assert.match(read("supabase/functions/provider-intake/responses.ts"), /"Cache-Control": "no-store"/)
  assert.match(migration046, /left join public\.proveedores provider[\s\S]*?link\.proveedor_id/)
  assert.match(migration046, /account_masked[\s\S]*?provider_intake_mask_value/)
  assert.match(migration046, /clabe_masked[\s\S]*?provider_intake_mask_value/)
  assert.doesNotMatch(`${publicHtml}\n${publicJs}`, /find_provider_intake_link_providers|from\(["']proveedores["']\)|provider[_ -]?autocomplete/i)
  assert.match(publicJs, /parseProviderTarget/)
  assert.match(publicJs, /providerTarget/)
  assert.match(publicHtml, /Datos registrados/i)
})

test("bank confirmation never copies master identifiers and change stays intake-only", () => {
  assert.match(publicHtml, /MASTER_CONFIRMED/)
  assert.match(publicHtml, /CHANGE_DECLARED/)
  assert.match(publicCore, /delete payload\.bank_account/)
  assert.match(publicCore, /delete payload\.bank_clabe/)
  assert.match(migration046, /provider_intake_master_bank_values_not_allowed/)
  assert.match(migration046, /provider_intake_bank_change_fields_required/)
  assert.match(migration046, /set link_target_proveedor_id = v_link\.proveedor_id,[\s\S]*?bank_data_confirmation = v_confirmation/)
  assert.doesNotMatch(migration046, /update public\.proveedores/i)
  assert.match(migration046, /v_master_confirmed_for_target[\s\S]*?material_mismatch/)
  assert.match(migration046, /v_change_declared[\s\S]*?reported_change/)
})

test("triage prioritizes but never auto-links the provider target", () => {
  assert.match(migration046, /get_provider_intake_link_target/)
  assert.match(migration046, /requires_explicit_match/)
  assert.match(internalJs, /Proveedor destinatario de la liga/i)
  assert.match(internalJs, /Preseleccionado por liga/i)
  assert.match(internalJs, /Confirmar proveedor/i)
  assert.match(internalJs, /Buscar otro proveedor/i)
  assert.match(internalJs, /\+ Crear nuevo proveedor/i)
  assert.doesNotMatch(migration046, /set matched_proveedor_id\s*=/i)
})

test("inbox and link modal implement the second-UAT UX contract", () => {
  const tableHead = internalHtml.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || ""
  for (const heading of ["Folio", "Proveedor", "Empresa", "Monto", "Estado", "Recepción", "Acción"]) assert.match(tableHead, new RegExp(heading))
  assert.equal((tableHead.match(/<th\b/g) || []).length, 7)
  const status = internalHtml.match(/<select id="statusFilter"[\s\S]*?<\/select>/)?.[0] || ""
  assert.doesNotMatch(status, /multiple/)
  assert.match(status, />Todos</)
  assert.match(internalCss, /triage-table-card \.table-wrapper \{ min-height:0; max-height:none; overflow:visible; \}/)
  assert.match(internalCss, /\.triage-table \{ min-width:0; table-layout:fixed; \}/)
  assert.match(internalHtml, /Proveedor nuevo \/ no identificado/)
  assert.match(internalHtml, /Buscar por nombre, alias o RFC/)
  assert.match(internalJs, /query\.length < 2/)
  assert.match(internalJs, /setTimeout\(\(\) => searchLinkProviders\(query, company\.id\), 320\)/)
  assert.match(internalCss, /link-management-content[\s\S]*?overflow-y:auto; overflow-x:hidden/)
})

test("company authorization state is fail-closed and clears dependent link state", () => {
  assert.match(internalHtml, /id="linkCompany" aria-describedby="linkCompanyState"/)
  assert.match(internalHtml, /id="linkCompanyState" role="status" aria-live="polite"/)
  assert.match(internalJs, /await loadLinkManagementContext\(\)[\s\S]*?populateLinkCompanyOptions\(\)/)
  assert.match(internalJs, /No tienes empresas autorizadas para generar ligas de proveedor/)
  assert.match(internalJs, /dom\.linkCompany\.disabled = true/)
  assert.match(internalJs, /radio\.disabled = !hasCompany/)
  assert.match(internalJs, /dom\.linkProviderSearch\.disabled = !hasCompany \|\| !existing/)
  assert.match(internalJs, /searchLinkProviders\(query, company\.id\)/)
  assert.match(internalJs, /selectedLinkCompany\(\)\?\.id !== companyId/)
  assert.match(internalJs, /function handleLinkCompanyChange\(\) \{\s*resetLinkSessionState\(\)/)
  assert.match(internalJs, /function handleLinkRecipientChange\(\) \{\s*resetLinkSessionState\(\)/)
  assert.match(internalJs, /dom\.linkOneTimeResult\.hidden = true[\s\S]*?dom\.linkPublicUrl\.value = ""/)
  assert.match(internalJs, /dom\.createLinkBtn\.disabled = !scopeReady/)
  assert.match(internalCss, /\[hidden\] \{ display: none !important; \}/)
})

test("link creation code has no product side effects", () => {
  const create = migration046.match(/create function public\.create_provider_intake_link_v2[\s\S]*?\n\$\$;/i)?.[0] || ""
  assert.doesNotMatch(create, /insert into public\.(payment_intake|payment_requests|proveedores|notification_events)/i)
  assert.doesNotMatch(create, /update public\.(payment_intake|payment_requests|proveedores|notification_events)/i)
})
