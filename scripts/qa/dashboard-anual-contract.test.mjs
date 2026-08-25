import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const nav = read("nav_first_paint_bootstrap.js")
const html = read("dashboard.html")
const dashboard = read("dashboard.js")
const migration = read("supabase/migrations/20260824212048_historical_actuals_sysadmin_rls.sql")
const strictR2 = read("supabase/migrations/20260825224000_historical_actuals_strict_sysadmin_r2.sql")

assert.match(nav, /data-flux-nav-key=\\?"dashboard-anual\\?"/)
assert.match(nav, /FluxAuth\?\.isSysadmin/)
assert.match(nav, /window\.location\.replace\("\.\/dashboard\.html"\)/)
assert.match(nav, /por familia de cuenta contable/)

assert.match(html, /histYearSelect/)
assert.match(html, /histKpiStrip/)
assert.match(html, /anual-boot/)
assert.match(html, /dashboard\.js\?v=20260818-anual10/)

assert.match(dashboard, /from\("historical_actuals"\)/)
assert.match(dashboard, /from\("budget_account_mappings"\)/)
assert.match(dashboard, /Todos los años|todos/)

// Primera migración establece el hardening y R2 corrige que flux_sysadmin_roles()
// incluya `admin`. Histórico debe quedar solo para roles realmente sistémicos.
assert.match(migration, /force row level security/i)
assert.match(strictR2, /force row level security/i)
assert.match(strictR2, /array\['sysadmin','system_admin','superadmin'\]::text\[\]/i)
assert.match(strictR2, /historical_actuals_select_strict_sysadmin/)
assert.match(strictR2, /historical_actuals_insert_strict_sysadmin/)
assert.match(strictR2, /historical_actuals_update_strict_sysadmin/)
assert.match(strictR2, /historical_actuals_delete_strict_sysadmin/)
assert.doesNotMatch(strictR2, /array\[[^\]]*'admin'[^\]]*\]::text\[\]/i)
assert.doesNotMatch(strictR2, /flux_finance_roles\(\)/)

console.log("PASS dashboard anual contract")
