# Fase 1D — Bandeja interna de triage de solicitudes de proveedores

## Objetivo y límites

Esta fase agrega una bandeja autenticada para que Finanzas revise las solicitudes creadas por el portal público. Permite listar, filtrar, abrir detalle, consultar documentos privados, iniciar o retomar revisión, pedir corrección, rechazar y agregar una nota interna.

No crea ni actualiza proveedores. No crea `payment_requests`, `approval_batches`, layouts, links públicos o intakes. No convierte solicitudes y no envía notificaciones. `provider-intake`, `notification-dispatcher`, n8n, cron y webhooks permanecen sin cambios.

Baseline de implementación: `05986aca63f2d98635cbb9b928cd0cebac29315a`, merge de PR #256 a `dev`.

## Roles y alcance por empresa

| Actor | Menú / página | Lista y detalle | Transiciones / notas | Empresas |
| --- | --- | --- | --- | --- |
| Finance y equivalentes (`finance`, `finanzas`, `treasury`, `tesoreria`, `administracion`) | Sí | Sí | Sí | Membresías activas |
| Admin | Sí | Sí | Sí | Global, conforme al helper vigente `flux_sysadmin_roles()` |
| Sysadmin y equivalentes | Sí | Sí | Sí | Global |
| Dirección / aprobadores | No | No | No | Ninguna |
| Solicitantes / operación | No | No | No | Ninguna |
| `anon` / sin sesión | No | No | No | Ninguna |

La UI oculta el módulo durante el primer pintado hasta tener un rol validado. El acceso directo sin sesión redirige al login; un usuario autenticado sin rol recibe un estado 403 interno y no ejecuta RPCs de datos.

## Arquitectura

```text
provider_intakes.html / provider_intakes.js
  ├─ list_provider_intakes()          lista paginada y conteos
  ├─ get_provider_intake_detail()     detalle sanitizado, archivos e historial
  ├─ transition_provider_intake()     transición allowlist + evento
  ├─ add_provider_intake_note()       nota append-only
  └─ POST /api/provider-intake-file-url
       ├─ valida JWT con Supabase Auth
       ├─ valida perfil activo y rol
       ├─ valida empresa o acceso global
       ├─ valida file_id + payment_intake_id
       └─ firma solo ese objeto por 120 segundos
```

La migration preparada es `029_provider_intake_triage.sql`. No modifica migrations históricas. Agrega cuatro RPCs públicas para `authenticated`, tres helpers internos sin grant al cliente, el tipo de evento `internal_note` y dos índices.

## Lista, filtros y paginación

`list_provider_intakes` aplica en servidor:

- empresa;
- uno o varios estados;
- fecha desde / hasta;
- con archivos / sin archivos;
- búsqueda parcial por folio;
- búsqueda parcial por proveedor;
- orden de recepción ascendente o descendente;
- página de 1 a N con límite máximo de 100 filas.

El valor inicial de la UI es `received + in_review`, orden `created_at desc`, página de 25 filas. La lista no devuelve RFC, correo, cuenta, CLABE, token, link ID, UUID de enlace ni ruta Storage.

Los conteos incluyen total, recibidas, en revisión, con corrección requerida, rechazadas, convertidas y canceladas dentro del alcance autorizado y de los filtros no relacionados con estado.

## Detalle y datos sensibles

`get_provider_intake_detail` devuelve:

- identificación, empresa, estado, recepción y actualización;
- proveedor declarado, RFC, correo y teléfono;
- concepto, descripción, importe, moneda y fecha solicitada;
- factura;
- banco y beneficiario;
- cuenta y CLABE siempre enmascaradas con los últimos cuatro caracteres;
- metadatos de archivos sin `storage_path`;
- historial sin metadata interna.

La UI crea nodos y usa `textContent` para todo texto externo. No renderiza HTML del payload, no registra PII en consola y no ofrece acción para revelar cuenta o CLABE completas.

## Documentos y URL firmada

El bucket `intake-uploads` continúa privado y sin política directa para el navegador. La URL no se genera al cargar la lista o el detalle.

Solo una acción explícita llama a `POST /api/provider-intake-file-url`. La función:

1. acepta únicamente `POST` y dos UUID válidos;
2. valida el access token con `/auth/v1/user`;
3. resuelve un perfil activo;
4. exige un rol de Finanzas/Admin/Sysadmin;
5. exige empresa activa y membresía activa salvo acceso global vigente;
6. exige que el archivo pertenezca al intake solicitado y al bucket exacto;
7. firma con `FLUX_SUPABASE_SERVICE_ROLE_KEY` solo en servidor;
8. devuelve una URL de 120 segundos con `Cache-Control: no-store`.

La UI acepta únicamente HTTPS, abre con `noopener,noreferrer` y no persiste la URL en `localStorage` o `sessionStorage`.

Variables server-side requeridas en Vercel DEV:

- `FLUX_SUPABASE_URL`;
- `FLUX_SUPABASE_ANON_KEY`;
- `FLUX_SUPABASE_SERVICE_ROLE_KEY` (solo Preview/Development; nunca expuesta por runtime-config).

## Estados y transiciones

| Desde | Hacia | Comentario | Evento |
| --- | --- | --- | --- |
| `received` | `in_review` | Opcional | `status_changed` |
| `in_review` | `needs_correction` | Obligatorio, 10–2000 | `correction_requested` |
| `in_review` | `rejected` | Obligatorio, 10–2000 | `rejected` |
| `needs_correction` | `in_review` | Opcional | `status_changed` |
| `needs_correction` | `rejected` | Obligatorio, 10–2000 | `rejected` |
| Cualquier estado autorizado | Mismo estado | Nota 3–2000 | `internal_note` |

`rejected`, `converted` y `cancelled` no tienen transición de estado. No existe transición a `converted` en el RPC. La UI no incluye botón Convertir; muestra que la conversión estará disponible en Fase 2.

Los comentarios se recortan, tienen longitud limitada y rechazan caracteres de control o etiquetas HTML.

## Eventos y concurrencia

`payment_intake_events` conserva su trigger append-only. Cada transición exitosa inserta exactamente un evento con:

- actor interno y rol normalizado;
- estado anterior y nuevo;
- nota sanitizada;
- `action_id` UUID y versión de contrato en metadata.

No se guardan payload, datos bancarios, tokens, rutas, archivos o URLs firmadas en metadata.

Cada escritura exige `expected_status` y `expected_updated_at`. Una versión distinta retorna `provider_intake_conflict`; la UI muestra: “Esta solicitud fue actualizada por otro usuario. Recarga el detalle.”

El índice único por `payment_intake_id + action_id` hace idempotentes los reintentos y evita eventos duplicados.

## RLS y grants

Las políticas creadas en migration 025 continúan vigentes:

- `payment_intake_select_finance_company`;
- `payment_intake_files_select_finance_company`;
- `payment_intake_events_select_finance_company`.

`anon` no tiene grants sobre tablas ni RPCs. Los RPCs de triage vuelven a validar perfil, rol y empresa dentro de funciones `SECURITY DEFINER` con `search_path = public, pg_temp`. Los helpers internos no son ejecutables por `anon`, `authenticated` o `service_role`.

## Accesibilidad

La implementación usa:

- enlace “Saltar al contenido”;
- filtros con labels y ayuda asociada;
- caption y headers con `scope` en tabla;
- paginación explícita;
- badges con texto además de color;
- regiones `aria-live`;
- botones nativos con nombres accesibles;
- `<dialog>.showModal()` para focus trap nativo y Escape;
- retorno de foco al disparador;
- foco visible de alto contraste;
- soporte de `prefers-reduced-motion`;
- layouts responsive y lectura a zoom 200%.

El gate visual debe validar lista, filtros, vacío, error 403, detalle, acción y loading con Axe sin hallazgos critical/serious antes de UAT.

## QA automatizado

`scripts/qa/provider-intake-triage-contract.test.mjs` cubre:

- grants y RPCs;
- allowlist de transiciones;
- bloqueo de conversión;
- comentario, concurrencia e idempotencia;
- enmascarado y ausencia de rutas Storage en detalle;
- ausencia de mutaciones prohibidas;
- control de navegación por rol;
- semántica y responsive;
- TTL y aislamiento del secreto server-side;
- archivo autorizado;
- rechazo de requester;
- rechazo de archivo de otro intake.

La suite no se conecta a DEV y no inserta o modifica datos.

## Rollout DEV

Punto de detención actual: migration preparada pero no aplicada.

Cuando exista autorización explícita:

1. Confirmar que DEV sigue en baseline compatible y que `029` no existe.
2. Configurar `FLUX_SUPABASE_SERVICE_ROLE_KEY` solo como variable server-side de Preview/Development.
3. Ejecutar `ops/provider-intake/apply-029-triage/01_PRECHECK_READ_ONLY.sql`.
4. Ejecutar `02_BACKUP_DEV.sql` y verificar sus conteos.
5. Aplicar exactamente `03_LOAD_029_EXACT.sql` en una sola transacción.
6. Ejecutar `04_POSTCHECK_READ_ONLY.sql`.
7. Re-desplegar el Preview si la variable se añadió después del build.
8. Ejecutar UAT por rol y empresa sobre intakes QA existentes, sin convertirlos.

No usar `db push` ni `migration repair` para este paquete.

## Rollback

La migration es aditiva salvo la ampliación controlada del constraint de `event_type`. El rollback requiere ventana de mantenimiento y revisión previa de eventos `internal_note`. Consultar `05_ROLLBACK_GUIDANCE.md`; no ejecutar un rollback destructivo automático.

La UI puede retirarse revirtiendo sus archivos y la entrada de navegación. La función server-side puede deshabilitarse retirando la variable de servicio DEV o revirtiendo el endpoint. Las filas de auditoría nunca deben borrarse.

## Riesgos y mitigaciones

- **Migration aún no aplicada:** el Preview puede validar layout y 403, pero las operaciones de datos devolverán RPC ausente hasta el rollout DEV.
- **Variable server-side faltante:** documentos muestran un error sanitizado y no degradan a URL pública.
- **Modelo global de `admin`:** se conserva el comportamiento vigente de `flux_sysadmin_roles()`. Cambiarlo requiere una decisión transversal separada.
- **Búsqueda parcial a gran escala:** usa paginación server-side; si el volumen crece significativamente, evaluar índices trigram en una fase posterior.
- **Eventos internos en estados terminales:** una nota no cambia estado ni payload. Si Operaciones decide prohibirla en terminales, puede endurecerse antes de aplicar `029`.

## Fase 2 pendiente

Fase 2 deberá definir matching, validación de datos bancarios, creación transaccional de proveedor/payment request, presupuesto, aprobadores y conversión. Nada de ese flujo está implementado o iniciado aquí.
