# Fase 2 - Tipo de solicitud vs metodo de pago

## Objetivo

Cerrar la validacion DEV de Fase 2 separando formalmente dos conceptos que estaban mezclados:

- `request_type`: naturaleza de la solicitud.
- `payment_method`: flujo operativo de pago.

Este PR no ejecuta SQL, no modifica datos reales y no toca produccion. Solo versiona los cambios necesarios para revision humana y ejecucion posterior autorizada en DEV.

## Valores versionados

### Tipo de solicitud

- `provider_payment`: Pago a proveedor.
- `online_purchase`: Compra en linea.
- `reimbursement`: Reembolso.

`online_purchase` se agrega al enum `public.payment_request_type` en la migracion `004c_fase2_payment_method_closure.sql`.

### Metodo de pago

- `transfer`: Transferencia.
- `cash`: Efectivo.
- `check`: Cheque.
- `other`: Otro.

La columna nueva es `public.payment_requests.payment_method` y se mantiene separada de `request_type`.

## Migracion nueva

Archivo:

```text
supabase/migrations/004c_fase2_payment_method_closure.sql
```

La migracion:

- agrega el valor `online_purchase` al enum de tipo de solicitud;
- agrega `payment_method` a `payment_requests` si no existe;
- valida que `payment_method` solo use `transfer`, `cash`, `check` u `other`;
- crea indice para consultas operativas por metodo;
- reemplaza `create_payment_layout` para que el backend incluya solo solicitudes aprobadas con metodo transferencia;
- conserva compatibilidad con datos legacy: si `payment_method` es `null`, las solicitudes legacy `cash`/`check` se tratan como no transferencia y las demas como transferencia.

## Frontend

Archivo principal:

```text
fase2_request_payment_method_extension.js
```

Cambios clave:

- Solicitudes muestra `Tipo de solicitud` y `Metodo de pago` como campos separados.
- La seleccion de proveedor precarga el metodo preferido desde `proveedores.metodo_pago`.
- Crear proveedor rapido desde la solicitud permite continuar sin salir de la pantalla y precarga el metodo preferido.
- Aprobaciones muestra tipo y metodo como badges separados.
- Layouts muestra aviso operativo de que el backend solo incluira transferencias.
- Pagos y comprobaciones carga la extension para complementar filas de efectivo/cheque/otro basadas en `payment_method`.
- El parche redundante `fase2_request_success_patch.js` queda neutralizado por bandera para evitar doble submit.

## Seguridad

- No se usa `service_role` en frontend.
- No se incluyen secrets ni credenciales.
- No se toca `main`.
- No se toca produccion.
- No se toca Supabase PROD.
- No se toca n8n.
- No se ejecuta SQL en este PR.
- No se ejecutan migraciones en este PR.
- No se modifican datos operativos.

## Pendiente antes de prueba final DEV

Despues de mergear este PR a `dev`, aplicar en Supabase DEV la migracion:

```text
supabase/migrations/004c_fase2_payment_method_closure.sql
```

Debe ejecutarse por pipeline autorizado y con autorizacion separada. No ejecutar en PROD.

## Checklist de prueba DEV

Despues de aplicar `004c` en DEV:

1. Proveedor con metodo preferido Transferencia crea solicitud, se aprueba y aparece en layout.
2. Proveedor con metodo preferido Efectivo crea solicitud y no aparece en layout.
3. Proveedor Transferencia con metodo cambiado a Cheque respeta Cheque y no aparece en layout.
4. Compra en linea guarda tipo de solicitud y metodo de pago separados.
5. Reembolso guarda tipo de solicitud y metodo de pago separados.
6. Crear proveedor rapido desde solicitud precarga metodo preferido.
7. Aprobaciones muestra Tipo de solicitud y Metodo de pago separados.
8. Layouts incluye solo transferencias aprobadas.
9. Pagos y comprobaciones muestra el metodo correcto.
10. No hay errores en consola.

## Pendientes separados

No se resuelven en este PR:

- `payment_receipts.notes` no existe en DEV.
- Data quality de `historical_actuals.company_id` nullable.
- Promocion `dev -> main`.
