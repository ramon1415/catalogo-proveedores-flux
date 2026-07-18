# Aplicación controlada de Migration 031 en DEV

Este paquete prepara el matching explícito entre `payment_intake` y
`public.proveedores`. La migration no crea proveedores, no actualiza el catálogo,
no crea `payment_requests` y no convierte intakes.

## Alcance

- Entorno único autorizado: Supabase DEV `scsirgbuqjcwoaxfacth`.
- Migration: `supabase/migrations/031_provider_intake_matching.sql`.
- LOAD byte-identical: `03_LOAD_031_EXACT.sql`.
- SHA-256: `c988bedccef3e1013d1eae768d90e152b64a9e6245bf826a1aa8116c5866a2b0`.
- No usar `db push`, `migration repair`, fragmentos manuales ni SQL editado.
- No ejecutar este paquete hasta recibir autorización explícita para Gate 1.

## Orden futuro autorizado por Gate 1

1. Ejecutar `01_PRECHECK_READ_ONLY.sql`.
2. Capturar `02_BACKUP_DEV.sql` en un artefacto privado.
3. Verificar que migration y LOAD sean byte-identical y coincidan con el SHA-256.
4. Hacer un dry-run efímero sustituyendo únicamente el `COMMIT` final por
   `ROLLBACK`; no versionar esa copia.
5. Ejecutar el LOAD exacto una sola vez con `ON_ERROR_STOP=1`.
6. Ejecutar `04_POSTCHECK_READ_ONLY.sql`.
7. Conservar evidencia sanitizada y detenerse ante cualquier diferencia.

## Contrato

- Búsqueda server-side con máximo 25 candidatos.
- Exactitud y prefijos controlados; no `pg_trgm`, IA ni terceros.
- Cuenta y CLABE siempre enmascaradas en respuestas.
- Set, replace y clear solo con `status = in_review`.
- Concurrencia optimista por estado, `updated_at` y match actual.
- Idempotencia material contract-v3 por actor, operación y payload.
- Un evento append-only `provider_matched` por operación nueva.
- Sin cambios automáticos de estado.

Consultar `docs/ops/provider-intake-matching-2a.md` antes de cualquier rollout.
