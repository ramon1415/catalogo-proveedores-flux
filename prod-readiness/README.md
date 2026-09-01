# Prod-readiness Fersana — runbook (DRAFT)

Paquete de apoyo para llevar **Soporte Fersana** a producción. **Nada aquí se ha aplicado a prod.** Es material de revisión para Ramón (dueño del pipeline de prod).

Estado verificado de prod (31-ago-2026): `main` NO tiene `app/` ni `vercel.json`; prod DB no tiene `company_modules` ni `platform_module_registry`; 1 empresa (Operadora), 0 Fersana; última migración `20260827205542`. `main` y `dev` están **divergidos** (dev +1040 / main +164).

## Orden de ejecución

| Paso | Qué | Depende de |
|---|---|---|
| **1** | Migraciones aditivas (abajo) | Preflight de esquema PROD |
| **2** | Edge functions necesarias, con versión/hash fijados | 1 |
| **3** | Auth prod + variables Vercel (redirect, Site URL y `VITE_*`) | — |
| **4** | Seed Fersana + responsables (`paso5*.sql`) | 1 |
| **5** | Frontend `/app` a `main` (PR #467, aditivo) | 1, 2, 3, 4 |
| **6** | Ensayo de aislamiento + smoke Fersana/Operadora | 5 |

`main` no se mergea (= deploy) hasta que backend, Auth, variables y seed estén verificados. El vanilla permanece como fallback durante todo el corte.

---

## Paso 1 · Migraciones a prod

Las migraciones de dev son **aditivas** (crean objetos que no existen en prod) → aplicar en este orden. Antes de ejecutar, comparar cada una contra el esquema vivo de PROD y congelar su SHA-256.

1. `20260826223239_platform_module_registry.sql` — crea `modules` / `company_modules` / `platform_module_registry` y **siembra a Operadora** (la identifica por `incident_charges`, no por id).
2. `20260826223357_platform_module_registry_advisor_hardening.sql`
3. `20260827090000_platform_module_incidencias.sql`
4. `20260827100000_platform_module_nomina.sql`
5. `20260831003419_fersana_company_access_onboarding.sql` + `20260831005200_fersana_company_access_advisor_hardening.sql`
6. `20260831120000_tenant_recurring_income.sql` — **WS7** (2 tablas + RLS + `generate_recurring_income`).
7. `20260831130000_budget_category_responsible.sql` — agrega `responsible_email` e índice para scoping de partidas.

Después: `get_advisors(security)` en prod. Verificar RLS de las tablas nuevas.

**Caveat:** la del registry siembra Operadora — verificar que en prod queda con sus módulos correctos (no romper su nav vanilla; la app vanilla no usa company_modules, así que no la afecta, pero el /app sí lo leerá).

---

## Paso 2 · Edge functions

No desplegar "la última" versión a ciegas. Preparar una matriz DEV→PROD con versión, SHA-256, `verify_jwt`, secretos requeridos y razón del cambio. Para este release sólo se despliegan funciones indispensables para Fersana; Nómina permanece fuera de alcance y deshabilitada. **WS7 no usa edge function** (es RPC).

## Paso 3 · Auth prod

Supabase prod → Authentication → URL Configuration: agregar **Redirect URL** del `/app` de prod y confirmar **Site URL**. Vercel prod: verificar `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` contra el proyecto PROD. No exponer `service_role` ni secretos en variables `VITE_*`.

## Paso 4 · Seed Fersana

1. `paso5-fersana-seed.sql` — empresa + cost center SF + cuenta origen BBVA + módulos + **budget 2026 completo** (60 partidas; 56 con monto / 322 líneas = $6,289,204). El insert de líneas es rerun-safe y el postcheck aborta la transacción si no coincide el conteo o total esperado.
2. `paso5b-fersana-responsables.sql` — asigna las 60 partidas a sus cinco responsables y valida 60/60.

Prerrequisitos: paso 1 aplicado + una `budget_versions` activa 2026 en prod. Memberships/roles/aprobadores **no** se seedean (los profiles se crean en el primer login OAuth). Antes del corte se debe confirmar la lista final de correos; el catálogo preparado usa `ychavez@fluxfinanciera.com` para Yulma y `contabilidad2@soportef.com` para las cinco partidas contables.

## Paso 5 · Frontend `/app`

Fusionar PR #467 sólo cuando los pasos 1–4 estén completos. El alcance debe permanecer aditivo: `app/`, `vercel.json` y `scripts/build-vercel-static.mjs`; el vanilla no se elimina.

## Paso 6 · Ensayo de aislamiento

`paso6-ensayo-aislamiento.sql` — crea empresa desechable `ZZ Aislamiento`, verifica que su data no cruza con Operadora/Fersana (y viceversa) en cada feature scopeada, corre advisors y borra todo. La limpieza elimina membresías, asignaciones, solicitudes y enlaces de la empresa desechable; el perfil de autenticación sólo se elimina manualmente si fue creado exclusivamente para el ensayo y no conserva historia. Es la prueba que saca el **riesgo #1** (aislamiento entre empresas, que se estrena en prod).

---

_Generado por Claude Code el 31-ago-2026 desde el estado de dev._
