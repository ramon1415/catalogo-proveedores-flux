# Módulo de Solicitudes de Pago

Este módulo agrega la pantalla **Solicitudes de pago** al sistema Flux / Sistema Operadora.

La pantalla permite crear solicitudes de pago desde el frontend usando la función RPC `create_payment_request`, la cual valida automáticamente la disponibilidad presupuestal contra el motor ya configurado en Supabase.

---

## Archivos incluidos

Subir estos archivos al repositorio conectado a Vercel:

```text
solicitudes.html
solicitudes.js
```

---

## URL esperada

Después del deploy en Vercel, la pantalla debe abrir en:

```text
/solicitudes.html
```

Ejemplo:

```text
https://TU-PROYECTO.vercel.app/solicitudes.html
```

---

## Objetivo del módulo

Crear una experiencia visual y operativa para registrar solicitudes de pago con validación automática de presupuesto.

Flujo actual:

```text
Usuario crea solicitud
↓
Sistema valida presupuesto automáticamente
↓
Si hay disponible: budget_decision = aprobable
↓
Si no hay disponible / hay sobregiro / ajuste extraordinario: budget_decision = bloqueado
↓
La solicitud queda registrada en payment_requests
```

En esta fase **no hay validación inicial humana**. La validación inicial la hace el sistema contra presupuesto.

---

## Backend utilizado

El módulo utiliza la función RPC:

```text
create_payment_request(...)
```

Parámetros esperados:

```text
p_proveedor_id
p_company_id
p_cost_center_id
p_budget_category_id
p_budget_month
p_amount_requested
p_currency
p_exchange_rate
p_description
p_notes
p_requested_by
p_is_extraordinary_adjustment
```

---

## Tablas consultadas

El frontend consulta principalmente:

```text
payment_requests
proveedores
companies
cost_centers
budget_categories
company_cost_center_budget_categories
profiles
```

También puede consultar:

```text
budget_availability
budget_exceptions
```

---

## Importante sobre proveedores

La tabla operativa real de proveedores es:

```text
proveedores
```

No usar `providers` como fuente principal, ya que actualmente está vacía.

En solicitudes se usa:

```text
proveedor_id
```

No se debe usar `provider_id` como obligatorio.

---

## Funcionalidad incluida

La pantalla incluye:

- Listado de solicitudes existentes.
- Cards resumen.
- Búsqueda.
- Filtros básicos.
- Tabla con scroll y encabezado sticky.
- Botón `+ Nueva solicitud`.
- Modal / drawer para crear solicitud.
- Select de empresa.
- Select de centro de costo.
- Select de partida presupuestal.
- Select de proveedor activo.
- Mes presupuestal.
- Monto solicitado.
- Moneda.
- Tipo de cambio.
- Toggle de ajuste extraordinario.
- Descripción.
- Notas.
- Creación vía RPC `create_payment_request`.
- Toast de éxito/error.
- Badges visuales para:
  - `submitted`
  - `aprobable`
  - `bloqueado`
  - ajuste extraordinario
- Detalle de solicitud.
- Resultado presupuestal:
  - disponible antes
  - disponible después
  - faltante
  - motivo de bloqueo
  - JSON presupuestal colapsable

---

## No incluido en esta fase

Esta fase no incluye:

- Aprobaciones humanas.
- Validación inicial por Alfredo.
- Aprobación por Felipe.
- Adjuntos.
- Layout BBVA.
- Comprobaciones de efectivo.
- Cheques.
- Recurrentes.
- Incidencias / visitas.
- Cierre mensual.
- Notificaciones n8n.
- Cambios al backend.
- Cambios al enum de status.

---

## Cambio requerido en sidebar

Agregar este link en el menú lateral de `proveedores.html` y, si aplica, también en `presupuesto.html`:

```html
<a href="./solicitudes.html" class="nav-link muted"><span>S</span> Solicitudes de pago</a>
```

En `solicitudes.html` el link debe quedar activo.

---

## Cómo subir a GitHub

1. Entrar al repositorio del proyecto.
2. Subir:
   - `solicitudes.html`
   - `solicitudes.js`
3. Editar `proveedores.html` para agregar el link del sidebar.
4. Si `presupuesto.html` tiene sidebar independiente, agregar también el link ahí.
5. Hacer commit:

```text
Agregar módulo de solicitudes de pago
```

6. Esperar deploy automático en Vercel.

---

## Cómo probar manualmente

1. Abrir:

```text
/solicitudes.html
```

2. Confirmar que carga la pantalla.
3. Confirmar que aparecen los catálogos:
   - empresas
   - centros de costo
   - partidas
   - proveedores
4. Clic en `+ Nueva solicitud`.
5. Seleccionar:
   - Empresa: Operadora Tlacatecpan
   - Centro de costo: Rancho San Juan Tlacatecpan
   - Partida con presupuesto disponible
   - Proveedor activo
   - Mes con presupuesto cargado
   - Monto pequeño
6. Guardar.
7. Confirmar que aparece toast de éxito.
8. Confirmar que se genera folio.
9. Confirmar que la solicitud aparece en la tabla.
10. Crear otra solicitud con monto alto para validar bloqueo presupuestal.
11. Confirmar que aparece como `bloqueado`.
12. Abrir detalle y revisar resultado presupuestal.

---

## Validación esperada

### Solicitud aprobable

Debe quedar:

```text
status = submitted
budget_decision = aprobable
budget_block_reason = null
```

### Solicitud bloqueada

Debe quedar:

```text
status = submitted
budget_decision = bloqueado
budget_block_reason = sin_disponible / ajuste_extraordinario / motivo correspondiente
```

---

## Posibles errores por RLS

Si la pantalla abre pero no carga datos, puede faltar alguna policy RLS para usuarios autenticados.

Tablas que podrían requerir lectura:

```text
payment_requests
proveedores
companies
cost_centers
budget_categories
company_cost_center_budget_categories
profiles
```

También validar permiso de ejecución para:

```text
create_payment_request
```

No agregar policies sin revisar primero el error exacto.

---

## Notas de seguridad

- No usar `SUPABASE_SERVICE_ROLE_KEY` en frontend.
- No poner service role en `config.js`.
- Solo usar la key pública / anon / publishable desde `config.js`.
- La creación de solicitudes debe hacerse vía RPC `create_payment_request`.
- No insertar directo en `payment_requests` desde frontend.

---

## Estado del proyecto relacionado

Antes de este módulo ya quedaron listas estas fases:

```text
Fase 1: Presupuesto maestro real cargado y activo
Fase 2: Motor de disponibilidad funcionando
Tanda 6A: payment_requests preparado
Tanda 6B: create_payment_request creada y validada
```

Este módulo corresponde al inicio frontend de:

```text
Fase 3: Solicitudes de pago
```

---

## Siguiente fase sugerida

Después de validar esta pantalla, los siguientes pasos son:

1. Bandeja de excepciones presupuestales.
2. Flujo de revisión/aprobación operativa.
3. Adjuntos por solicitud.
4. Selección de cuenta origen.
5. Generación de layout BBVA.
6. Comprobación / confirmación de pago.
