# Migración: Configuración (vanilla → React)

**Ruta:** `/configuracion` (soporta `?tab=` vía `useSearchParams`).
**Componente default-export:** `ConfiguracionPage` en `ConfiguracionPage.tsx`.
**Fuente vanilla:** `configuracion.html` + `configuracion.js` (+ `config.js` para los gates de rol).

> Nota: `App.tsx` hoy enruta `/configuracion` a `SectionPending`. No se editó (fuera de mi carpeta). El padre debe cablear la ruta a `ConfiguracionPage`.

## Pestañas migradas y gate de rol

Gates espejo de `canAccessConfigTab` en `config.js` (implementados localmente en `logic.ts::canAccessConfigTab`, derivando `group` de `useAuth().group`). Las pestañas sin acceso se ocultan (igual que el `hidden`/`disabled` del vanilla).

| Tab (key) | Etiqueta | Badge | Grupos con acceso |
|---|---|---|---|
| `members` | Socios | Dir | SYSADMIN, DIRECTION |
| `originAccounts` | Cuentas origen | Adm/Dir | SYSADMIN, ADMIN, DIRECTION |
| `budgets` | Presupuestos | Trim. | SYSADMIN, ADMIN, DIRECTION |
| `contpaq` | Mapeo CONTPAQ | Adm/Dir | SYSADMIN, ADMIN, DIRECTION |
| `system` | Sistema | SysAdmin | SYSADMIN |

Resolución inicial (`openInitialTab`): alias de `?tab=` soportados (`socios/members`, `cuentas/cuentas_origen/cuentas-origen/originAccounts`, `presupuestos/budgets`, `contpaq`, `sistema/system`). Si el tab pedido existe pero no hay acceso → muestra aviso de permiso y abre la primera pestaña permitida. La resolución corre una vez cuando `useAuth().loading` termina (el grupo se resuelve async; el vanilla equivalía a `await FluxAuth.ready()`).

## Tablas usadas (selects/updates directos)

- `companies` (id,name,legal_name,active) — cuentas origen, contpaq, enrutamiento.
- `company_bank_accounts` — cuentas origen (select/insert/update; toggle `active`). Bucket de upload: N/A (esta sección no sube archivos).
- `members`, `maintenance_fee_charges`, `maintenance_fee_payments`, `incident_charges`, `invoices`, `billing_periods` — Socios (select) + `members` insert/update.
- `profiles` (id,email,full_name,created_at,active), `user_roles` (profile_id, roles(id,name)), `roles` (id,name) — Sistema/gestión de usuarios (select, delete+insert de user_roles).
- `budget_categories` (id,name,category,code,active) — Contpaq (select + update de `category`).
- `contpaq_accounts` (code,name,is_detail) — Contpaq (select paginado 1000/pág).
- `budget_account_mappings` (budget_category_id,contpaq_account_code,needs_review) — Contpaq (select paginado, upsert `onConflict: company_id,budget_category_id`, delete).

## RPCs (nombre + params)

- `list_profile_company_memberships` () — Sistema.
- `list_approver_assignments` () — Sistema.
- `set_profile_company_membership` (p_profile_id, p_company_id, p_active) — alta/toggle membresía.
- `list_company_approver_candidates` (p_company_id, p_requester_id) — pool de aprobadores elegibles.
- `add_approver_assignment` (p_company_id, p_requester_id, p_approver_id) — alta/reactivar aprobador.
- `remove_approver_assignment` (p_assignment_id) — quitar aprobador.

Códigos de error de enrutamiento mapeados a mensajes en español: `friendlyRoutingError` (logic.ts), 1:1 con el vanilla.

## Estructura de archivos

- `ConfiguracionPage.tsx` (default export) — barra de pestañas + aviso de permiso + tab activa.
- `types.ts`, `logic.ts` (puro), `api.ts` (selects/RPCs).
- `tabs/MembersTab.tsx`, `tabs/OriginAccountsTab.tsx`, `tabs/BudgetsTab.tsx`, `tabs/ContpaqTab.tsx`, `tabs/SystemTab.tsx`.
- Modales: `MemberModal.tsx`, `MemberHistoryModal.tsx`, `OriginAccountModal.tsx`, `AssignRoleModal.tsx`, `GrupoModal.tsx`.
- `Configuracion.module.css` (CSS Modules; compartido por página, tabs y modales).

## Pestañas que viven en archivos vanilla separados (NO se jalaron)

- `socios.html` es una página standalone separada. En ESTA migración el surface "Socios" es el panel `membersPanel` que `configuracion.html`/`configuracion.js` renderizan directamente (loadSocios), así que se portó ese panel. La página `socios.html` independiente NO se incorporó.
- `proveedores.html?tab=cuentas-origen` es otra vista de las cuentas origen que vive en la sección Proveedores; en Configuración el panel `originAccountsPanel` se renderiza directamente aquí y es el que se portó. La variante de proveedores NO se jaló.

## Riesgos de paridad / notas

- **Toast variants:** el vanilla usa `"danger"` en muchos toasts; el `useToast` de React solo tiene `success|error|warning|info`. Se mapeó `danger → error` (mismo rol semántico). `"warning"` y `"success"` idénticos.
- **Badge "violet":** `GROUP_BADGE.direction` era `"violet"` en el vanilla; el `Badge` compartido no tiene esa variante. Se aproximó a `"accent"` (misma que sysadmin). Distinción visual director/sysadmin se pierde ligeramente. El resto de badges (success/neutral/info/warning/danger) son 1:1.
- **Input de mapeo CONTPAQ:** el vanilla guarda en el evento DOM `change` (blur/commit). En React se usa `onBlur` con guardia `v !== code` para evitar guardar en cada tecla. Diferencia menor: al elegir del `datalist` con clic sin desenfocar, el guardado ocurre al perder foco (no instantáneo). Validaciones ("Cuenta no encontrada", "Cuenta de mayor", cuenta de detalle) idénticas.
- **`formatDate`:** se replica la versión del vanilla de `configuracion.js` que devuelve `"—"` (no la de `lib/format` que devuelve `"Sin fecha"`), para paridad exacta en tablas/historial.
- **Ordenamiento del `datalist` de cuentas:** cuentas de detalle, código que empieza con `6` (gasto) primero, luego alfabético — igual que vanilla.
- **Contador CONTPAQ / filtros / agrupación por `category`:** portados 1:1 (incluye mensaje especial "¿ya corriste el DDL...?" y el de RLS al editar agrupación).
- **`memberBalance`** (pending/historic/openIncidents/pendingInvoices) y los badges de estatus de cuotas/pagos/incidencias/facturas: 1:1.
- **Alias de rol al asignar** (`ROLE_ALIASES`) y `groupFromRoleNames`: portados 1:1; el rol destino se resuelve ANTES de borrar los `user_roles` actuales (misma secuencia segura del vanilla).
- **Logout / topbar / sidebar:** no forman parte de esta sección migrada (los provee el `AppShell` del shell React).
