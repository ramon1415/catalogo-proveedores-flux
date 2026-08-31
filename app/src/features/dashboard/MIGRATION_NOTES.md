# Dashboard — notas de migración (vanilla → React)

Fuente: `dashboard.html` + `dashboard.js` (+ `dashboard_report_downloads_extension.js`).
Destino: `app/src/features/dashboard/`. Ruta `/dashboard`. Componente default `DashboardPage` en `DashboardPage.tsx`.

## Modos / deep-links
- `/dashboard` → **Dashboard operativo** (periodo mensual, KPIs, cierre, tabs).
- `/dashboard?view=anual` → **Dashboard anual** (histórico contable por año/mes/cuenta). Se lee con `useSearchParams()`.
  - En anual, la vista histórica está activa desde el primer render (equivale a la clase `anual-boot` que en el vanilla ocultaba lo operativo sin flash).
  - El botón **Año en curso** (`<a href="/dashboard">`) vuelve al operativo, igual que el redirect vanilla.

## Tablas leídas
- `monthly_closures` — `select id,period_key,status,closed_at,sheet_url,slides_url,pdf_url order period_key desc limit 24` (dialog Historial).
- `historical_actuals` — `select account_code,account_name,period_month,amount` (paginado 1000). Filtro por año (`gte/lt period_month`) o todos. Solo se leen; familias `4xx`=ingresos, `6xx`=egresos.
- `budget_account_mappings` — `select budget_category_id,contpaq_account_code limit 2000` (mapper opcional).
- `budget_categories` — `select id,name,category limit 500` (mapper opcional). Si el mapper no existe, degrada a matriz por cuenta (mismo fallback que el vanilla).

## RPCs (nombre + params)
- `dashboard_export_payload(p_period_key text)` — payload principal del periodo. Devuelve `{ kpis, budget_comparison, ytd, income_members, closure_checklist, closure_comments }` (a veces como string JSON → se normaliza con `parsePayload`). En la gráfica anual operativa se llama una vez por mes (enero→mes actual) en paralelo.

No hay otros RPC. Nota: el prompt mencionaba `close_monthly_period` — **no existe** en el vanilla. El botón "Cerrar periodo" NO llama a ningún RPC; solo emite un toast (ver abajo).

## Gates de rol
- Dashboard visible para grupos **SYSADMIN / ADMIN / DIRECTION** (`config.js` módulos `dashboard` / `dashboard-anual`).
- Se computa localmente con `canViewDashboard(group)` (`lib/roles` → `ROLE_GROUPS`). Si el grupo no aplica, se muestra un panel "Acceso restringido" y **no se dispara** el RPC.
  - Diferencia menor vs vanilla: el vanilla no bloqueaba la página, dejaba que el RPC devolviera `not_allowed_to_view_dashboard` y mostraba toast. Aquí se hace el gate en cliente (el nav ya oculta el módulo a no autorizados). El mensaje `not_allowed_to_view_dashboard` sigue mapeado en `friendlyError` por si el RPC lo devuelve.

## Exportar / descargas
- Botón **Exportar** abre `ExportModal`: lista URLs reales existentes de `kpis.cierre` (`sheet_url/slides_url/pdf_url`, filtradas por `isRealUrl`) y 3 botones (`Actualizar Sheet`, `Generar reporte`, `Exportar ambos`) que **solo emiten un toast** "Exportacion pendiente" — idéntico al vanilla (`data-export-option`).
- **Downloads Blob/anchor**: `dashboard_report_downloads_extension.js` genera XLS/PPT/PDF vía Blob, pero **intercepta clicks en botones `[data-download-report]` que NO existen en el DOM del dashboard** (los añadía otra extensión hoy vacía, `dashboard_demo_extension.js` = 0 bytes). Por tanto **el dashboard vanilla actual no dispara ninguna descarga**; no se portó código de generación de archivos porque no está cableado. Si en el futuro se agregan esos botones, habrá que portar la generación Blob.
- Botón **Historial** abre `HistoryModal` (tabla de `monthly_closures`).

## Gráficas (sin Chart.js — SVG inline, CSP-safe)
Chart.js se reemplazó por un componente `ComboChart` en `charts.tsx` (SVG inline, sin dependencias, con `ResizeObserver` para tamaño real y sin distorsión). Cubre las 3 gráficas:
1. **Operativa**: barras agrupadas Presupuesto/Ejecutado (eje izq "Gastos") + líneas Esperado(punteada)/Cobrado (eje der "Ingresos"). Doble eje. Serie demo determinística cuando no hay datos reales (`demoChartSeries`), con subtítulo "· datos de ejemplo".
2. **Histórico anual (un año)**: barras Egresos + línea Ingresos, eje único.
3. **Todos los años**: multi-línea por año (Egresos sólida `.9`, Ingresos punteada `.55`), 12 meses en X, `spanGaps:false` (rompe en nulos). Colores `YEAR_COLORS`.
- Tooltip de hover (modo índice) reproducido con overlay + banda vertical. Colores grid/tick sensibles al tema vía CSS vars (`--chart-grid/--chart-tick`), como el `isDark` del vanilla.
- Leyenda dinámica (operativa fija / histórico / todos-los-años) replicada en el header del panel.

## Detalles de paridad reproducidos
- KPIs (ejecución, cobranza, efectivo, incidencias) con barras de progreso y mismos cálculos (`computeKpis`).
- Checklist de cierre: estatus, "puede cerrar", bloqueos, revisiones (`computeClosure`). Botón "Cerrar periodo" deshabilitado si `!can_close`; al hacer click emite toast success/danger (sin RPC), igual que el vanilla.
- Tabs secundarios: Gastos del mes (filtros empresa/centro/partida + búsqueda + nota de presupuesto), YTD (totales + tabla), Ingresos (totales + filtros estatus/estirpe), Efectivo (mini-cards + checklist), Incidencias (mini-cards).
- Cobranza por socio: se muestra en ambos modos; en histórico se reubica en la 2ª columna del grid con filas compactas (equivalente al `histMemberSlot`).
- Matriz "Histórico por cuenta": Ingresos por cuenta + Egresos estructurados por grupo→partida (colapsables) usando el mapeo CONTPAQ, más "Fuera del presupuesto". Columna cuenta sticky, code de cuenta en `title`.
- Formateadores es-MX idénticos (`money` 0 decimales, `whole`, `pct` 1 decimal). Badges de estatus (income/closure) mapeados 1:1 a `Badge`.

## Riesgos / gaps conocidos
- **Tokens de marca**: `theme/tokens.css` (React) no define `--emerald/--amber/--ruby/--violet/--accent-text/--accent-dim/--amber-dim`. Se definen localmente en el wrapper `.dash` del módulo (dark por defecto + override `[data-theme="light"]`) con los mismos valores de `ux2_shared.css`. Si más adelante se agregan a `tokens.css`, se puede quitar ese bloque.
- **Franja de filtro** (`#filterStrip` / "Limpiar"): en el vanilla estaba siempre oculta (ningún código la activaba; dependía de la extensión demo hoy vacía). No se portó.
- **Modal Exportar**: el vanilla usaba `dialog.narrow`; aquí usa el `Modal` compartido (tamaño `md`). Diferencia visual menor.
- **Tema de la gráfica**: en el vanilla el toggle de tema llamaba `updateChartTheme()`; aquí los colores grid/tick son CSS vars que responden solo al `[data-theme]`, sin JS.
- **Toast `danger`**: el `Toast` compartido no tiene variante `danger`; se mapeó a `error` (mismo rol).
- Redondeos de barras: Chart.js redondeaba solo esquinas superiores; el SVG usa `rx` (todas las esquinas). Diferencia estética mínima.
