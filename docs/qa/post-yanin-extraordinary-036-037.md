# Contención legacy y MEJ-05 segura — 036/037

Fecha de auditoría: 2026-07-23  
Base: `origin/dev` en `eb7ffea22bbab37c4b4f752e718e86fe2c23ccf4`  
Rama: `feature/ramon-post-yanin-bugs-extraordinary`

## Diagnóstico de la asociación falsa

El primer diagnóstico relacionó LEG-004 con una reserva usando coincidencias
indirectas de empresa, importe y moneda. La inspección del único allocation item
demostró que su snapshot pertenece a otra solicitud. El falso positivo no
representa un plan compartido ni una segunda ruta de ejecución de LEG-004.

Patrón rechazado:

```sql
-- No demuestra pertenencia.
join payment_allocation_plans plan
  on plan.company_id = request.company_id
 and plan.amount_minor = round(request.amount_requested * 100)
 and plan.currency = request.currency
```

Linaje aplicado:

```sql
authorization.payment_request_id = request.id
receipt_link.payment_request_id = request.id
receipt_link.snapshot_id = snapshot.id
snapshot.payment_request_id = request.id
snapshot.source_id = authorization.id
allocation_item.snapshot_id = snapshot.id
```

Un plan solo pertenece al grafo de una autorización cuando su allocation item
apunta al snapshot directo de esa misma solicitud. Importe, moneda, empresa,
proveedor, documento o proximidad temporal no crean linaje.

## Grafo directo de LEG-004

```text
LEG-004 authorization
  └─ payment_request_id → solicitud paid
       └─ payment_request_receipt_link (1)
            ├─ evidence_id → evidencia shareable (1)
            └─ snapshot_id → snapshot de la solicitud y autorización

allocation items del snapshot: 0
planes derivados de esos items: 0
reservas derivadas de esos planes: 0
movements del snapshot: 0
layouts/cash funds directos: 0
```

Resultado read-only:

- `LEGACY_DIRECT_LINEAGE_PRECHECK_PASS`
- `target_item_count = 0`
- evidencia, snapshot, importe y moneda coincidentes
- cero rutas adicionales directas
- la ausencia de `payment_receipts` y `legacy_payment_receipt_links` se
  conserva; no se fabrican objetos del ledger nuevo

## Matriz legacy

| Caso | Solicitud | Link directo | Evidencia | Ejecución directa adicional | Clasificación |
| --- | --- | ---: | ---: | ---: | --- |
| LEG-001 | `approved`, 500.00 MXN | 0 | 0 | 0 | `legacy_quarantined` |
| LEG-002 | `submitted`, 14.14 MXN | 0 | 0 | 0 | `revoked` |
| LEG-003 | `paid`, 40,705.50 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |
| LEG-004 | `paid`, 29,916.00 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |
| LEG-005 | `paid`, 23,918.00 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |
| LEG-006 | `paid`, 16,500.00 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |
| LEG-007 | `paid`, 565.00 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |
| LEG-008 | `paid`, 2,108.00 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |
| LEG-009 | `paid`, 72,962.54 MXN | 1 | 1 | 0 | `legacy_consumed_unverified` |

Distribución esperada después de 036: `7 / 1 / 1 / 0` para
consumidas sin verificación / cuarentena / revocadas / activas legacy.

## BUG-ALLOC-001 — reserva vencida permanece activa

Hallazgo read-only y fuera del alcance mutable:

| Campo | Resultado sanitizado |
| --- | --- |
| Solicitud | `SOL-***-0077` |
| Estado solicitud | `submitted` |
| Plan | `reserved` |
| Reserva | `active` |
| Vencida por reloj | sí |
| Operación | `reserved` |
| Movements | 0 |
| Importe | 29,916.00 MXN |
| Capacidad reservada | 29,916.00 MXN |
| Fuente snapshot | `approval_batch_item` |
| Impacto | bloquea capacidad, matching y la solicitud operativa |
| Severidad | P1 |

Existen mecanismos de expiración/liberación/cancelación, pero no se invocan en
este PR. Recomendación: auditar por separado el lifecycle automático de
`expire_payment_reservation`, `release_payment_reservation` y
`cancel_payment_allocation_plan`, incluyendo el estado terminal esperado de la
operación bancaria. No resolverlo por coincidencias financieras ni desde 036/037.

## Contrato 036

- Clasificación por claves directas y precondiciones exactas.
- Ledger append-only no despachable.
- RPC legacy bloqueada para `PUBLIC`, `anon` y `authenticated`.
- Cero inserts en receipts, links, layouts, movements, outbox o delivery.
- Hashes de planes, reservas y operaciones se comparan antes/después.
- ALLOC-001 debe conservar byte-equivalente su estado operativo.

## Contrato 037

- Política por empresa, deshabilitada por defecto.
- Operadora permanece deshabilitada.
- Ningún Director o configuración de Director se modifica; Ramón se conserva.
- Begin/finalize en dos pasos.
- Director externo activo e identificado, diferente del actor de Finanzas.
- Monto, moneda, categoría, vigencia e idempotencia fail-closed.
- Evidencia privada de hasta 5 MB con tipo permitido y SHA-256 enlazado a los
  metadatos del objeto antes de activar la autorización.
- Consumo único en layout.
- Estado `consumed_pending_ratification`.
- Ratificación o discrepancia posterior por el Director externo.
- Cambio material invalida.
- Confirmación de pago bloqueada hasta ratificación y coincidencia exacta.
- Sin outbox ni notificaciones.

## Correcciones post-Yanin

- Layout: error persistente dentro del diálogo, mensaje por campo, foco,
  valores preservados y doble submit bloqueado.
- Rechazadas: CTA `Corregir y enviar nuevamente`, mismo folio, motivo e
  historial preservados, revisión incremental y destino explícito.
- Cierre mixto: preview server-side, release por ítem vigente, bloqueados y
  rechazados preservados, cero liberables impide cerrar.

## Estado de validación

- Auditoría read-only de linaje: PASS.
- Regresión de objeto ajeno, ruta directa, ambigüedad y mismatch: PASS.
- Contratos locales 036/037 y post-Yanin: PASS.
- Suite focalizada de aprobación/layout y contratos nuevos: 39/39 PASS.
- Suite completa: 209/210 PASS; el único fallo es el contrato preexistente de
  byte-identidad de la migración 029. Este hotfix no modifica migraciones
  001–035.
- `node --check` en JavaScript modificado: PASS.
- `git diff --check`: PASS.
- SHA-256 036:
  `c74f0b1262e6e4791a08936e85fda8e87542723402b0e021bd1645ff22fda965`.
- SHA-256 037:
  `c3ac140ea4f02d0a735e5e4b3679c2379f92aa1110e3d222d6d84d71b684e3d0`.
- Backup lógico privado read-only: PASS, nueve autorizaciones y ALLOC-001
  incluidos; SHA-256
  `9b271235c2a355a34cfa04f4fa3307b9375a66aa84f6760dff6f7e3474de0916`.
- El primer intento de 036 fue rechazado por el constraint preexistente
  `payment_request_extraordinary_revoke_check`; PostgreSQL revirtió toda la
  transacción. El post-audit confirmó `8 active / 1 revoked`, cero columnas
  legacy y ausencia del ledger nuevo.
- La corrección local reemplaza ese constraint por una regla compatible con
  estados no revocados y conserva los campos de revocación fail-closed.
- Segundo intento de 036, 037, postchecks y UAT: detenidos hasta autorización
  explícita de retry.

No se aplicó ninguna migración desde este documento. No autoriza cambios en
PROD ni merge.
## Migration 040 review gate

Migration `040_fix_extraordinary_consumption_and_material_invalidation.sql`
is a forward-only correction prepared for review. It is not authorized for
DEV application by the commit that introduces it.

The correction keeps the `BEFORE INSERT` readiness validation and row lock.
The `AFTER INSERT` consumer no longer calls the general readiness helper after
the new line already exists. Instead, an internal read-only predicate permits
exactly the current layout line and rejects every other line, receipt, receipt
link, allocation item, allocation movement or allocation reservation. The
consumer updates exactly one active secure authorization, records the layout
and line lineage, and appends `authorization_consumed` in the same transaction.
An event failure therefore rolls back both the line and the state transition.

The validator also closes the lock-wait race: if a concurrent transaction
consumes or closes the authorization while another insert waits, the second
insert rechecks for any secure authorization and fails instead of falling
through to the regular path.

Material invalidation now uses:

```sql
after update on public.payment_requests
for each row
when (
  old.approval_material_updated_at
  is distinct from
  new.approval_material_updated_at
)
```

This catches timestamp changes made by the existing `BEFORE UPDATE` material
trigger even when `approval_material_updated_at` was not named in the original
`SET`. Operational-only updates that leave the timestamp unchanged do not
invalidate an authorization.

Local review requires all of these markers:

- `SHADOW_040_OLD_CONSUMPTION_DEFECT_REPRODUCED`
- `MIGRATION_040_STATIC_POSTCHECK_PASS`
- `SHADOW_040_CONSUMPTION_PASS`
- `SHADOW_040_MATERIAL_INVALIDATION_PASS`
- `SHADOW_040_CONCURRENCY_PASS`
- `SHADOW_040_GUARDS_PASS`

The concurrency contract uses two independent PostgreSQL sessions and requires
exactly one successful insert, one line, one state transition and one
`authorization_consumed` event.

The separate application gate remains: run the read-only 040 DEV precheck,
apply 040 exactly once only after explicit authorization, run the read-only
postcheck, and only then authorize a new mutable MEJ-05 UAT.
