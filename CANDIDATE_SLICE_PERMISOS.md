# Candidate slice: Permisos / Aprobador asignado

Rama: `candidate/slice-permisos-aprobador` (base: `origin/main` @ 1dc0fd4, post Slice 01A).
Porta 1:1 el paquete "Permisos" del plan de release: roles y accesos por usuario/empresa +
aprobador asignado al crear solicitudes. PRs fuente: **#240, #241, #242** (merges
`67c4a9d`, `edb72bf`, `95b019a` en `origin/dev`).

## Contenido (archivos y PR fuente)

| Archivo | PRs | Cambio |
|---|---|---|
| `configuracion.html` | 240, 241 | Sección "Ruteo de aprobadores": membresías empresa×usuario + aprobadores disponibles por solicitante |
| `configuracion.js` | 240, 241 | CRUD vía RPC: `set_profile_company_membership`, `list_profile_company_memberships`, `add_approver_assignment`, `remove_approver_assignment`, `list_approver_assignments`, `list_company_approver_candidates` |
| `solicitudes.html` | 240, 241, 242 | Selector obligatorio de revisor/aprobador (`#approverId`, `#approverAssignmentId`), reubicado después de los datos de la solicitud (242) |
| `solicitudes.js` | 240, 241, 242 | Carga de opciones (`list_payment_request_approver_options`), envío de `p_approver_id`/`p_approver_assignment_id` en `create_payment_request`, aprobador efectivo en detalle (`get_payment_request_approver_details`) |
| `aprobaciones.html` | 240, 241 | Bump de versión de script |
| `aprobaciones.js` | 240, 241 | Muestra aprobador efectivo y filtra la cola por aprobador asignado (`get_payment_request_approver_details`) |
| `cash_flow_extension.js` | 240, 241 | Pasa approver en la ruta de creación vía cash flow |
| `fase2_request_payment_method_extension.js` | 240, 241 | Ver nota de hunks quirúrgicos abajo |
| `fase2_request_success_patch.js` | 240, 241, 242 | Reset del selector al crear otra solicitud |

## Método de porteo

- Archivos cuyo contenido en `origin/main` era idéntico a la base del PR #240 y que solo
  fueron tocados por los 4 commits del feature en el rango 240→242
  (`aprobaciones.js`, `cash_flow_extension.js`, `configuracion.js`,
  `fase2_request_success_patch.js`, `solicitudes.js`): se tomó el archivo completo del
  estado post-#242 (`95b019a`). Resultado byte-idéntico a dev en ese punto.
- `aprobaciones.html`, `configuracion.html`, `solicitudes.html`: se tomó el estado
  post-#242 y se restauró el bloque `<nav>` de `main` (ver hunks excluidos).
- `fase2_request_payment_method_extension.js`: hunks quirúrgicos (ver abajo).

## Hunks excluidos (otros features, NO portados)

1. **Rediseño de nav** en `aprobaciones.html` (@67), `configuracion.html` (@47),
   `solicitudes.html` (@110): dev trae un `<nav>` con clases `muted`, links
   `ingresos.html?tab=…` y títulos en minúsculas. No es parte de Permisos; esta rama
   conserva el nav de `main`. Diff representativo (dev vs main, excluido):
   ```diff
   -          <a href="./ingresos.html?tab=income" data-flux-nav-key="income" class="nav-link muted">…
   +          <a href="./ingresos.html" data-flux-nav-key="income" class="nav-link">…
   ```
2. **Versión evolucionada de `fase2_request_payment_method_extension.js` en dev**
   (~425+/383- vs main; incluye `initPaymentsPage`, refresh timers de batch/pagos,
   `provider_payment` rename, quick provider creation). Pertenece a otros paquetes
   (batch/fase2); NO se arrastró. Los 4 hunks del feature (PR 240+241) se re-aplicaron
   a mano sobre la versión de `main`:
   - RPC `create_payment_request`: `+ p_approver_id`, `+ p_approver_assignment_id`
   - `collectRequestPayload()`: `+ approver_id: value("approverId")`,
     `+ approver_assignment_id: value("approverAssignmentId") || null`
   - `validateRequestPayload()`: `+ if (!payload.approver_id) return "Selecciona quien revisa o aprueba la solicitud."`
   - `resetRequestModalForAnother()`: reset de `#approverId` / `#approverAssignmentId`
3. **Drift post-#242 en dev** sobre estos archivos (batch QA, cortes/cash fund,
   extraordinarios, receipt linking; p.ej. `cash_flow_extension.js` +148/-37): fuera de
   alcance de este slice, quedará en sus propios paquetes.

No quedó ningún hunk entrelazado sin resolver.

## Excluido por regla

`supabase/migrations/` (018, 019 van aparte, ya staged), `ops/`, `.github/workflows/`,
`docs/`, `scripts/qa/`.

## Validación de RPCs vs migraciones 018/019

El frontend llama, con nombres y parámetros EXACTOS a las definiciones:

- `create_payment_request(…, p_approver_id, p_approver_assignment_id)` — firma final en 019
- `list_payment_request_approver_options(p_company_id, p_cost_center_id, p_amount)` — 019
- `list_company_approver_candidates(p_company_id, p_requester_id)` — 019
- `get_payment_request_approver_details(p_payment_request_id)` — 018, redefinida en 019
- `list_profile_company_memberships()` — 018
- `set_profile_company_membership(p_profile_id, p_company_id, p_active)` — 018
- `list_approver_assignments()` — 018, redefinida en 019
- `add_approver_assignment(p_company_id, p_requester_id, p_approver_id)` — **solo existe en 019**
- `remove_approver_assignment(p_assignment_id)` — firma de 019 (la de 018 era `(uuid, uuid)`)

⚠️ El frontend usa las firmas de **019**. Aplicar solo 018 sin 019 rompe la pantalla de
Configuración (`add_approver_assignment` no existiría) y el selector
(`list_payment_request_approver_options` no existiría). **018 y 019 van juntas, en orden.**

## Orden de despliegue — ATÓMICO

Este slice REQUIERE, en este orden:

1. Migraciones **018 + 019** aplicadas a prod.
2. **Seed de ruteo** (ya staged): membresías de Francisco/Alfredo/Yanin/César en
   Operadora; asignaciones Francisco→Alfredo y Alfredo→Yanin; ajustes de roles.
3. **Merge de esta rama.**

- Si se mergea el código sin DB+seed: la creación de solicitudes truena
  (RPC sin `p_approver_id` / selector sin opciones).
- Si se aplica DB sin seed y sin código: `create_payment_request` exige aprobador que el
  frontend viejo no manda → también truena.

## Verificaciones ejecutadas

- `node --check` OK en los 6 .js tocados.
- Referencias `src="./…"` de los 3 HTML apuntan a archivos existentes en la rama.
- `#approverId` / `#approverAssignmentId` presentes en `solicitudes.html` y consumidos
  por `solicitudes.js` / `fase2_request_payment_method_extension.js`.
- Sin marcadores de conflicto; `git diff --check` limpio.
- Archivos de base limpia byte-idénticos al estado dev post-#242 (`95b019a`).
