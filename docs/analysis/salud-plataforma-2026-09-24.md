# Revisión de salud de la plataforma — Flux

**Fecha:** 2026-09-24 · **Para validar con:** Ramón · **Autor:** Carlos (con Claude)
**Método:** 4 auditorías paralelas de solo-lectura sobre todo el repo (`app/src`, vanilla raíz, `supabase/migrations`, `supabase/functions`, `scripts/qa`), cruzadas contra `vercel.json` y `scripts/build-vercel-static.mjs`.

> **Cómo usar este doc:** cada hallazgo tiene una casilla de validación para Ramón (`[ ] confirmo · [ ] no aplica · nota:`). La idea es revisarlo juntos y quedarnos solo con lo que aplique antes de abrir tarjetas.

---

## Veredicto general

**Plataforma SANA con deuda concentrada y acotada.** El núcleo financiero está bien probado y el typecheck pasa limpio; la deuda real está en (1) falta de linter, (2) doble mantenimiento vanilla↔React, (3) el módulo CONTPAQ fuera del type-check y (4) boilerplate repetitivo. Nada roto ni inseguro.

| Área | Estado |
|---|---|
| Build / Typecheck (`tsc --noEmit`) | 🟢 limpio, `strict` on, gateado en CI |
| Tests del flujo financiero | 🟢 ~1,300 pruebas de contrato offline (pglite) |
| Tests unitarios del app React | 🟡 no hay (solo contratos de paridad) |
| **Lint (ESLint/Prettier)** | 🔴 **no existe** — el mayor hueco |
| Código muerto | 🟡 ~88 archivos vanilla (rollback) + ~30 símbolos muertos |
| Consistencia de lenguaje | 🟡 CONTPAQ 100% JS fuera del checker; `as any` en cada RPC |
| Ceremonia / boilerplate | 🟡 ~156 copias del mismo unwrap; God-components |
| Higiene git | 🟡 89 ramas locales (~41 ya mergeadas) |
| Secrets / .env | 🟢 limpio, nada hardcodeado |

---

## 1. Código muerto (magnitud: ~88 vanilla + ~30 símbolos)

- **Trío huérfano** (React, sin ningún importador): `app/src/pages/SectionPending.tsx`, `pages/LegacyModuleFrame.tsx`, `pages/LegacyCompanyModalContexts.tsx`. El mecanismo de iframe legacy quedó apagado.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Rama muerta `vanillaHref`** en `components/ui/Nav/Nav.tsx:66` — ningún nav item asigna `vanillaHref`, así que el `<a>` de fallback nunca corre.
  `[ ] confirmo · [ ] no aplica · nota:`
- **`features/configuracion/AssignRoleModal.tsx`** — componente huérfano, sin importador.
  `[ ] confirmo · [ ] no aplica · nota:`
- **`lib/contpaq/serializer/configs/fluxFinanciera.js`** — config huérfana (no está en el barrel `export.js`; solo se cablean Operadora y Soporte Fersana).
  `[ ] confirmo · [ ] no aplica · nota:`
- **27 exports muertos** de alta confianza (muestra, no exhaustiva — no cubre `export default`, listas `export {…}` ni type-only): 10 en `features/dashboard/logic.ts`, 6 en `features/nomina/logic.ts`, el registro viejo en `lib/modules.tsx` (`MODULE_BY_KEY`, `SECTION_ORDER`, `groupBySection`, `moduleForPath`, `CODE_VERSIONS`) + `useModuleVersion` (`moduleAccess.tsx`), `NAV_ITEMS` (`navModel.tsx`), `IcTheme` (`icons.tsx`), `setProfileActive`/`setProfileCompanyMembership` (`configuracion/api.ts`), etc. (+ ~87 símbolos "sobre-exportados" que sí corren — el `export` es redundante, no es código muerto.)
  `[ ] confirmo · [ ] no aplica · nota:`
- **~88 de 102 archivos vanilla raíz (~2 MB)** están muertos como páginas vivas: todo `*.html` interno se redirige a React; sobreviven solo en el bundle `/legacy` de rollback. Los `*_extension.js`/`*_patch.js` no corren salvo que alguien abra `/legacy/...` directo. (Los ~14 que SÍ sirven en la raíz pública: `solicitar*`, `approval_batch_quick_approve*`, libs PDF vendored, `payment_batch_*`.)
  `[ ] confirmo · [ ] no aplica · nota:`
- **Migraciones duplicadas** (append-only, no se borran; solo notarlas): `fix_extraordinary_execution_context_recursion` aparece 2 veces (`20260902041542` y `20260903023224`); trío `_v2` de partida que supersedió a su v1 el mismo día. Y 2 SQL sueltos en la raíz (`diagnostico_limpieza_proveedores.sql`, `tanda_8d_validacion_financiera.sql`) probablemente obsoletos.
  `[ ] confirmo · [ ] no aplica · nota:`
- **TODO/FIXME:** solo 9 en todo `app/src` — sano.

## 2. Consistencia de lenguaje / framework

- **CONTPAQ es el único módulo 100% JS** (19 archivos) con solo 2 `.d.ts` a mano; `allowJs`/`checkJs` apagados → **el módulo financiero más sensible es el único sin red de tipos**, y los `.d.ts` pueden desincronizarse del `.js` en silencio.
  `[ ] confirmo · [ ] no aplica · nota:`
- **`as any` en cada frontera de Supabase** (~19; 9 solo en `layouts/api.ts`) + 78 `: any` → los RPC quedan **sin tipar de punta a punta**; el drift del schema de Postgres no sale en TS. Falta generar/cablear los tipos de la BD. (Bueno: **cero `@ts-ignore`**, `strict` on.)
  `[ ] confirmo · [ ] no aplica · nota:`
- **Doble mantenimiento vanilla↔React** en los flujos grandes: `layouts` (125 KB), `provider_intakes` (131 KB), `solicitudes` (87 KB + 4 satélites), toda la nómina (~15 `payroll_*.js`). El strangler va a medio camino y el lado vanilla **aún se parcha**.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Estilos:** consistente (24 CSS Modules + 1 archivo de tokens); solo 36 archivos con estilos inline que brincan el sistema de tokens.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Edge functions:** `jspdf_edge.ts`/`pdf_logo*.ts` **byte-idénticos duplicados** en 2 functions + un tercer stack de PDF divergente (`weekly-request-digest`); sin `_shared/`; CORS disperso; versiones de deps pineadas por-función (pueden divergir).
  `[ ] confirmo · [ ] no aplica · nota:`

## 3. Ceremonia / sobre-ingeniería (acotada — el dominio SÍ es complejo)

- **El unwrap `if (error) throw error` está copiado ~156 veces** + 45 loaders `load*` casi idénticos + 3 wrappers RPC forkeados (`rpcError` en `ingresos/logic.ts:253`, `rpc` en `ObligationsPanel.tsx:37`, `rpcIdempotent` en `comprobantes/api.ts:17`). → **un solo `lib/rpc.ts` es el cleanup de mayor payoff.**
  `[ ] confirmo · [ ] no aplica · nota:`
- **`features/solicitudes/RequestModal.tsx`: 1,230 líneas, 54 `useState`, 13 `useEffect`** — God-component; el hotspot más claro del front.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Modal a medio consolidar:** existe `components/ui/Modal.tsx` (30 archivos lo usan) pero 25 features arman su propio overlay con 5 CSS duplicados.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Churn de migraciones/guards en `payment_requests`** (21 triggers; recursión re-fixeada 3× en 48h) — la malla de guards creció más rápido que la capacidad de razonarla. *Parte es esencial* (integridad del dinero); el objetivo es consolidar y documentar el orden de disparo, no borrar.
  `[ ] confirmo · [ ] no aplica · nota:`
- **6 columnas `notification_*_immediate_enabled`** en vez de una tabla `event_type→enabled` (sprawl de config del lado BD).
  `[ ] confirmo · [ ] no aplica · nota:`

## 4. Salud / tooling

- **Typecheck limpio** (0 errores), `strict` on — pero `noUnusedLocals`/`noUnusedParameters` en `false` dejan pasar código/params muertos.
  `[ ] confirmo · [ ] no aplica · nota:`
- **NO hay ESLint ni Prettier** — nada estático atrapa el `as any`, hooks mal usados, imports muertos. **Fix accionable #1.** (Ver apéndice "¿Para qué sirve ESLint?".)
  `[ ] confirmo · [ ] no aplica · nota:`
- **Tests:** SÍ hay suite fuerte — **1,301/1,303 pasan** (`node --test scripts/qa/*.mjs`, offline con pglite, ~7s) cubriendo aprobación/pagos/nómina/export/tenant-scoping. Falta **tests unitarios co-localizados en `app/src`** (el React se cubre por contratos de paridad; `react-test-renderer` sí se usa, no es peso muerto). **1 test flaky por fecha:** `scripts/qa/weekly-request-digest.test.mjs:69` — fijar reloj.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Deps:** lean y coherente (1 sola stack de estado). Watch: **`xlsx@0.18.5`** (versión con CVEs históricos de SheetJS) — auditar.
  `[ ] confirmo · [ ] no aplica · nota:`
- **Git:** 89 ramas locales, **~41 ya mergeadas a `dev`** → podar (`git branch --merged dev | grep -v dev | xargs git branch -d`). 37 workflows de CI. Secrets/.env limpios (`.env` no trackeado, nada hardcodeado).
  `[ ] confirmo · [ ] no aplica · nota:`

---

## 🎯 Top acciones (priorizadas por payoff = impacto ÷ riesgo)

| # | Acción | Impacto | Riesgo | Validación Ramón |
|---|---|---|---|---|
| 1 | **ESLint + Prettier + `react-hooks`** con script y paso de CI | Muy alto | Bajo | `[ ]` |
| 2 | **`lib/rpc.ts` + helper de query** → colapsar ~156 unwraps y 3 wrappers | Muy alto | Bajo | `[ ]` |
| 3 | **Borrar código muerto** (trío huérfano + 27 exports + `fluxFinanciera.js`) + activar `noUnusedLocals` | Alto | Bajo | `[ ]` |
| 4 | **Podar ~41 ramas mergeadas** + fijar el test flaky de fecha | Medio | Muy bajo | `[ ]` |
| 5 | **CONTPAQ → TS** (o `checkJs`+JSDoc) y **generar tipos de Supabase** | Alto | Medio | `[ ]` |
| 6 | **Terminar/retirar el vanilla por feature** (empezando por los ya redirigidos) | Alto | Medio | `[ ]` |
| 7 | Refactor `RequestModal` (reducer) + terminar migración a `Modal` | Alto | Medio | `[ ]` |
| 8 | Auditar/consolidar la malla de triggers de `payment_requests` | Alto | Medio-alto | `[ ]` |

---

## Lo que está BIEN (para ser justos)

Typecheck limpio + `strict`; **cero `@ts-ignore`**; suite de contratos financiera robusta (~1,300 pruebas offline); ESM consistente en todo; estilos consistentes (CSS Modules + tokens); secrets/.env limpios; CI amplia (37 workflows); baja densidad de TODOs; baseline de migraciones squasheada (buena higiene); dependencias lean y coherentes.

---

## Apéndice — ¿Para qué sirve ESLint? (justifica la acción #1)

Es un **linter**: analiza el código estáticamente (sin correrlo) y marca problemas antes de runtime/producción.
- **Bugs comunes:** variables/imports sin usar, variables no definidas, `==` vs `===`, promesas sin `await`, `case` sin `break`.
- **React Hooks** (`eslint-plugin-react-hooks`): dependencias faltantes en `useEffect`, hooks condicionales — la causa #1 de bugs sutiles de estado.
- **Consistencia de estilo** (con Prettier): formato uniforme, sin discusión en PRs.

Hoy nada estático atrapa los `as any`, el código muerto (`noUnusedLocals` off) ni los hooks mal usados. Corre en cada commit y en CI, muchos errores se arreglan con `--fix`, y en un app de dinero previene clases enteras de bugs antes de que un humano los revise.
