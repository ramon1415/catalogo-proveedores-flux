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

La migration corregida es `029_provider_intake_triage.sql`. No modifica
migrations históricas. Agrega cuatro RPCs públicas para `authenticated`, tres
helpers internos sin grant al cliente, el tipo de evento `internal_note` y dos
índices. Migration y LOAD exacto comparten el SHA-256 vigente
`57ab35263fa0a6dfa53aeef1fc1b1fa76fcede2f5d0413e05cea1642f42438eb`.

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

El índice único por `payment_intake_id + action_id` evita eventos duplicados.
Migration 030 agrega idempotencia material: cada transición y nota nueva guarda
una huella SHA-256 server-side del actor, operación, intake, estado/timestamp
esperado, destino y nota normalizada. Un replay exacto es idempotente; reutilizar
el mismo `action_id` con actor, operación o material distinto falla cerrado. Los
eventos legacy sin huella tampoco se presumen equivalentes y nunca se
reescriben.

## RLS y grants

Las políticas creadas en migration 025 continúan vigentes:

- `payment_intake_select_finance_company`;
- `payment_intake_files_select_finance_company`;
- `payment_intake_events_select_finance_company`.

`anon` no tiene grants sobre tablas ni RPCs. Los RPCs de triage vuelven a
validar perfil, rol y empresa dentro de funciones `SECURITY DEFINER`. Los
helpers de autorización `provider_intake_actor_context` y
`provider_intake_assert_company_access` también son `SECURITY DEFINER`. En
cambio, `provider_intake_mask_value` es una función pura `SQL`, `IMMUTABLE` y
`SECURITY INVOKER`: transforma únicamente su argumento y no necesita privilegios
del propietario. Esta separación evita elevar innecesariamente una
transformación de texto.

Las siete funciones fijan `search_path = public, pg_temp`. Los tres helpers
internos carecen de ejecución directa para `PUBLIC`, `anon`, `authenticated` y
`service_role`; los cuatro RPCs públicos conceden ejecución solo a
`authenticated`.

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
- matriz de seis funciones `SECURITY DEFINER` y un helper puro
  `SECURITY INVOKER`;
- `search_path` fijo en las siete funciones y grants cerrados a `PUBLIC`;
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

Punto de reanudación actual: el run `29600671386` confirmó baseline y creó las
tres copias de backup, pero el LOAD falló dentro de su transacción antes de
`COMMIT`. La causa fue una asignación PL/pgSQL que combinaba un `%rowtype` y un
escalar en el mismo `INTO`; el código versionado mantiene ambos targets
separados. El dry-run `29602695086` reutilizó y endureció los backups, pero su
guard final agrupó las siete funciones y exigió `SECURITY DEFINER`
indiscriminadamente. La nueva ejecución comprueba explícitamente el rollback de
esa transacción antes de continuar. El guard corregido exige seis funciones
privilegiadas `SECURITY DEFINER` y una función pura de máscara `SECURITY
INVOKER`, sin reducir ninguna validación de grants o `search_path`.

Backups que deben conservarse hasta un cleanup posterior a Gate 2:

| Copia | Filas esperadas |
| --- | ---: |
| `_backup_029_payment_intake` | 13 |
| `_backup_029_payment_intake_files` | 6 |
| `_backup_029_payment_intake_events` | 20 |

La reanudación autorizada:

1. Confirma que DEV sigue en baseline compatible y que no quedó ningún objeto
   parcial de `029`.
2. Confirma que las tres copias existen, conservan `13 / 6 / 20` filas y son
   idénticas fila por fila a las tablas activas.
3. Ejecuta `02_BACKUP_DEV.sql` por su ruta de reanudación: no crea copias,
   revoca privilegios de aplicación, habilita RLS y exige cero policies.
4. Genera solo en el runner una copia del LOAD cuyo `COMMIT` final se sustituye
   por `ROLLBACK`.
5. Ejecuta el dry-run con `ON_ERROR_STOP=1` y comprueba otra vez que no quedaron
   funciones, índices o cambios de constraint. Esa comprobación se ejecuta
   siempre, incluso cuando el dry-run falla.
6. Aplica exactamente `03_LOAD_029_EXACT.sql` una sola vez.
7. Ejecuta `04_POSTCHECK_READ_ONLY.sql` y confirma funciones, firmas, grants,
   RLS, backups y conteos.
8. Re-despliega Preview y ejecuta UAT de solo lectura por rol y empresa.

`FLUX_SUPABASE_SERVICE_ROLE_KEY` ya está configurada solo en
Preview/Development y no debe copiarse a Production.

No usar `db push` ni `migration repair` para este paquete.

## Migration 030 y principales QA

`030_provider_intake_action_fingerprint.sql` reemplaza únicamente
`transition_provider_intake` y `add_provider_intake_note`, conserva sus firmas,
retornos, grants, `SECURITY DEFINER`, `search_path`, reglas de empresa,
allowlist, comentarios y concurrencia optimista, y agrega un helper interno sin
grants de aplicación. La migration y
`ops/provider-intake/apply-030-action-fingerprint/03_LOAD_030_EXACT.sql` son
byte-identical.

Gate 2 usa dos principales de auditoría permanentes solo en DEV:
`QA_TRIAGE_FINANCE_1` y `QA_TRIAGE_FINANCE_2`. Al terminar conservan usuario
Auth bloqueado y perfil inactivo para sostener las referencias del ledger, pero
quedan sin sesiones, roles, memberships ni acceso efectivo. El ciclo operativo
está en `provider-intake-triage-qa-audit-principals.md`.

## Rollback

La migration es aditiva salvo la ampliación controlada del constraint de `event_type`. El rollback requiere ventana de mantenimiento y revisión previa de eventos `internal_note`. Consultar `05_ROLLBACK_GUIDANCE.md`; no ejecutar un rollback destructivo automático.

La UI puede retirarse revirtiendo sus archivos y la entrada de navegación. La función server-side puede deshabilitarse retirando la variable de servicio DEV o revirtiendo el endpoint. Las filas de auditoría nunca deben borrarse.

## Riesgos y mitigaciones

- **Migration aún no aplicada:** el Preview puede validar layout y 403, pero las operaciones de datos devolverán RPC ausente hasta completar la reanudación.
- **Backups de incidente:** son copias de una sola ejecución; un conjunto parcial
  detiene el rollout. No se eliminan, recrean ni restauran automáticamente.
- **Variable server-side faltante:** documentos muestran un error sanitizado y no degradan a URL pública.
- **Modelo global de `admin`:** se conserva el comportamiento vigente de `flux_sysadmin_roles()`. Cambiarlo requiere una decisión transversal separada.
- **Búsqueda parcial a gran escala:** usa paginación server-side; si el volumen crece significativamente, evaluar índices trigram en una fase posterior.
- **Eventos internos en estados terminales:** una nota no cambia estado ni payload. Si Operaciones decide prohibirla en terminales, puede endurecerse antes de aplicar `029`.

## Fase 2 pendiente

Fase 2 deberá definir matching, validación de datos bancarios, creación transaccional de proveedor/payment request, presupuesto, aprobadores y conversión. Nada de ese flujo está implementado o iniciado aquí.
