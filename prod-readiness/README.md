# Prod-readiness Fersana — candidato PROD congelado

Paquete de apoyo para llevar **Soporte Fersana** a producción. **Nada aquí se
ha aplicado a prod.** El candidato queda congelado por SHA-256 en
[`MANIFEST.sha256`](./MANIFEST.sha256) y requiere una autorización de ejecución
separada de Ramón.

Estado verificado de prod (1-sep-2026): `main` NO tiene `app/` ni
`vercel.json`; prod DB no tiene las tablas nuevas de este paquete; 1 empresa,
0 Fersana; última migración `20260827205542`. El PR #467 sigue abierto.

## Orden de ejecución

| Paso | Qué | Depende de |
|---|---|---|
| **0** | `paso1-preflight-prod.sql` (solo lectura) | — |
| **1** | Migraciones aditivas corregidas (abajo) | 0 = PASS |
| **2** | Edge functions + recuperación de notificaciones, con versión/hash fijados | 1 |
| **3** | Auth prod + variables runtime Vercel (redirect, Site URL y `FLUX_*`) | — |
| **4** | Seed Fersana + responsables + postcheck | 1 |
| **5** | Frontend `/app` a `main` (PR #467, aditivo) | 1, 2, 3, 4 = PASS |
| **6** | Ensayo de aislamiento + smoke Fersana/Operadora | 5 |

`main` no se mergea (= deploy) hasta que backend, Auth, variables, seed y
postcheck estén verificados. El vanilla permanece como fallback durante todo el
corte. Ante cualquier falla seguir [`ROLLBACK.md`](./ROLLBACK.md); no improvisar
`DROP`, limpieza ni reintentos.

---

## Paso 0 · Preflight de solo lectura

Ejecutar [`paso1-preflight-prod.sql`](./paso1-preflight-prod.sql) en el proyecto
`ucantptjhwttexzmslvm`. Debe emitir `FERSANA_PREFLIGHT_PASS`. Comprueba:

- exactamente una empresa incumbente y ausencia de Fersana;
- exactamente una versión presupuestal 2026 activa;
- tablas, funciones y roles requeridos;
- ausencia de colisiones `SF` / `SF-2026-*`;
- ausencia de los siete objetos nuevos.

La transacción es `READ ONLY` y termina en `ROLLBACK`.

## Paso 1 · Migraciones a prod

Aplicar únicamente los archivos exactos incluidos en
[`MANIFEST.sha256`](./MANIFEST.sha256), en este orden. No copiar SQL desde el
chat ni editarlo en Supabase Studio.

1. `20260826223239_platform_module_registry.sql` — crea `modules`,
   `module_releases` y `company_modules`.
2. `20260826223357_platform_module_registry_advisor_hardening.sql`
3. `20260827090000_platform_module_incidencias.sql` — fija Incidencias en ON
   para el único `company_id` incumbente validado por el preflight; no usa
   nombre ni UUID hardcodeado.
4. `20260827100000_platform_module_nomina.sql`
5. `20260831003419_fersana_company_access_onboarding.sql` +
   `20260831005200_fersana_company_access_advisor_hardening.sql` — DDL y RPC
   atómicos; la liga `fersana` se crea después, dentro del seed.
6. `20260831120000_tenant_recurring_income.sql` — **WS7** (2 tablas + RLS +
   `generate_recurring_income`), con FK compuesta que impide ligar un template
   de otra empresa.
7. `20260831130000_budget_category_responsible.sql` — agrega `responsible_email` e índice para scoping de partidas.

Cada archivo debe cerrar con `COMMIT`. Después: `get_advisors(security)` en
prod y verificación de RLS.

### Corte company-scoped descubierto durante ejecución

Después de la fundación `company_scoped_roles_foundation`, PROD confirmó que
no tiene la tabla opcional de preview CFDI, las cuatro tablas operativas de
Nómina ni dos RPC de escritura CONTPAQ que sólo existen en DEV. La ola original
abortó transaccionalmente antes de cambiar policies.

Para PROD se generan variantes reproducibles mediante
`scripts/qa/build-prod-company-cutover-compat.mjs`:

1. `generated/company_scoped_rls_rpc_cutover_prod.sql` — corta todas las tablas
   productivas y exige que las cinco tablas fuera de alcance continúen ausentes.
2. `generated/company_scoped_rpc_cutover_prod.sql` — corta todos los RPC
   productivos, omite únicamente las dos firmas CONTPAQ ausentes y reescribe
   con conteo exacto dos RPC de compatibilidad que DEV ya no conserva.
3. `generated/company_scoped_historical_actuals_prod.sql` — reemplaza las dos
   policies globales heredadas de históricos por lectura de miembros y escritura
   de Finanzas en la empresa exacta; aborta si existe una fila sin `company_id`.

Ambas variantes deben pasar juntas en una transacción de ensayo terminada en
`ROLLBACK` antes de aplicarse. Nómina y CFDI/CONTPAQ no se habilitan ni se crean
como parte de esta compatibilidad.

**Nómina:** sólo se registra el módulo y permanece OFF para todas las empresas.
No aplicar ninguna migración operativa N0–N5 ni desplegar funciones de Nómina.

---

## Paso 2 · Edge functions

No desplegar "la última" versión a ciegas. Preparar una matriz DEV→PROD con versión, SHA-256, `verify_jwt`, secretos requeridos y razón del cambio. Para este release sólo se despliegan funciones indispensables para Fersana; Nómina permanece fuera de alcance y deshabilitada. **WS7 no usa edge function** (es RPC).

La matriz viva está congelada en [`paso2-edge-functions-matrix.md`](./paso2-edge-functions-matrix.md). Resultado del preflight del 1-sep-2026: las cuatro funciones comunes de PROD ya contienen los contratos necesarios y conservan variantes correctas para `https://flux.quantta.mx`; **no copiar las versiones DEV a PROD**. En particular, las versiones DEV contienen orígenes y controles `test_only` que no deben promoverse.

Antes del corte se debe aplicar y activar, con cutoff nuevo, [`paso2b-notification-recovery-prod.sql`](./paso2b-notification-recovery-prod.sql). El script agrega el wake-up faltante de `payment_request.approved` y un recovery de cinco minutos para las cuatro rutas de correo. Es fail-closed: sin secretos/flags explícitos no reclama eventos. Nunca reutilizar un cutoff histórico, porque PROD conserva eventos `pending` anteriores al corte.

## Paso 3 · Auth prod

Supabase prod → Authentication → URL Configuration:

- **Site URL:** `https://flux.quantta.mx`.
- Redirect vanilla: `https://flux.quantta.mx/solicitudes.html?post_login=1`.
- Redirect React: `https://flux.quantta.mx/app/**`. El glob queda limitado a `/app/` porque el login React conserva la ruta actual, incluida la liga de acceso por empresa.
- Google OAuth callback del proyecto PROD: `https://ucantptjhwttexzmslvm.supabase.co/auth/v1/callback`.

Vercel no inyecta `VITE_*` en este despliegue. `/api/runtime-config` lee únicamente:

- `FLUX_SUPABASE_URL` → proyecto PROD `ucantptjhwttexzmslvm` en scope **Production**.
- `FLUX_SUPABASE_ANON_KEY` → clave pública del mismo proyecto en scope **Production**.
- `FLUX_ENV=prod` en scope **Production**.

`FLUX_SUPABASE_SERVICE_ROLE_KEY` puede existir para endpoints server-side, pero nunca se devuelve en `/api/runtime-config`, nunca se declara como `VITE_*` y nunca se expone al navegador.

## Paso 4 · Seed Fersana

1. `paso5-fersana-seed.sql` — empresa + liga de acceso + cost center SF +
   cuenta origen BBVA + módulos + **budget 2026 completo** (60 partidas; 56 con
   monto / 322 líneas = $6,289,204). Es transaccional y fail-closed.
2. `paso5b-fersana-responsables.sql` — asigna las 60 partidas a sus cinco
   responsables, valida 60/60 y ahora también es transaccional.
3. `paso1-postcheck-prod.sql` — sólo lectura; debe emitir
   `FERSANA_POSTCHECK_PASS`.

Memberships/roles/aprobadores **no** se seedean (los profiles se crean en el
primer login OAuth). Antes de autorizar la ejecución se debe confirmar la lista
final de correos; el catálogo preparado usa `ychavez@fluxfinanciera.com` para
Yulma y `contabilidad2@soportef.com` para las cinco partidas contables.

## Paso 5 · Frontend `/app`

Fusionar PR #467 sólo cuando los pasos 1–4 estén completos. El alcance debe permanecer aditivo: `app/`, `vercel.json` y `scripts/build-vercel-static.mjs`; el vanilla no se elimina.

## Paso 6 · Ensayo de aislamiento

`paso6-ensayo-aislamiento.sql` — crea empresa desechable `ZZ Aislamiento`, verifica que su data no cruza con Operadora/Fersana (y viceversa) en cada feature scopeada, corre advisors y borra todo. La limpieza elimina membresías, asignaciones, solicitudes y enlaces de la empresa desechable; el perfil de autenticación sólo se elimina manualmente si fue creado exclusivamente para el ensayo y no conserva historia. Es la prueba que saca el **riesgo #1** (aislamiento entre empresas, que se estrena en prod).

---

_Candidato corregido y congelado el 1-sep-2026. PROD no tocado._
