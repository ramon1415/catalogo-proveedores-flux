import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const [modules, app, nav, dashboard] = await Promise.all([
  read('app/src/lib/modules.tsx'),
  read('app/src/App.tsx'),
  read('app/src/components/ui/Nav/navModel.tsx'),
  read('app/src/features/dashboard/DashboardPage.tsx'),
])

test('dashboard anual forma parte de las rutas habilitadas del módulo dashboard', () => {
  assert.match(
    modules,
    /key: 'dashboard',[\s\S]*?path: '\/dashboard',[\s\S]*?extraPaths: \['\/dashboard-anual'\],[\s\S]*?component: lazy/,
  )
  assert.match(app, /\.\.\.\(m\.extraPaths \?\? \[\]\)\.map/)
})

test('navegación y página comparten la ruta anual canónica', () => {
  assert.match(nav, /key: 'dashboard-anual',[\s\S]*?path: '\/dashboard-anual'/)
  assert.match(dashboard, /pathname === '\/dashboard-anual'/)
})
