# Transfer receipt sysadmin permission follow-up

Seguimiento de PR #131 para el flujo visible de comprobante de transferencia en `pagos_comprobaciones.html`.

## Contexto

PR #131 ya estaba mergeado a `dev` con merge commit `9454d21bf5777055e64fe32ad5c977dde4427dfb`.

Validacion manual reportada en DEV:

- Usuario: `ramon@quantta.mx`
- Rol esperado: `sysadmin`
- Folios observados: `SOL-2026-0049` y `SOL-2026-0046`

## Causa raiz identificada

El guardado del comprobante usa Supabase directo sobre `public.payment_receipts` desde `pagos_comprobaciones_cash_ux.js`:

- `insert` cuando no existe recibo previo.
- `update` cuando ya existe recibo.
- La tabla base es `payment_receipts`.
- `localStorage` solo se usa como respaldo visual para notas/estado temporal.
- No usa RPC para este guardado.

En el ledger, `public.payment_receipts` tenia RLS activo desde `004_rls_policies_grants.sql`, pero no habia policy especifica de lectura/escritura para esa tabla. Con RLS activo y sin policy de escritura, usuarios autenticados pueden quedar bloqueados aunque tengan rol operativo.

## Cambio incluido

- `supabase/migrations/00402_payment_receipts_policies.sql`
  - Mantiene RLS activo.
  - Permite lectura a usuarios autenticados con `flux_member_roles()`.
  - Permite insert/update/delete a usuarios autenticados con `flux_approver_roles()`.
  - `flux_approver_roles()` incluye roles sysadmin, sistema/admin, finanzas/tesoreria/administracion y direccion/director por medio de los helpers ya versionados.
  - No abre acceso anonimo por policy.

- `pagos_comprobaciones_receipt_fix.js`
  - Muestra errores del guardado dentro del modal cuando el modal esta abierto.
  - Normaliza errores de permisos a: `No tienes permisos para registrar este comprobante. Contacta a un administrador.`
  - Limpia el feedback al reintentar o editar campos.

- `pagos_comprobaciones_receipt_fix.css`
  - Fuerza tema oscuro Flux en inputs del modal.
  - Cubre focus y autofill de navegador.
  - Agrega estilos para el feedback visible dentro del modal.

## Fuera de alcance

- No resuelve Storage real.
- No resuelve `payment_receipts.notes`.
- No toca `historical_actuals`.
- No ejecuta SQL.
- No ejecuta migraciones.
- No toca Supabase DEV real ni Supabase PROD.
- No toca n8n.
- No toca `main`.
- No cambia variables ni secrets.

## Validacion pendiente

Despues de mergear este PR y ejecutar la migracion autorizada en DEV, validar manualmente:

1. Entrar con `ramon@quantta.mx`.
2. Abrir `pagos_comprobaciones.html`.
3. Registrar comprobante en una transferencia confirmada.
4. Confirmar que sysadmin puede guardar.
5. Confirmar que el feedback de error se ve dentro del modal si algo falla.
6. Confirmar que los inputs no se ponen blancos en focus/autofill.
7. Confirmar que la tabla cambia a `Comprobante registrado` o equivalente.
