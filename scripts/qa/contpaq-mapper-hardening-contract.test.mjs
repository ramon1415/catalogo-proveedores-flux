import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")
const ui = read("contpaq_mapper_extension.js")
const nav = read("nav_first_paint_bootstrap.js")
const dashboardPatch = read("dashboard_bucket_patch.js")
const evidence = read("supabase/migrations/20260824232512_contpaq_mapper_evidence_contract.sql")
const detailTree = read("supabase/migrations/20260824233806_contpaq_account_detail_tree_consistency.sql")
const reviewUnblock = read("supabase/migrations/20260825221900_contpaq_mapper_legacy_review_unblock.sql")
const edgeGuard = read("supabase/migrations/20260825221930_contpaq_mapper_edge_review_deprecation.sql")
const graph = read("supabase/migrations/20260825222000_contpaq_mapper_graph_reviews.sql")
const seedSql = read("supabase/seed/contpaq/mapeos_operadora.sql")

// Evidencia técnica y razón humana siguen separadas.
assert.match(evidence, /ADD COLUMN IF NOT EXISTS mapping_evidence text/)
assert.match(ui, /Evidencia reproducible:/)
assert.match(ui, /Razón formal de Finanzas/)
assert.doesNotMatch(ui, /mapping_evidence\s*:/)

// cta_mayor=2 no implica hoja: la tabla solo exige detalle -> nivel 2.
assert.match(detailTree, /CHECK \(NOT is_detail OR cta_mayor = 2\) NOT VALID/i)
assert.match(detailTree, /la condición de hoja se evalúa con cta_sup/i)
// Los candados operativos continúan en el trigger vivo.
assert.match(edgeGuard, /v_account\.cta_mayor <> 2 or not v_account\.is_detail/i)
assert.match(edgeGuard, /child\.cta_sup = new\.contpaq_account_code/i)
assert.match(edgeGuard, /contpaq_mapping_account_not_expense/)
assert.match(edgeGuard, /contpaq_mapping_account_has_children/)
assert.match(edgeGuard, /contpaq_mapping_evidence_server_managed/)

// La semántica legacy de review por arista se retira antes de migrar a review por partida.
assert.match(reviewUnblock, /drop constraint if exists budget_account_mappings_review_status_check/i)
assert.doesNotMatch(edgeGuard, /old\.needs_review\s+and\s+not\s+new\.needs_review/i)

// Relación N:N, semilla compatible y reviews una sola vez por partida.
assert.match(graph, /unique \(company_id, budget_category_id, contpaq_account_code\)/i)
assert.match(seedSql, /on conflict \(company_id, budget_category_id, contpaq_account_code\) do nothing/i)
assert.match(graph, /create table if not exists public\.budget_mapping_reviews/i)
assert.match(graph, /budget_mapping_reviews_company_category_key/i)
assert.match(graph, /set needs_review=false|set needs_review = false/i)
assert.match(graph, /mapping_source='seed_reproducible'|mapping_source = 'seed_reproducible'/i)

// No hay tabla administrable de buckets: se derivan como componentes conexos.
assert.doesNotMatch(graph, /create table if not exists public\.budget_buckets/i)
assert.match(graph, /contpaq_mapper_component_nodes/)
assert.match(graph, /with recursive/i)
assert.match(graph, /contpaq_budget_bucket_members/)
assert.match(dashboardPatch, /contpaq_budget_bucket_members/)
assert.match(dashboardPatch, /bucket\.account_codes/)

// Escrituras encapsuladas y merge transitivo con preview + confirmación + auditoría.
assert.match(graph, /revoke insert,update,delete on table public\.budget_account_mappings from authenticated|revoke insert, update, delete on table public\.budget_account_mappings from authenticated/i)
assert.match(graph, /contpaq_mapper_preview_mapping/)
assert.match(graph, /contpaq_mapper_save_mapping/)
assert.match(graph, /contpaq_mapper_delete_mapping/)
assert.match(graph, /contpaq_mapper_set_review/)
assert.match(graph, /pg_advisory_xact_lock/)
assert.match(graph, /contpaq_bucket_merge_confirmation_required/)
assert.match(graph, /budget_mapping_merge_confirmations/)
assert.match(graph, /current_user_has_role\(public\.flux_finance_roles\(\)\)/)
assert.match(ui, /Confirmar unión de buckets/)
assert.match(ui, /requires_confirmation/)

// UI N:N e identificadores inequívocos.
assert.match(ui, /mappingsByCategory:new Map\(\)/)
assert.match(ui, /function mappingsFor\(categoryId\)/)
assert.match(ui, /ID presupuestal interno:/)
assert.match(ui, /Cuenta CONTPAQ:/)
assert.match(ui, /Components\.showToast\(\{title,desc:message,variant:tone\}\)/)
assert.match(nav, /dashboard_bucket_patch\.js\?v=20260825-graph-nn/)
assert.match(nav, /contpaq_mapper_extension\.js\?v=20260825-graph-nn/)

// Los one-shot operativos no deben quedar en la rama final.
for (const forbidden of [
  ".github/workflows/contpaq-dev-seed-one-shot.yml",
  ".github/workflows/contpaq-ui-evidence-patch.yml",
  ".github/workflows/contpaq-graph-loader-patch.yml",
]) assert.equal(fs.existsSync(forbidden), false, `${forbidden} debe haberse eliminado`)

console.log("PASS CONTPAQ mapper hardening contract")
