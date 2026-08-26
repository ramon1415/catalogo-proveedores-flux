import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const ui = read("contpaq_mapper_extension.js")
const navBootstrap = read("nav_first_paint_bootstrap.js")
const dashboardBucketPatch = read("dashboard_bucket_patch.js")
const configHtml = read("configuracion.html")
const configJs = read("configuracion.js")
const schema = read("supabase/migrations/20260824213154_contpaq_mapper_schema_tree.sql")
const graph = read("supabase/migrations/20260825222000_contpaq_mapper_graph_reviews.sql")
const seed = read("supabase/seed/contpaq/mapeos_operadora.sql")

// El mapper sigue siendo una extensión aislada y no sustituye Configuración.
assert.match(ui, /PAGE !== "configuracion\.html"/)
assert.match(ui, /Mapeo CONTPAQ/)
assert.match(ui, /Adm\/SysAdmin/)
assert.match(ui, /window\.FluxAuth\?\.isAdminFinance/)
assert.match(configHtml, /extraordinaryFacultySection/)
assert.match(configHtml, /extraordinaryFacultyForm/)
assert.match(configJs, /saveExtraordinaryFaculty/)
assert.match(configJs, /set_extraordinary_profile_faculty/)

// Contrato base del catálogo: árbol, naturaleza y elegibilidad sin FK dura a cta_sup.
for (const column of ["cta_sup", "cta_mayor", "tipo", "rubro_nif", "activo", "sincronizado_el"]) {
  assert.match(schema, new RegExp(`\\b${column}\\b`))
}
assert.match(schema, /security_invoker\s*=\s*true/i)
assert.match(schema, /elegible_mapper/)
assert.match(schema, /cta_mayor\s*=\s*2/)
assert.match(schema, /upper\(a\.tipo\)\s*=\s*'G'/i)
assert.match(schema, /child\.cta_sup\s*=\s*a\.code/i)
assert.doesNotMatch(schema, /foreign key\s*\([^)]*cta_sup/i)
assert.match(schema, /ARRAY\['finance','finanzas','treasury','tesoreria','administracion'\]/)
assert.doesNotMatch(schema, /ARRAY\[[^\]]*'direction'/)

// El modelo final es N:N: una arista se identifica por empresa + partida + cuenta.
assert.match(graph, /unique\s*\(company_id,\s*budget_category_id,\s*contpaq_account_code\)/i)
assert.match(seed, /on conflict\s*\(company_id,\s*budget_category_id,\s*contpaq_account_code\)\s*do nothing/i)
assert.doesNotMatch(graph, /create table if not exists public\.budget_(?:control_)?buckets/i)

// La revisión de Finanzas vive una sola vez por partida, no repetida por arista.
assert.match(graph, /create table if not exists public\.budget_mapping_reviews/i)
assert.match(graph, /unique\s*\(company_id,\s*budget_category_id\)/i)
assert.match(graph, /Finance review belongs to the budget line/i)
assert.match(graph, /set needs_review\s*=\s*false/i)
assert.match(graph, /formal_reason_status\s*=\s*'not_required'/i)

// Escrituras del grafo pasan por RPC: el browser ya no hace DML directo sobre mappings.
assert.match(graph, /revoke insert,\s*update,\s*delete on table public\.budget_account_mappings from authenticated/i)
for (const rpc of [
  "contpaq_mapper_preview_mapping",
  "contpaq_mapper_save_mapping",
  "contpaq_mapper_delete_mapping",
  "contpaq_mapper_set_review",
  "contpaq_budget_bucket_members",
]) {
  assert.match(graph, new RegExp(`create or replace function public\\.${rpc}\\b`, "i"))
}
assert.match(ui, /\.rpc\("contpaq_mapper_save_mapping"/)
assert.match(ui, /\.rpc\("contpaq_mapper_delete_mapping"/)
assert.match(ui, /\.rpc\("contpaq_mapper_set_review"/)
assert.doesNotMatch(ui, /from\("budget_account_mappings"\)\.upsert/)
assert.doesNotMatch(ui, /from\("budget_account_mappings"\)[\s\S]{0,100}\.delete\(/)

// La UI soporta varias cuentas por partida y separa identificadores internos de cuentas reales.
assert.match(ui, /mappingsByCategory:new Map\(\)/)
assert.match(ui, /function mappingsFor\(categoryId\)/)
assert.match(ui, /ID presupuestal interno:/)
assert.match(ui, /Cuenta CONTPAQ:/)
assert.match(ui, /Cuentas relacionadas/)
assert.match(ui, /Una partida puede relacionarse con varias cuentas/)
assert.match(ui, /Revisión de Finanzas pendiente — una sola decisión para toda la partida/)
assert.match(ui, /Components\?\.showToast/)
assert.match(ui, /showToast\(\{title,desc:message,variant:tone\}\)/)

// El merge transitivo se previsualiza, se confirma explícitamente y queda auditado.
assert.match(graph, /budget_account_mappings_transitive_merge_guard/)
assert.match(graph, /contpaq_bucket_merge_confirmation_required/)
assert.match(graph, /pg_advisory_xact_lock/)
assert.match(graph, /app\.contpaq_bucket_merge_confirmed/)
assert.match(graph, /budget_mapping_merge_confirmations/)
assert.match(graph, /flux_finance_roles\(\)/)
assert.match(ui, /Confirmar unión de buckets/)
assert.match(ui, /requires_confirmation/)
assert.match(ui, /Confirmar unión/)

// El Dashboard anual consume componentes derivados; no vuelve al "último mapping por cuenta".
assert.match(dashboardBucketPatch, /contpaq_budget_bucket_members/)
assert.match(dashboardBucketPatch, /state\.histMapeo\.set/)
assert.match(dashboardBucketPatch, /bucket\.account_codes/)
assert.match(dashboardBucketPatch, /bucket_label/)
assert.match(dashboardBucketPatch, /bucket_group/)
assert.match(navBootstrap, /dashboard_bucket_patch\.js\?v=20260825-graph-nn/)
assert.match(navBootstrap, /contpaq_mapper_extension\.js\?v=20260825-graph-nn/)

console.log("PASS CONTPAQ mapper graph contract")
