# Fase 0A - Configuracion dev/prod

## Diagnostico actual

| Archivo | Uso de config Supabase | Riesgo | Recomendacion |
|---|---|---|---|
| `config.js` | Define `SUPABASE_URL` y `SUPABASE_ANON_KEY`; `FluxAuth` tambien crea cliente Supabase desde esas constantes. | Dev, previews y prod pueden quedar conectados a la misma base si el valor queda fijo en el repo. | Centralizar fallback dev y permitir configuracion runtime por ambiente desde Vercel. |
| `auth.js` | Usa `window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`. | Depende de que `config.js` cargue primero. | Mantener el contrato global actual. |
| Modulos principales JS | `app.js`, `solicitudes.js`, `layouts.js`, `efectivo.js`, `ingresos.js`, `dashboard.js`, `configuracion.js`, `socios.js`, `aprobaciones.js` y extensiones usan las mismas constantes globales. | Si se cambia el nombre de las constantes se rompe la app. | No tocar modulos; resolver todo desde `config.js`. |
| HTML principales | Cargan Supabase CDN y luego `config.js` antes del modulo de pantalla. | No existe build step para inyectar variables. | Usar configuracion runtime publica. |
| Service key | No se encontro service role key en frontend. | Critico si apareciera. | Mantener service role fuera del navegador y fuera del repo. |

## Opciones evaluadas

| Opcion | Descripcion | Ventaja | Riesgo |
|---|---|---|---|
| A. Config hardcodeado por rama | `dev` tendria valores dev y `main` valores prod. | Simple. | Riesgo alto: un merge puede llevar config dev a prod. |
| B. `runtime-config.js` generado por Vercel | Un endpoint de Vercel devuelve JavaScript con config publica del ambiente. | Funciona con HTML estatico sin bundler y mantiene fallback local. | Agrega una pequena funcion serverless publica. |
| C. `/api/config` JSON | Frontend pide config via fetch. | Robusto para apps modernas. | Rompe el flujo actual porque los scripts esperan config sincronica. |
| D. `window.FLUX_ENV_CONFIG` inyectado | Un script define config antes de `config.js`. | Compatible con el contrato actual. | Requiere garantizar orden de carga. |

## Recomendacion

Usar una combinacion B + D:

- Vercel sirve `api/runtime-config.js`.
- Ese endpoint lee variables de ambiente publicas.
- El script define `window.FLUX_ENV_CONFIG`.
- `config.js` lo carga de forma sincronica mientras el documento se esta parseando.
- Si no existe el endpoint o faltan variables, se usa el fallback dev actual.

Esto evita hardcodear valores prod en el repositorio y mantiene compatibilidad con todos los modulos actuales.

## Variables de Vercel

| Variable | Ambiente | Descripcion | Se expone al navegador |
|---|---|---|---|
| `FLUX_SUPABASE_URL` | Preview/dev/prod | URL publica del proyecto Supabase correspondiente. | Si |
| `FLUX_SUPABASE_ANON_KEY` | Preview/dev/prod | Anon key publica del proyecto Supabase correspondiente. | Si |
| `FLUX_ENV` | Preview/dev/prod | Nombre logico del ambiente: `dev`, `preview` o `prod`. | Si |

La anon key de Supabase puede vivir en frontend. La service role key nunca debe exponerse en frontend, Vercel client-side, HTML ni repositorio.

## Configuracion sugerida por ambiente

| Vercel scope | `FLUX_ENV` | Supabase |
|---|---|---|
| Preview / ramas feature | `dev` o `preview` | Supabase actual dev |
| Branch `dev` | `dev` | Supabase actual dev |
| Branch `main` / Production | `prod` | Supabase prod limpio |

## Pasos para crear Supabase prod limpio

| Paso | Responsable | Riesgo | Validacion |
|---|---|---|---|
| Crear nuevo proyecto Supabase prod. | Admin Supabase | Usar accidentalmente la base dev. | Confirmar URL distinta a dev. |
| Aplicar esquema/migraciones limpias. | Tech lead | Faltantes de tablas, RPCs o RLS. | Ejecutar smoke tests por modulo. |
| Cargar seed minimo: roles, admin inicial, empresas, centros, partidas y cuentas origen. | Admin/finanzas | Produccion inutilizable sin catalogos. | Login admin y creacion de solicitud demo. |
| Configurar Vercel `main` con variables prod. | Admin Vercel | Main apuntando a dev. | Revisar consola: `env=prod`, host Supabase prod. |
| Configurar Vercel `dev` y previews con variables dev. | Admin Vercel | Previews usando prod por error. | Revisar consola: `env=dev`, host Supabase dev. |
| Validar login y modulos principales. | QA/operacion | Permisos o RLS incompletos. | Proveedores, solicitudes, layouts, efectivo, ingresos y dashboard cargan. |
| Bloquear salida a prod hasta seed completo. | Direccion/tech lead | Demo prod con datos incompletos. | Checklist de smoke test aprobado. |

## Estrategia prod -> dev

- Nunca espejar dev hacia prod.
- Solo espejar prod hacia dev.
- Empezar con espejeo manual y luego evaluar frecuencia semanal o quincenal.
- Sanitizar datos sensibles si aplica.
- No copiar credenciales, tokens, llaves, secrets ni configuracion de OAuth.
- Copiar catalogos, estructura y datos operativos permitidos para pruebas.
- Documentar fecha, responsable y alcance de cada refresh.

## Validaciones esperadas en preview

- Login carga.
- `FluxAuth.ready()` resuelve.
- Menu se renderiza sin parpadeo anormal.
- Dashboard, solicitudes, proveedores, layouts, efectivo, ingresos y configuracion cargan.
- No hay errores de inicializacion Supabase.
- No se imprimen keys completas en consola.
- La consola solo muestra ambiente, fuente, host Supabase y si usa fallback.
