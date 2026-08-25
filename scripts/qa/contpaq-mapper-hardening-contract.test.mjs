import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const evidence = read("supabase/migrations/20260824232512_contpaq_mapper_evidence_contract.sql")
const detailTree = read("supabase/migrations/20260824233806_contpaq_account_detail_tree_consistency.sql")
const access = read("supabase/migrations/20260824234723_contpaq_mapper_trigger_access_gate.sql")
const evidenceServer = read("supabase/migrations/20260824235349_contpaq_mapping_evidence_server_managed.sql")
const semantics = read("supabase/migrations/20260825001711_contpaq_mapping_evidence_semantics.sql")
const reviewUnblock = read("supabase/migrations/20260825221900_contpaq_mapper_legacy_review_unblock.sql")
const edgeReviewDeprecation = read("supabase/migrations/20260825221930_contpaq_mapper_edge_review_deprecation.sql")
const graph = read("supabase/migrations/20260825222000_contpaq_mapper_graph_reviews.sql")
const ui = read("contpaq_mapper_extension.js")
const dashboardPatch = read("dashboard_bucket_patch.js")
const nav = read("nav_first_paint_bootstrap.js")
const seedSql = read("supabase/seed/contpaq/mapeos_operadora.sql")
const workflow = read(".github/workflows/contpaq-mapper-contract.yml")

// Evidencia reproducible permanece separada de una razón humana.
assert.match(evidence, /ADD COLUMN IF NOT EXISTS mapping_evidence text/)
assert.match(evidence, /budget_account_mappings_evidence_length_check/)
assert.match(semantics, /mapping_source/)
assert.match(semantics, /seed_reproducible/)
assert.match(semantics, /formal_reason_status/)
assert.match(ui, /mapping_evidence/)
assert.match(ui, /Evidencia reproducible:/)
assert.match(ui, /Razón formal de Finanzas/)
assert.doesNotMatch(ui, /mapping_evidence\s*:/)

// El navegador no puede atribuir ni fabricar evidencia técnica.
assert.match(evidenceServer, /contpaq_mapping_evidence_server_managed/)
assert.match(evidenceServer, /NEW\.mapping_evidence IS DISTINCT FROM OLD\.mapping_evidence/)
assert.match(edgeReviewDeprecation, /contpaq_mapping_evidence_server_managed/)
assert.match(edgeReviewDeprecation, /NEW\.mapping_evidence IS DISTINCT FROM OLD\.mapping_evidence/i)

// El contrato detalle/árbol continúa siendo de dos dimensiones independientes.
assert.match(detailTree, /NOT VALID/)
assert.match(detailTree, /NOT is_detail\s+OR\s+cta_mayor = 2/i)
assert.match(detailTree, /cta_mayor <> 2\s+OR\s+NOT v_account\.is_detail/i)
assert.match(detailTree, /child\.cta_sup = NEW\.contpaq_account_code/i)

// El gate de acceso sigue del lado servidor y la regla legacy de review por arista fue retirada de forma explícita.
assert.match(access, /contpaq_mapper_company_access\(NEW\.company_id\)/)
assert.match(reviewUnblock, /drop constraint if exists budget_account_mappings_review_status_check/i)
assert.match(edgeReviewDeprecation, /contpaq_mapper_company_access\(new\.company_id\)/i)
assert.doesNotMatch(edgeReviewDeprecation, /old\.needs_review\s+and\s+not\s+new\.needs_review/i)
assert.match(edgeReviewDeprecation, /contpaq_mapping_account_not_expense/)
assert.match(edgeReviewDeprecation, /contpaq_mapping_account_has_children/)

// N:N y reviews por partida.
assert.match(graph, /budget_account_mappings_company_category_account_key/)
assert.match(graph, /unique \(company_id, budget_category_id, contpaq_account_code\)/i)
assert.match(seedSql, /on conflict \(company_id, budget_category_id, contpaq_account_code\) do nothing/i)
assert.match(graph, /create table if not exists public\.budget_mapping_reviews/)
assert.match(graph, /budget_mapping_reviews_company_category_key/)
assert.match(graph, /insert into public\.budget_mapping_reviews/)
assert.match(graph, /set needs_review = false/)
assert.match(graph, /mapping_source = 'seed_reproducible'/)

// DML de mappings queda encapsulado en RPCs y con lock transaccional por empresa.
assert.match(graph, /revoke insert, update, delete on table public\.budget_account_mappings from authenticated/i)
assert.match(graph, /pg_advisory_xact_lock\(hashtext\(p_company_id::text\)\)/)
assert.match(graph, /contpaq_mapper_save_mapping/)
assert.match(graph, /contpaq_mapper_delete_mapping/)
assert.match(graph, /contpaq_mapper_set_review/)

// Merge transitivo: guard físico, preview entendible y auditoría.
assert.match(graph, /budget_account_mappings_transitive_merge_guard/)
assert.match(graph, /contpaq_bucket_merge_confirmation_required/)
assert.match(graph, /budget_mapping_merge_confirmations/)
assert.match(graph, /p_confirm_bucket_merge boolean default false/)
assert.match(graph, /requires_confirmation/)
assert.match(graph, /current_user_has_role\(public\.flux_finance_roles\(\)\)/)
assert.match(ui, /Confirmar unión de buckets/)
assert.match(ui, /Los presupuestos y reales de ambos componentes se analizarán juntos/)

// Buckets son componentes derivados, no una entidad administrable.
assert.match(graph, /with recursive/)
assert.match(graph, /contpaq_mapper_component_nodes/)
assert.match(graph, /contpaq_budget_bucket_members/)
assert.match(graph, /reach\(start_node, node\)/)
assert.doesNotMatch(graph, /create table if not exists public\.budget_buckets/i)
assert.match(dashboardPatch, /contpaq_budget_bucket_members/)
assert.match(nav, /annual-budget-buckets/)

// UI final: múltiples cuentas, IDs inequívocos y toast contractual correcto.
assert.match(ui, /mappingsByCategory:new Map\(\)/)
assert.match(ui, /ID presupuestal interno:/)
assert.match(ui, /Cuenta CONTPAQ:/)
assert.match(ui, /Components\.showToast\(\{title,desc:message,variant:tone\}\)/)
assert.doesNotMatch(ui, /onConflict:\s*"company_id,budget_category_id"/)

// El workflow contractual cubre todos los archivos del hardening y valida sintaxis.
for (const path of [
  "dashboard_bucket_patch.js",
  "20260825221900_contpaq_mapper_legacy_review_unblock.sql",
  "20260825221930_contpaq_mapper_edge_review_deprecation.sql",
  "20260825222000_contpaq_mapper_graph_reviews.sql",
]) {
  assert.match(workflow, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}
assert.match(workflow, /node --check dashboard_bucket_patch\.js/)

// No deben quedar workflows operativos de una sola ejecución.
for (const forbidden of [
  ".github/workflows/contpaq-dev-seed-one-shot.yml",
  ".github/workflows/contpaq-ui-evidence-patch.yml",
  ".github/workflows/contpaq-graph-loader-patch.yml",
]) {
  assert.equal(fs.existsSync(forbidden), false, `${forbidden} debe haberse eliminado`)
}

console.log("PASS CONTPAQ mapper hardening contract")
