import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const bootstrap = read("nav_first_paint_bootstrap.js")
const extension = read("contpaq_mapper_extension.js")
const configurationHtml = read("configuracion.html")
const configurationJs = read("configuracion.js")
const schema = read("supabase/migrations/20260824213154_contpaq_mapper_schema_tree.sql")
const audit = read("supabase/migrations/20260824214309_contpaq_mapper_audit_hardening.sql")
const scope = read("supabase/migrations/20260824215209_contpaq_mapper_trigger_scope_hardening.sql")

// Integración aislada: no sustituye la pantalla viva de Configuración.
assert.match(bootstrap, /pageName !== "configuracion\.html"/)
assert.match(bootstrap, /contpaq_mapper_extension\.js\?v=20260824-clean-tree/)
assert.match(extension, /PAGE !== "configuracion\.html"/)

// La URL directa debe sobrevivir al router de tabs existente y solo activarse para Adm/SysAdmin.
assert.match(bootstrap, /contpaqRequestedAtLoad/)
assert.match(bootstrap, /document\.getElementById\("contpaqMapperTab"\)/)
assert.match(bootstrap, /FluxAuth\?\.isAdminFinance/)
assert.match(bootstrap, /new MutationObserver\(activate\)/)

// Permisos decididos: SysAdmin + Administración/Finanzas; Dirección queda fuera.
assert.match(extension, /FluxAuth\?\.isAdminFinance/)
assert.match(extension, /Adm\/SysAdmin/)
assert.doesNotMatch(extension, /Adm\/Dir/)
assert.match(schema, /flux_sysadmin_roles\(\)/)
assert.match(schema, /'finance','finanzas','treasury','tesoreria','administracion'/)
assert.match(schema, /has_active_company_membership\(public\.current_profile_id\(\), p_company_id\)/)
assert.doesNotMatch(schema, /'direccion'|'director'|'approver_2'/)

// Contrato contable completo desde la creación de la tabla.
for (const column of ["cta_sup", "cta_mayor", "tipo", "rubro_nif", "activo", "sincronizado_el"]) {
  assert.match(schema, new RegExp(`\\b${column}\\b`), `Falta ${column}`)
}
assert.match(schema, /CHECK \(cta_mayor IS NULL OR cta_mayor BETWEEN 1 AND 4\)/)
assert.match(schema, /CHECK \(tipo IS NULL OR upper\(tipo\)/)
assert.match(schema, /code ~ '\^\[0-9A-Za-z\]\+\$'/)
assert.doesNotMatch(schema, /FOREIGN KEY\s*\(\s*company_id\s*,\s*cta_sup\s*\)/i)

// RLS y vista deben respetar a las tablas base.
assert.match(schema, /FORCE ROW LEVEL SECURITY/g)
assert.match(schema, /WITH \(security_invoker = true\)/)
assert.match(schema, /contpaq_mapper_company_access\(company_id\)/)
assert.match(schema, /REVOKE ALL ON TABLE public\.contpaq_accounts FROM authenticated/)
assert.match(schema, /GRANT SELECT ON TABLE public\.contpaq_accounts TO authenticated/)

// El mapper es fail-closed: activa + sincronizada + detalle + gasto + hoja.
assert.match(schema, /a\.activo/)
assert.match(schema, /a\.sincronizado_el IS NOT NULL/)
assert.match(schema, /a\.cta_mayor = 2/)
assert.match(schema, /upper\(a\.tipo\) = 'G'/)
assert.match(schema, /child\.cta_sup = a\.code/)
assert.match(schema, /contpaq_catalog_tree_metadata_incomplete/)
assert.match(schema, /contpaq_mapping_account_has_children/)
assert.match(schema, /budget_account_mappings_eligible_guard/)

// La UI consulta la vista segura y vuelve a verificar elegibilidad antes del upsert.
assert.match(extension, /from\("contpaq_account_mapper_candidates"\)/)
assert.match(extension, /from\("profile_company_memberships"\)/)
assert.match(extension, /account\.elegible_mapper/)
assert.match(extension, /cta_mayor === 2/)
assert.match(extension, /account\.tipo === "G"/)
assert.match(extension, /account\.es_hoja/)
assert.match(extension, /onConflict: "company_id,budget_category_id"/)
assert.match(extension, /mapping_method/)
assert.match(extension, /mapping_reason/)
assert.match(extension, /needs_review/)

// La atribución del cambio se deriva del perfil autenticado, no del navegador.
assert.match(audit, /v_actor := public\.current_profile_id\(\)/)
assert.match(audit, /NEW\.updated_by := v_actor/)
assert.match(audit, /NEW\.updated_at := now\(\)/)
assert.match(audit, /mapping_reason IS NULL OR char_length\(mapping_reason\) <= 1000/)

// Cualquier UPDATE pasa por el guard, preserva created_at y exige razón para criterio/revisión.
assert.match(scope, /BEFORE INSERT OR UPDATE\s+ON public\.budget_account_mappings/)
assert.doesNotMatch(scope, /UPDATE OF company_id, contpaq_account_code/)
assert.match(scope, /mapping_method <> 'judgment' AND NOT needs_review/)
assert.match(scope, /contpaq_mapping_reason_required/)
assert.match(scope, /NEW\.created_at := OLD\.created_at/)
assert.match(scope, /NOT VALID/)

// Gobernanza extraordinaria vigente: debe sobrevivir intacta a esta rebanada.
assert.match(configurationHtml, /id="extraordinaryFacultySection"/)
assert.match(configurationHtml, /id="extraordinaryFacultyForm"/)
assert.match(configurationJs, /saveExtraordinaryFaculty/)
assert.match(configurationJs, /set_extraordinary_profile_faculty/)

console.log("PASS CONTPAQ mapper contract")
