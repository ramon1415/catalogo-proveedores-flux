# Fase 2A — Matching controlado de intakes con proveedores maestros

## Objetivo y límites

Fase 2A permite que Finanzas afirme de forma explícita y auditada que un
`payment_intake` corresponde a una fila existente de `public.proveedores`.
Conserva separados el dato declarado en el portal y el dato maestro.

Esta fase no crea ni actualiza proveedores, no crea `payment_requests`, no
convierte intakes, no asigna aprobadores y no toca batches, layouts,
notificaciones, n8n, cron, webhooks, efectivo o cheque.

El flujo queda:

```text
intake en revisión
→ candidatos explicables
→ comparación campo a campo
→ confirmación explícita
→ matched_proveedor_id
→ evento append-only
→ preparado para Fase 2B
```

## Arquitectura

Migration 031 agrega únicamente contratos; reutiliza la columna
`payment_intake.matched_proveedor_id` creada en Migration 025 y
`provider_matched`, que ya expresa la familia de eventos. La operación concreta
se distingue mediante `metadata.action_kind`.

RPCs públicos para `authenticated`:

- `find_provider_intake_candidates(uuid, text, integer)`;
- `get_provider_intake_match_comparison(uuid, uuid)`;
- `set_provider_intake_match(uuid, text, timestamptz, uuid, uuid, text, text, uuid)`.

Helpers internos sin grant de aplicación:

- `normalize_provider_match_text(text)`;
- `normalize_provider_match_digits(text)`;
- `provider_intake_match_fingerprint(...)`.

Todos los RPCs validan sesión, rol y acceso a la empresa del intake. El
frontend no ejecuta `UPDATE` libre.

## Motor de candidatos

La búsqueda ocurre server-side y devuelve como máximo 25 filas; la UI solicita
12. No descarga el catálogo completo. Solo considera señales deterministas:

| Señal | Peso |
|---|---:|
| RFC exacto normalizado | 70 |
| CLABE exacta normalizada | 45 |
| Cuenta exacta; banco compatible cuando existe | 30 |
| Razón social exacta | 25 |
| Prefijo controlado de razón social | 12 |
| Alias exacto | 15 |
| Prefijo controlado de alias | 8 |
| Correo exacto | 5 |
| Teléfono exacto normalizado | 5 |

El score se limita a 100:

- `high`: 70–100;
- `medium`: 40–69;
- `low`: 0–39.

RFC exacto por sí solo alcanza confianza alta. El score es orientativo y nunca
confirma automáticamente. Cada candidato expone `reasons` y `differences`.

No existe `pg_trgm` en el baseline inspeccionado. Fase 2A no habilita fuzzy
matching, no usa IA y no envía datos a terceros. La búsqueda manual aplica
prefijos controlados sobre razón social, alias y RFC.

Migration 020 mantiene índices únicos normalizados para alias, RFC y CLABE. El
motor conserva detección defensiva de RFC duplicado y muestra advertencia si el
conteo supera uno.

## Proveedores inactivos

Un proveedor inactivo no es seleccionable. Solo puede aparecer como advertencia
cuando existe una coincidencia crítica exacta por RFC, CLABE o cuenta. Un
vínculo histórico con un proveedor que después se desactiva permanece visible
en modo solo lectura.

## Respuestas y comparación sanitizadas

La lista devuelve alias, razón social, RFC, método preferido, banco, estado,
score, razones, diferencias y únicamente últimos cuatro dígitos de cuenta o
CLABE.

No devuelve:

- cuenta o CLABE completas;
- rutas de documentos o Storage;
- payload completo;
- tokens o secretos;
- URLs firmadas;
- datos de otro intake.

El comparador muestra Razón social, RFC, Banco, Cuenta, CLABE, Beneficiario,
Correo y Teléfono. Cada fila incluye texto `Coincide`, `Difiere` o
`No informado`; no depende solo de color. La UI crea nodos con `textContent`.

## Permisos y empresa

| Actor | Lectura/matching |
|---|---|
| Finance | Solo empresas con membership activa |
| Admin | Acceso global conforme a helper canónico |
| Sysadmin | Acceso global conforme a helper canónico |
| Requester | Bloqueado |
| Operación | Bloqueado |
| Dirección/aprobador sin Finance | Bloqueado |
| anon | Bloqueado |

`provider_intake_actor_context()` y
`provider_intake_assert_company_access()` continúan siendo la fuente canónica.
No se hardcodean correos ni perfiles.

## Estados

Modificar el match requiere:

- `status = in_review`;
- `created_payment_request_id is null`;
- `expected_status`, `expected_updated_at` y `expected_current_match` vigentes.

`received` debe iniciar revisión. `needs_correction` conserva el vínculo en solo
lectura y debe regresar a `in_review` para cambiarlo. `rejected`, `converted` y
`cancelled` son solo lectura. Vincular no cambia el status.

## Set, replace y clear

- `match_set`: `null → proveedor`;
- `match_replace`: `proveedor A → proveedor B`;
- `match_clear`: `proveedor → null`.

Replace y clear requieren una razón de 10 a 500 caracteres. La razón rechaza
etiquetas, correo, secuencias numéricas extensas y patrones de RFC para evitar
PII en auditoría. Todas las operaciones requieren `reason_code` allowlisted y
confirmación explícita en UI.

## Eventos, idempotencia y concurrencia

Cada operación nueva inserta exactamente un evento `provider_matched`:

```json
{
  "action_id": "<uuid>",
  "action_fingerprint": "<sha256 lowercase>",
  "action_kind": "match_set | match_replace | match_clear",
  "contract_version": 3,
  "previous_match_present": true,
  "new_match_present": true,
  "previous_proveedor_id": "<uuid-or-null>",
  "new_proveedor_id": "<uuid-or-null>",
  "match_confidence": "high | medium | low | none",
  "match_score": 0,
  "reason_code": "<allowlisted>"
}
```

No se guardan RFC, cuenta, CLABE, correo, teléfono, nombres ni payload en
metadata. Los IDs internos permiten reconstruir el historial sin duplicar PII.
El trigger append-only existente impide update o delete del ledger.

La huella contract-v3 incluye actor, operación, intake, estado y timestamp
esperados, match anterior, match nuevo, código y razón. Un replay idéntico
regresa idempotente. Actor, operación o material distinto falla cerrado. La
restricción única de `action_id` maneja carreras.

Dos usuarios pueden intentar confirmar al mismo tiempo. La fila se bloquea y el
`UPDATE` exige estado, `updated_at` y match actual esperados. Solo una operación
gana; la otra recibe:

> Esta solicitud fue actualizada por otro usuario. Recarga el detalle.

## UI y accesibilidad

La sección `Proveedor maestro` vive dentro del detalle de
`provider_intakes.html`. Incluye:

- estado textual;
- búsqueda server-side;
- candidatos con score orientativo;
- señales y diferencias;
- comparación en tabla;
- confirmación auditada;
- change/clear;
- enlace al catálogo en `mode=readonly`;
- historial de matching;
- mensaje no interactivo de Fase 2B.

Los diálogos nativos ofrecen focus trap, Escape y retorno de foco. Se validan
foco visible, teclado, `aria-live`, errores asociados, badges textuales,
responsive, tema claro/oscuro, móvil y zoom 200%.

## QA

Pruebas estáticas cubren:

- contratos y grants;
- búsqueda, score, límite y explicabilidad;
- RFC/CLABE/cuenta/nombre;
- proveedor inactivo;
- comparación enmascarada;
- set/replace/clear;
- reason;
- status y conversión bloqueada;
- concurrencia e idempotencia;
- auditoría sin PII;
- exclusiones de proveedores, requests, batches y notificaciones;
- frontend sin mutación directa.

El harness visual usa fixtures aislados en memoria y no consulta Supabase. Cubre
candidatos, comparación, confirmación, vínculo existente, conflicto, terminal,
Requester denegado, móvil y zoom 200%. Axe debe reportar cero impactos
`critical` o `serious`.

## Rollout

Migration 031 está preparada, no aplicada. El paquete operativo se encuentra en
`ops/provider-intake/apply-031-matching/`.

Gate 1 futuro:

1. autorización explícita;
2. precheck read-only;
3. backup de contratos y conteos;
4. verificación SHA-256 y byte-identidad;
5. dry-run con rollback;
6. LOAD exacto una vez;
7. postcheck read-only;
8. UAT con fixtures/principales autorizados.

No usar `db push` ni `migration repair`.

## Rollback

Antes del `COMMIT`, cualquier error revierte la transacción. Después del
`COMMIT`, solo se permite una migration forward-only. Nunca se borran eventos ni
se reescribe `matched_proveedor_id`. Consultar
`ops/provider-intake/apply-031-matching/05_ROLLBACK_GUIDANCE.md`.

## Riesgos

- Homónimos y abreviaturas requieren juicio humano.
- Datos maestros incompletos reducen score sin bloquear búsqueda manual.
- Proveedores inactivos pueden explicar una coincidencia histórica, pero no
  son seleccionables.
- Los prefijos controlados pueden producir candidatos bajos; nunca se
  autoconfirman.
- Un proveedor global no implica autorización sobre un intake; el acceso se
  decide por la empresa del intake.

## Gaps para Fase 2B

Fase 2B debe solicitar o confirmar antes de convertir:

- empresa;
- requester interno;
- tipo de solicitud;
- método de pago final;
- proveedor maestro;
- centro de costo;
- partida presupuestal;
- monto y moneda;
- fecha solicitada;
- concepto y descripción;
- cuenta origen cuando aplique;
- método preferido como precarga, no decisión;
- selección de aprobador mediante el contrato canónico;
- documentos de soporte.

El intake no garantiza requester interno, centro de costo, partida, tipo de
solicitud ni método final. El método declarado no equivale al aprobado y el
aprobador no se deriva del proveedor. Solo Transferencia podrá ser elegible para
layout bancario; Efectivo, Cheque y Otro permanecerán fuera del layout de
transferencia.

Fase 2B no está iniciada.
