# Prod-readiness Fersana — runbook (DRAFT)

Paquete de apoyo para llevar **Soporte Fersana** a producción. **Nada aquí se ha aplicado a prod.** Es material de revisión para Ramón (dueño del pipeline de prod).

Estado verificado de prod (31-ago-2026): `main` NO tiene `app/` ni `vercel.json`; prod DB no tiene `company_modules` ni `platform_module_registry`; 1 empresa (Operadora), 0 Fersana; última migración `20260827205542`. `main` y `dev` están **divergidos** (dev +1040 / main +164).

## Orden de ejecución

| Paso | Qué | Depende de |
|---|---|---|
| **1** | Frontend `/app` a `main` (PR #467, aditivo) | — |
| **2** | Migraciones `_prod` (abajo) | — |
| **3** | Edge functions a prod | — |
| **4** | Auth prod (redirect + Site URL) | 1 |
| **5** | Seed Fersana (`paso5-fersana-seed.sql`) | 2 |
| **6** | Ensayo de aislamiento (`paso6-ensayo-aislamiento.sql`) | 1, 2, 5 |

`main` no se mergea (= deploy) hasta que 2 y 4 estén listos, o el `/app` se rompe (el vanilla sigue OK).

---

## Paso 2 · Migraciones a prod

Las 5 migraciones de dev son **aditivas** (crean objetos que no existen en prod) → aplican **tal cual**, en este orden. Confirmar la convención dev/prod (algunas migraciones llevan gemela `_prod`; estas 5 no dependen de estado dev-específico).

1. `20260826223239_platform_module_registry.sql` — crea `modules` / `company_modules` / `platform_module_registry` y **siembra a Operadora** (la identifica por `incident_charges`, no por id).
2. `20260826223357_platform_module_registry_advisor_hardening.sql`
3. `20260827090000_platform_module_incidencias.sql`
4. `20260827100000_platform_module_nomina.sql`
5. `20260831003419_fersana_company_access_onboarding.sql` + `20260831005200_fersana_company_access_advisor_hardening.sql`
6. `20260831120000_tenant_recurring_income.sql` — **WS7** (2 tablas + RLS + `generate_recurring_income`).

Después: `get_advisors(security)` en prod. Verificar RLS de las tablas nuevas.

**Caveat:** la del registry siembra Operadora — verificar que en prod queda con sus módulos correctos (no romper su nav vanilla; la app vanilla no usa company_modules, así que no la afecta, pero el /app sí lo leerá).

---

## Paso 3 · Edge functions

Desplegar a prod (una vez por proyecto; dev ≠ prod): `payroll-materialize`, `payroll-receipt-verify`, `notification-dispatcher`, `approval-batch-submitted-dispatcher`, `approval-batch-quick-approve`, `provider-intake`. Verificar secrets/env en el proyecto de prod. **WS7 no usa edge function** (es RPC).

## Paso 4 · Auth prod

Supabase prod → Authentication → URL Configuration: agregar **Redirect URL** del `/app` de prod y confirmar **Site URL** (en dev apuntaba al dominio viejo → tiraba a `solicitudes.html`). Vercel prod: env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## Paso 5 · Seed Fersana

`paso5-fersana-seed.sql` — empresa + cost center SF + cuenta origen BBVA + módulos + **budget 2026 completo** (56 categorías / 322 líneas = $6,289,204). Idempotente salvo `budget_lines` (ver nota en el archivo). Prerrequisitos: paso 2 aplicado + una `budget_versions` activa 2026 en prod. Memberships/roles/aprobadores **no** se seedean (los profiles se crean en el primer login OAuth) → post-seed, los usuarios entran por la liga `fersana` y SysAdmin les asigna rol.

## Paso 6 · Ensayo de aislamiento

`paso6-ensayo-aislamiento.sql` — crea empresa desechable `ZZ Aislamiento`, verifica que su data no cruza con Operadora/Fersana (y viceversa) en cada feature scopeada, corre advisors, y borra todo. Es la prueba que saca el **riesgo #1** (aislamiento entre empresas, que se estrena en prod).

---

_Generado por Claude Code el 31-ago-2026 desde el estado de dev._
