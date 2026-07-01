# Apply 004b payment_receipts policies in DEV

Paquete operativo para aplicar en Supabase DEV la migracion:

```text
supabase/migrations/004b_payment_receipts_policies.sql
```

Este paquete existe porque el workflow manual autorizado espera un folder con tres fases:

```text
precheck.sql
load.sql
postcheck.sql
```

## Workflow autorizado

Usar solo:

```text
Deploy Supabase DEV Manual
```

Inputs esperados despues de mergear este PR a `dev`:

```text
Branch: dev
script_path: ops/payment-receipts/apply-004b-policies
confirm_dev: scsirgbuqjcwoaxfacth
```

## Alcance

- Solo Supabase DEV.
- Solo policies/grants de `public.payment_receipts` definidos por 004b.
- No toca datos operativos.
- No toca `historical_actuals`.
- No toca `payment_receipts.notes`.
- No modifica frontend.
- No cambia variables ni secrets.
- No debe usarse en PROD sin autorizacion separada.

## Fases

### precheck.sql

Valida antes de aplicar:

- Existe `public.payment_receipts`.
- Existen `current_user_has_role(text[])`, `flux_member_roles()` y `flux_approver_roles()`.
- `flux_approver_roles()` contiene los roles operativos esperados para escritura.
- No existen policies para roles publicos/anonimos sobre `payment_receipts`.
- Informa si RLS ya estaba activo o si `load.sql` lo activara.

### load.sql

Copia de la migracion 004b para aplicar:

- RLS activo sobre `public.payment_receipts`.
- Policy `payment_receipts_select` para lectura autenticada limitada por `flux_member_roles()`.
- Policy `payment_receipts_write_authorized` para escritura autenticada limitada por `flux_approver_roles()`.
- Grants necesarios a `authenticated`, con RLS como control de acceso efectivo.

### postcheck.sql

Valida despues de aplicar:

- RLS queda activo.
- Existen las policies esperadas.
- No hay policies para roles publicos/anonimos.
- No hay policy de escritura fuera de `flux_approver_roles()`.
- `authenticated` tiene grants de tabla requeridos para que RLS pueda evaluar la escritura.

## Pruebas manuales despues de ejecutar en DEV

Validar en:

```text
https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/pagos_comprobaciones.html
```

Con usuario `ramon@quantta.mx`, probar:

- `SOL-2026-0049`
- `SOL-2026-0046`

Flujo esperado:

1. Abrir una transferencia con pago confirmado.
2. Clic en `Registrar comprobante`.
3. Capturar fecha, referencia bancaria, URL/ruta temporal y notas.
4. Guardar.
5. Confirmar mensaje visible de exito.
6. Confirmar tema oscuro correcto en el modal.
7. Confirmar cambio a `Comprobante registrado`.
8. Confirmar que no aparece error de permisos/RLS.
9. Confirmar que `Ver layout` sigue funcionando.
