# Bloqueo BATCH-012 / BATCH-013 en DEV

Fecha: 13 de julio de 2026 (America/Mexico_City)

## Registros controlados

- Efectivo: `SOL-2026-0073`, MXN 12.12.
- Cheque: `SOL-2026-0074`, MXN 13.13.
- Corte: `QA-CIERRE-BATCH-012-013-20260713`, total MXN 25.25.

Ambas solicitudes se crearon mediante la UI vigente, quedaron con presupuesto
disponible, se agregaron al corte y el corte se envió a Dirección. No se creó
ningún `cash_fund`, no se registró entrega y no se generó una comprobación.

## Causa confirmada

El formulario actual separa la naturaleza de la solicitud del método de pago:

- `request_type = provider_payment`;
- `payment_method = cash` o `check`.

La lógica de cortes de migration 023 ya usa `payment_method` con fallback al
campo legado. Sin embargo, `public.create_cash_fund`, definido en
`supabase/migrations/00305_cash_rpcs.sql`, todavía rechaza cualquier solicitud
cuyo `request_type` no sea `cash` o `check` y devuelve
`payment_request_must_be_cash_or_check`.

La UI de detalle también conservaba dos lecturas del campo legado. El PR #252
las alinea con `payment_method` y deja una sola implementación del panel de
fondo. Esto no modifica datos ni relaja el gate del servidor.

## Impacto

BATCH-012 y BATCH-013 no pueden clasificarse PASS todavía. El camino positivo
no es ejecutable con registros creados por la UI vigente hasta que el RPC acepte
el modelo canónico de `payment_method`. La decisión de Dirección también
requiere una sesión DEV del perfil asignado `Ramón`; la sesión disponible de
`Ramón Hipo` solo mostró la vista de Finanzas.

## Propuesta para migration 026 o siguiente número libre

Después de que el portal reserve o integre migration 025:

1. Reemplazar en `create_cash_fund` el gate basado solo en `request_type`.
2. Resolver el método efectivo con:
   `coalesce(nullif(payment_method, ''), request_type::text)`.
3. Aceptar únicamente `cash` y `check`.
4. Conservar los gates existentes de solicitud aprobada, actor autorizado,
   responsable, fecha, método de entrega e idempotencia por solicitud.
5. Retestar antes y después de liberar el corte y repetir la creación para
   confirmar `cash_fund_already_exists` sin duplicados.

Este diagnóstico no crea migration 025 ni 026, no ejecuta `db push` y no
modifica las migrations históricas 021–024.
