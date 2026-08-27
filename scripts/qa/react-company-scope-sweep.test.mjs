import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const efectivo = read('app/src/features/efectivo/EfectivoPage.tsx')
assert.match(efectivo, /fund\.company_id === companyId/)
assert.match(efectivo, /select value=\{filters\.companyId\} disabled/)
assert.match(efectivo, /computeStats\(scopedData\)/)

const approvals = read('app/src/features/aprobaciones/AprobacionesPage.tsx')
assert.match(approvals, /request\.company_id === companyId/)
assert.match(approvals, /allowedCompanyIds\.has\(request\.company_id/)

const incidents = read('app/src/features/ingresos/IngresosPage.tsx')
const incidentModal = read('app/src/features/ingresos/IncidentModal.tsx')
assert.match(incidents, /incident\.company_id === companyId/)
assert.match(incidentModal, /company\.id === activeCompanyId/)
assert.match(incidentModal, /disabled=\{Boolean\(activeCompanyId\)\}/)

const layouts = read('app/src/features/layouts/LayoutsPage.tsx')
const layoutModal = read('app/src/features/layouts/NewLayoutModal.tsx')
const layoutApi = read('app/src/features/layouts/api.ts')
assert.match(layouts, /ids\?\.size === 1 && ids\.has\(companyId\)/)
assert.match(layouts, /company\.id === companyId/)
assert.match(layoutModal, /p_company_id: companyId \|\| null/)
assert.match(layoutModal, /Empresa requerida/)
assert.match(layoutApi, /select\('id,layout_id,company_id,/)

const dashboard = read('app/src/features/dashboard/DashboardPage.tsx')
assert.match(dashboard, /ds\.budgetComparison\.filter\(\(row\) => row\.company_id === companyId\)/)
assert.match(dashboard, /ds\.ytd\.filter\(\(row\) => normKey\(row\.company\) === normKey\(scopedCompanyLabel\)\)/)

const providers = read('app/src/features/proveedores/ProveedoresPage.tsx')
assert.match(providers, /hasActiveCompanyScope/)
assert.match(providers, /Catálogo compartido de proveedores/)

console.log('PASS react company scope sweep contract')
