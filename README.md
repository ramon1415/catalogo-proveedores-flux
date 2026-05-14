# Catálogo de Proveedores — template rediseñado

Este paquete reemplaza el template anterior por el nuevo HTML rediseñado.

## Archivos
- `index.html`: login con Google.
- `proveedores.html`: nuevo template visual rediseñado.
- `config.js`: configuración de Supabase.
- `auth.js`: login OAuth Google.
- `app.js`: CRUD dinámico contra `public.proveedores`.

## Configuración
En `config.js`, reemplaza:

```js
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_SUPABASE_PUBLISHABLE_KEY"
```

por la publishable key real de Supabase (`sb_publishable_...`). No uses la `sb_secret_`.

## Cambios incluidos
- Nuevo diseño visual dark/light.
- Toggle de tema.
- Tabla dinámica conectada a Supabase.
- Alta, edición, desactivación y reactivación.
- `tipo_cuenta` ahora es select con opciones válidas: `CLABE` y `Cuenta`.
- Si método de pago es `Efectivo` o `Tarjeta en plataforma`, se deshabilitan campos bancarios.
- Si método de pago es `Transferencia bancaria`, se precarga `CLABE` como tipo de cuenta.
