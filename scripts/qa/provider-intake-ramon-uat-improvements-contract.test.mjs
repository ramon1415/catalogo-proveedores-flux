import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).sort()
const migrationName = migrations.find((name) => name.endsWith("_provider_intake_ramon_uat_product_improvements.sql"))
assert.ok(migrationName, "missing product improvement migration")
const sysadminLinkMigrationName = migrations.find((name) => name.endsWith("_048_allow_sysadmin_provider_intake_links.sql"))
assert.ok(sysadminLinkMigrationName, "missing SysAdmin provider-link authorization migration")

const migration = read(path.join("supabase", "migrations", migrationName))
const sysadminLinkMigration = read(path.join("supabase", "migrations", sysadminLinkMigrationName))
const internalHtml = read("provider_intakes.html")
const internalJs = read("provider_intakes.js")
const publicHtml = read("solicitar.html")
const publicJs = read("solicitar.js")
const providerJs = read("proveedores.js")
const config = read("config.js")

test("migration uses the next dynamic active slot", () => {
  assert.match(migrationName, /^20260811\d{6}_045_provider_intake_ramon_uat_product_improvements\.sql$/)
  assert.ok(migrationName > "20260811215129_044_provider_intake_payment_conversion.sql")
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, "supabase", "migrations", migrationName))).digest("hex"), "563dda79b2a25994deb2d94d682a25ec5c3609ea647da012e93fc3be022ec1b4")
})

test("public document guidance is visible before selection and remains runtime driven", () => {
  const guide = publicHtml.indexOf('id="document-kind-guide-title"')
  const input = publicHtml.indexOf('id="file-input"')
  assert.ok(guide >= 0 && guide < input)
  for (const label of ["Factura PDF", "Factura XML", "Documento bancario", "Soporte", "Otro"]) {
    assert.match(publicHtml, new RegExp(label))
  }
  assert.match(publicJs, /renderDocumentKindGuide\(\)/)
  assert.match(publicJs, /linkInfo\.maxFiles/)
  assert.match(publicJs, /linkInfo\.maxFileMb/)
  assert.match(publicJs, /linkInfo\.maxTotalMb/)
  assert.match(publicJs, /linkInfo\.allowedFileTypes/)
})

test("public portal has no provider catalog search or autocomplete", () => {
  assert.doesNotMatch(`${publicHtml}\n${publicJs}`, /find_provider_intake_candidates|from\(["']proveedores["']\)|provider[_ -]?autocomplete/i)
  assert.match(publicHtml, /id="provider-name"[^>]*autocomplete="organization"/)
})

test("internal matching is debounced, minimum-length and never auto-links", () => {
  assert.match(internalJs, /query\.length === 1/)
  assert.match(internalJs, /setTimeout\(async \(\) =>[\s\S]*?, 320\)/)
  assert.match(internalJs, /rpc\("find_provider_intake_candidates"/)
  assert.match(internalJs, /\+ Crear nuevo proveedor/)
  assert.match(internalJs, /Confirma el vínculo de forma explícita|confirma el vínculo de forma explícita/)
  assert.doesNotMatch(internalJs, /provider_candidate_id[\s\S]{0,500}set_provider_intake_match/)
})

test("provider proposal is authenticated, explicit and returns for manual match", () => {
  assert.match(migration, /create function public\.get_provider_intake_provider_proposal[\s\S]*?security definer/)
  assert.match(migration, /grant execute on function public\.get_provider_intake_provider_proposal\(uuid\)[\s\S]*?to authenticated/)
  assert.match(migration, /'proposal_only', true/)
  assert.match(providerJs, /intakeProposal/)
  assert.match(providerJs, /Nada se guardará|Ningún cambio se guardará|Guardar proveedor/)
  assert.match(providerJs, /provider_candidate_id/)
  assert.doesNotMatch(providerJs, /set_provider_intake_match/)
})

test("transfer banking mismatch blocks conversion until an audited safe decision", () => {
  assert.match(migration, /v_draft\.payment_method = 'transfer'[\s\S]*?BANKING_DATA_REVIEW_REQUIRED/)
  assert.match(migration, /v_derived_state := 'BLOCKED_BANK_REVIEW'/)
  assert.match(migration, /v_draft\.payment_method in \('cash', 'check'\)[\s\S]*?BANKING_DATA_DIFFERS_NOT_USED_BY_METHOD/)
  assert.match(migration, /event_type[\s\S]*?'banking_resolution'/)
  assert.match(migration, /'sensitive_data_included', false/)
  const auditInsert = migration.match(/insert into public\.payment_intake_events\([\s\S]*?\n  \);/)?.[0] || ""
  assert.doesNotMatch(auditInsert, /bank_account|bank_clabe|beneficiary_name|bank_name/)
  assert.match(internalJs, /Usar datos maestros vigentes/)
  assert.match(internalJs, /Actualizar proveedor canónico/)
})

test("link authorization grants global SysAdmin access and keeps operators company scoped", () => {
  const auth = sysadminLinkMigration.match(/create or replace function public\.provider_intake_link_actor_authorized[\s\S]*?\n\$\$;/)?.[0] || ""
  assert.match(sysadminLinkMigrationName, /^\d{14}_048_allow_sysadmin_provider_intake_links\.sql$/)
  assert.match(auth, /lower\(btrim\(role\.name\)\) = any\(public\.flux_sysadmin_roles\(\)\)/)
  assert.match(auth, /has_active_company_membership/)
  assert.match(auth, /from public\.companies[\s\S]*?coalesce\(company\.active, true\)/)
  assert.match(auth, /extraordinary_profile_is_company_director/)
  assert.match(auth, /'finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'/)
  assert.match(auth, /exists[\s\S]*?flux_sysadmin_roles\(\)[\s\S]*?or \([\s\S]*?has_active_company_membership/)
  assert.match(config, /provider-intakes[\s\S]*?ROLE_GROUPS\.DIRECTION/)
})

test("link RPCs enforce one active link and one-time raw-token handling", () => {
  const create = migration.match(/create function public\.create_provider_intake_link[\s\S]*?\n\$\$;/)?.[0] || ""
  const regenerate = migration.match(/create function public\.regenerate_provider_intake_link[\s\S]*?\n\$\$;/)?.[0] || ""
  assert.match(migration, /intake_links_one_active_per_company_uidx/)
  assert.match(migration, /provider_intake_link_active_exists/)
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/)
  assert.match(migration, /extensions\.digest\(convert_to\(v_token, 'UTF8'\), 'sha256'\)/)
  assert.match(migration, /'raw_token', v_token/)
  assert.doesNotMatch(`${create}\n${regenerate}`, /insert into public\.intake_links\([^)]*raw_token/)
  assert.match(internalJs, /#token=|hash = `token=/)
  assert.doesNotMatch(internalJs, /\?token=/)
  assert.doesNotMatch(internalJs, /console\.(?:log|info|debug).*token/i)
})

test("link UI supports create revoke regenerate without side effects", () => {
  const migration046Name = migrations.find((name) => name.endsWith("_046_provider_aware_intake_links.sql"))
  assert.ok(migration046Name)
  const migration046 = read(path.join("supabase", "migrations", migration046Name))
  const linkFunctions = [
    migration046.match(/create function public\.create_provider_intake_link_v2[\s\S]*?\n\$\$;/i)?.[0] || "",
    migration.match(/create function public\.revoke_provider_intake_link[\s\S]*?\n\$\$;/i)?.[0] || "",
    migration046.match(/create function public\.regenerate_provider_intake_link_v2[\s\S]*?\n\$\$;/i)?.[0] || "",
  ].join("\n")
  for (const value of ["Generar liga de proveedor", "Generar liga", "Revocar liga", "Regenerar liga", "Liga lista para compartir"]) {
    assert.match(internalHtml, new RegExp(value))
  }
  for (const rpc of ["create_provider_intake_link_v2", "revoke_provider_intake_link", "regenerate_provider_intake_link_v2"]) {
    assert.match(internalJs, new RegExp(`rpc\\("${rpc}"`))
  }
  assert.doesNotMatch(linkFunctions, /insert into public\.(payment_intake|payment_requests|notification_events)/i)
  assert.doesNotMatch(linkFunctions, /update public\.(proveedores|payment_requests|notification_events)/i)
})

test("converted and cancelled KPIs are real clickable status filters", () => {
  assert.match(internalHtml, /data-kpi-status="converted"[\s\S]*?id="countConverted"/)
  assert.match(internalHtml, /data-kpi-status="cancelled"[\s\S]*?id="countCancelled"/)
  assert.match(internalJs, /state\.summary\.converted/)
  assert.match(internalJs, /state\.summary\.cancelled/)
  assert.match(internalJs, /applyKpiFilter\(button\.dataset\.kpiStatus\)/)
})

test("changed pages keep unique element ids", () => {
  for (const [name, html] of [["provider_intakes.html", internalHtml], ["solicitar.html", publicHtml]]) {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    assert.deepEqual(duplicates, [], `${name} has duplicate ids: ${duplicates.join(", ")}`)
  }
})

test("new backend RPCs are authenticated-only with fixed search paths", () => {
  for (const name of [
    "confirm_provider_intake_master_banking",
    "get_provider_intake_provider_proposal",
    "get_provider_intake_link_management_context",
    "create_provider_intake_link",
    "revoke_provider_intake_link",
    "regenerate_provider_intake_link",
  ]) {
    const definition = migration.match(new RegExp(`create function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] || ""
    assert.match(definition, /security definer\s+set search_path = public, pg_temp/i)
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to authenticated`, "i"))
  }
  assert.match(migration, /has_function_privilege\('anon'/)
  assert.match(migration, /has_function_privilege\('service_role'/)
})
