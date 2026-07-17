# Aplicación DEV — Migration 029 / Provider intake triage

Estado: **PREPARADO, NO EJECUTADO**.

Este paquete corresponde a `supabase/migrations/029_provider_intake_triage.sql`. Su alcance es el contrato interno de triage; no convierte intakes ni crea proveedores, solicitudes de pago o batches.

## Gate

No ejecutar sin autorización explícita posterior al Draft PR y revisión de Preview.

Orden autorizado futuro:

1. `01_PRECHECK_READ_ONLY.sql`
2. `02_BACKUP_DEV.sql`
3. `03_LOAD_029_EXACT.sql`
4. `04_POSTCHECK_READ_ONLY.sql`
5. Conservar `05_ROLLBACK_GUIDANCE.md` para contingencia.

Ejecutar cada archivo de forma consciente en Supabase DEV `scsirgbuqjcwoaxfacth`. No usar `db push` ni `migration repair`.

El LOAD debe permanecer byte-identical a la migration. SHA-256 esperado para ambos archivos:

`31475745645667e2ffe54f7f763690c17212ec2e6c4c0da0bcf1a861af85552b`

La aplicación de `029` no configura Vercel. La variable `FLUX_SUPABASE_SERVICE_ROLE_KEY` debe existir únicamente en el runtime server-side Preview/Development.
