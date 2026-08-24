import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const nav = read("nav_first_paint_bootstrap.js")
const html = read("dashboard.html")
const dashboard = read("dashboard.js")
const migration = read("supabase/migrations/20260824213000_historical_actuals_sysadmin_rls.sql")

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

assert.match(migration, /force row level security/i)
assert.match(migration, /flux_sysadmin_roles\(\)/)
assert.match(migration, /drop policy if exists historical_actuals_select/i)
assert.doesNotMatch(migration, /flux_member_roles\(\)/)
assert.doesNotMatch(migration, /flux_finance_roles\(\)/)

console.log("PASS dashboard anual contract")
