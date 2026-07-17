# Aplicación DEV — Migration 029 / Provider intake triage

Estado: **REANUDACIÓN AUTORIZADA CON MÍNIMO PRIVILEGIO, MIGRATION AÚN NO APLICADA**.

Este paquete corresponde a `supabase/migrations/029_provider_intake_triage.sql`. Su alcance es el contrato interno de triage; no convierte intakes ni crea proveedores, solicitudes de pago o batches.

## Gate

No ejecutar sin autorización explícita posterior al Draft PR y revisión de Preview.

El run `29600671386` creó y confirmó las tres copias de backup, pero el LOAD
histórico falló dentro de su transacción antes de `COMMIT`. El dry-run
`29602695086` confirmó nuevamente los backups y se detuvo dentro de su
transacción porque el guard exigía `SECURITY DEFINER` a una transformación de
texto pura. La nueva ejecución verifica explícitamente que ese rollback quedó
completo. La reanudación no recrea, elimina, renombra ni trunca esas copias.

Orden autorizado de reanudación:

1. `01_PRECHECK_READ_ONLY.sql`
2. `02_BACKUP_DEV.sql` por su ruta de reconciliación.
3. Dry-run temporal derivado de `03_LOAD_029_EXACT.sql`, sustituyendo únicamente
   el `COMMIT` final por `ROLLBACK`.
4. Repetir `01_PRECHECK_READ_ONLY.sql` para confirmar rollback completo.
5. `03_LOAD_029_EXACT.sql` una sola vez.
6. `04_POSTCHECK_READ_ONLY.sql`.
7. Conservar `05_ROLLBACK_GUIDANCE.md` para contingencia.

Ejecutar cada archivo de forma consciente en Supabase DEV `scsirgbuqjcwoaxfacth`. No usar `db push` ni `migration repair`.

El LOAD debe permanecer byte-identical a la migration. SHA-256 esperado para ambos archivos:

`57ab35263fa0a6dfa53aeef1fc1b1fa76fcede2f5d0413e05cea1642f42438eb`

Los SHA históricos
`31475745645667e2ffe54f7f763690c17212ec2e6c4c0da0bcf1a861af85552b` y
`bfd5deaaa349a36e7a8681943559aa41938aad6393b28acd54162843f2b65067`
corresponden a ejecuciones fallidas y no son valores autorizados vigentes.

## Matriz de privilegios

| Funciones | Modo | Ejecución directa |
| --- | --- | --- |
| Cuatro RPCs públicos | `SECURITY DEFINER` | Solo `authenticated` |
| `provider_intake_actor_context`, `provider_intake_assert_company_access` | `SECURITY DEFINER` | Solo propietario |
| `provider_intake_mask_value` | `SECURITY INVOKER`, `SQL`, `IMMUTABLE` | Solo propietario |

Las siete funciones fijan `search_path = public, pg_temp`. El helper de máscara
no consulta tablas ni necesita privilegios del propietario, por lo que
mantenerlo como invoker evita elevar una transformación de texto innecesariamente.
Los tres helpers internos están cerrados a `PUBLIC`, `anon`, `authenticated` y
`service_role`.

## Backups de una sola ejecución

Se conservan hasta un cleanup posterior a Gate 2:

- `public._backup_029_payment_intake`: 13 filas;
- `public._backup_029_payment_intake_files`: 6 filas;
- `public._backup_029_payment_intake_events`: 20 filas.

`02_BACKUP_DEV.sql` admite exactamente tres estados:

- ninguna copia: crea las tres atómicamente;
- tres copias: las reutiliza, reconcilia y protege;
- una o dos copias: detiene la ejecución.

Las copias quedan con RLS habilitado, cero policies y sin privilegios para
`PUBLIC`, `anon`, `authenticated` o `service_role`. Solo el propietario conserva
acceso operativo.

La aplicación de `029` no configura Vercel. La variable `FLUX_SUPABASE_SERVICE_ROLE_KEY` debe existir únicamente en el runtime server-side Preview/Development.
