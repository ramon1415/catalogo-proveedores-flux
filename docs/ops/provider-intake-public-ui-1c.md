# Portal público de proveedores - Fase 1C

## Objetivo y alcance

Esta fase incorpora una página pública, sin autenticación, para que un proveedor entregue datos y documentos a Finanzas. La página es HTML, CSS y JavaScript vanilla; no agrega dependencias, framework, SDK de Supabase, analytics ni almacenamiento local.

El portal solo consume la Edge Function `provider-intake`. No consulta PostgreSQL o Storage desde el navegador y no crea proveedores, `payment_requests`, batches, layouts, aprobaciones ni notificaciones. El backend versionado y desplegado no se modifica en esta fase.

Baseline: `94f8b98fb5579d7c6d163bbff9568572359160ba`.

Árbol confirmado de `supabase/functions/provider-intake`: `379f65801609e40143d948b3de702e391636c512`.

## Arquitectura y flujo

1. El proveedor abre `solicitar.html#token=<TOKEN_OPACO>`.
2. El JavaScript lee el token desde `location.hash`, valida `[A-Za-z0-9_-]{32,256}` y retira inmediatamente el fragmento con `history.replaceState`.
3. El token permanece solo en una variable en memoria y viaja únicamente en `X-Intake-Token`.
4. `GET /link-info` devuelve empresa, límites, MIME permitidos y URL del aviso de privacidad.
5. Solo después de una respuesta válida se habilita el formulario y puede cargarse Turnstile.
6. El usuario captura, adjunta, revisa, acepta los avisos y resuelve CAPTCHA.
7. `POST /submit` envía `multipart/form-data` con `payload`, `captcha_token`, `honeypot`, `file_kinds` y `files`.
8. Una respuesta 201 o un reintento idempotente 200 muestra exclusivamente el folio público.

Las solicitudes usan `credentials: omit`, `cache: no-store` y `referrerPolicy: no-referrer` en `link-info`. La página declara `referrer=no-referrer`, CSP restringida y no carga navegación interna.

## Contrato del fragmento

Formato canónico:

```text
https://<dominio>/solicitar.html#token=<TOKEN_OPACO>
```

Se admite como compatibilidad un fragmento raw únicamente cuando todo el contenido cumple el patrón del token. La generación oficial debe usar `#token=`.

`?token=` nunca se acepta. Si aparece, la página rechaza el enlace, elimina ese parámetro de la URL visible y no lo convierte en header. El fragmento también se retira aun cuando sea inválido. No se usa `localStorage`, `sessionStorage`, cookies, IndexedDB, service worker ni autosave.

Después de consumir el fragmento, el historial conserva solo un marcador booleano, nunca el token. Una recarga muestra: “Vuelve a abrir el enlace original que te proporcionó Finanzas.”

## Bootstrap y estados

La máquina de estados admite:

- `booting` -> `link_validating`;
- `link_valid` -> `editing`;
- `editing` -> `reviewing` -> `captcha_pending` -> `ready_to_submit`;
- `ready_to_submit` -> `submitting` -> `submit_success`;
- errores recuperables y `unavailable` mediante transiciones explícitas.

No existe transición desde arranque a envío, segundo submit concurrente ni edición después del éxito. Enlace ausente, inválido, desconocido, pausado, revocado o expirado usa el mismo mensaje neutral. Solo los fallos temporales ofrecen “Volver a intentar”.

## Configuración pública DEV

`solicitar-config.js` contiene exclusivamente:

- entorno `DEV`;
- base pública de la función DEV;
- site key visible always-pass oficial de Turnstile para pruebas;
- action `provider_intake_submit`;
- margen y overhead conservadores del cliente;
- límite de monto alineado con el default público del contrato DEV;
- moneda `MXN`;
- versión del contrato UI.

La site key de pruebas está documentada por Cloudflare en <https://developers.cloudflare.com/turnstile/troubleshooting/testing/>. Debe sustituirse por una site key productiva durante un release separado a PROD. Nunca se incluye secret de CAPTCHA, `service_role`, anon key, pepper, token QA ni URL de base de datos.

## Payload y validación

El payload usa únicamente los 16 campos permitidos por `provider-intake`. Las longitudes son idénticas a `validation.ts`. El cliente aplica trim, compacta espacios, rechaza caracteres ASCII de control y valida:

- nombre, correo y concepto obligatorios;
- correo;
- RFC mexicano opcional;
- monto positivo, dos decimales y máximo configurado;
- moneda permitida;
- fechas ISO reales;
- UUID fiscal;
- cuenta alfanumérica;
- CLABE de 18 dígitos.

El servidor continúa siendo la autoridad.

## Documentos y `file_kinds`

Los límites efectivos siempre se leen de `link-info`: hasta tres archivos, máximo individual, máximo total y MIME permitidos. Extensiones y MIME deben coincidir. Se detectan duplicados por nombre, tamaño y MIME.

Los `file_kinds` permitidos son:

- `invoice_pdf`;
- `invoice_xml`;
- `bank_document`;
- `support`;
- `other`.

La sugerencia automática es XML -> `invoice_xml`, PDF -> `invoice_pdf` e imagen -> `support`; el usuario puede cambiarla.

Se validan las firmas `%PDF-`, JPEG, PNG y RIFF/WEBP. XML se lee como texto, nunca se parsea y nunca genera requests. Cualquier declaración `DOCTYPE` o `ENTITY`, con espacios razonables entre `<`, `!` y la palabra, se bloquea antes de red.

No se generan previews ni object URLs.

## Límite total y frontera de plataforma

El cálculo conservador suma:

- `File.size` de todos los archivos;
- bytes de JSON del payload;
- bytes de `file_kinds`;
- overhead base multipart;
- overhead por archivo;
- margen fijo de seguridad de 256 KiB.

El submit queda bloqueado si la estimación supera `link.max_total_mb`. No se envía un body sobredimensionado para probar el perímetro.

Una respuesta no JSON 413 se muestra como tamaño excedido. Una respuesta no JSON 502/503 se muestra como posible límite o indisponibilidad, sin exponer el body y sin reintento automático. Esta condición conserva la clasificación Accepted Platform Boundary / P2 informativo del backend.

## Turnstile

El script oficial se inserta únicamente al llegar a revisión y solo después de validar `link-info`. Se usa render explícito, site key pública de pruebas y action `provider_intake_submit`.

El token CAPTCHA permanece en memoria y se reinicia por expiración, error, submit fallido o éxito. El botón de envío requiere formulario válido, confirmaciones, CAPTCHA, presupuesto válido, token de intake y ausencia de envío activo.

En Preview pueden permanecer ausentes `CAPTCHA_EXPECTED_HOSTNAME` y `CAPTCHA_EXPECTED_ACTION`. Después del merge a `dev`, antes de cerrar 1C, deben configurarse con el hostname DEV canónico exacto y `provider_intake_submit`, respectivamente, mediante un cambio autorizado.

## Privacidad, XSS y datos sensibles

Los valores recibidos se escriben con `textContent`; no se interpola HTML externo. El resumen enmascara cuenta y CLABE salvo los últimos cuatro caracteres. El éxito limpia formulario, referencias `File`, CAPTCHA, token, idempotencia y valores capturados; conserva solo empresa, folio y fecha local de confirmación.

No se registran token, CAPTCHA, payload, correo, RFC, teléfono, cuenta, CLABE, archivos o respuestas. Los únicos códigos de diagnóstico permanecen sanitizados y en memoria. La impresión incluye empresa, folio, fecha local, mensaje de recepción y ambiente DEV.

## Idempotencia

La `Idempotency-Key` tiene formato `intake:<crypto.randomUUID()>`, válido para el backend. Permanece en memoria, se reutiliza para el mismo estado material y se regenera cuando cambian campos, archivos o `file_kinds`. Un bloqueo síncrono evita dos requests simultáneos. `duplicate=true` se trata como éxito y conserva el mismo folio.

## Errores públicos

La UI traduce únicamente códigos públicos. Nunca muestra stack, SQL, tablas, constraints, UUID internos, rutas de Storage ni cuerpos HTML/texto del gateway. Un `request_id` solo se muestra como referencia técnica si contiene caracteres seguros.

## CORS - gate obligatorio

El origen de Vercel Preview debe agregarse a `INTAKE_ALLOWED_ORIGINS` solo después de revisión de Ramón. La propuesta final debe:

1. conservar íntegramente el origin DEV canónico vigente;
2. conservar cualquier otro origin ya autorizado después de revisión;
3. agregar exactamente el origin Preview reportado por Vercel;
4. usar origins separados por coma, sin wildcard, path ni slash final.

No se modifica el secret desde este PR ni durante QA previo. El UAT real se mantiene bloqueado hasta recibir la frase explícita “CORS DEV listo”.

Ruta manual en Supabase: proyecto DEV `scsirgbuqjcwoaxfacth` -> **Edge Functions** -> **Secrets** -> editar `INTAKE_ALLOWED_ORIGINS`. Antes de guardar se debe comparar el valor actual para no eliminar origins existentes.

## Accesibilidad y responsive

La página usa landmarks, skip link, encabezados, `form`, `fieldset`, `legend`, labels, foco visible, mensajes inline, `aria-live`, `aria-invalid`, foco al primer error y controles con targets mínimos. No depende únicamente del color y respeta `prefers-reduced-motion`.

La UI es mobile-first, sin tablas ni scroll horizontal. En móvil usa una columna, botones amplios y resumen desplegable; en escritorio muestra formulario y resumen sticky. Los anchos objetivo son 320, 390, 768, 1024, 1366 y 1440 px, con zoom al 200% dentro del gate visual.

### Diagnóstico Axe focal y corrección

El run cloud focal `29554185343`, sin CAPTCHA ni submit, confirmó:

- `label` (`critical`) sobre `#file-input`: el control no tenía nombre accesible.
- `nested-interactive` (`serious`) sobre `#dropzone`: el contenedor con `role="button"` contenía el botón nativo `#choose-files-button`.
- `region` (`moderate`) sobre `.dev-banner`: el aviso quedaba fuera de landmarks.
- `landmark-complementary-is-top-level` (`moderate`) sobre `aside.summary-aside`: el landmark complementario estaba anidado dentro de `main`.

La corrección asigna un `<label>` real al input, conserva `#choose-files-button` como único activador de selección, convierte la zona de arrastre en un grupo no interactivo, mantiene exclusivamente sus eventos drag/drop y traslada el foco de errores al botón visible. El banner DEV pasa a ser un `aside` de nivel superior y el resumen interno pasa a `section`. No se silenciaron reglas ni se excluyeron nodos de Axe.

El diagnóstico extendió temporalmente el mismo enlace QA por tres horas porque estaba expirado y restauró `expires_at` y `updated_at` en el step `if: always()`. El token permaneció protegido, Turnstile no se cargó, hubo cero requests `/submit` y los deltas de intakes, archivos y objetos fueron cero.

## UAT y evidencia

Antes de autorización CORS, el QA visual puede usar páginas sin token, token inválido y estados simulados locales, sin submit. No se deben capturar URLs con hash ni datos reales.

Después de “CORS DEV listo”:

1. reprobar `link-info` real con el token protegido existente;
2. validar empresa y aviso de privacidad;
3. validar CAPTCHA;
4. ejecutar como máximo dos submits positivos;
5. probar duplicate con la misma versión material;
6. confirmar el folio;
7. confirmar ausencia de proveedor, `payment_requests`, batches y `notification_events`;
8. confirmar objetos privados y completar evidencia sanitizada.

El token QA no se solicita por chat, no se imprime y no se incluye en screenshots. Si el archivo protegido no está disponible, Ramón debe construir manualmente la URL localmente. Si el link expiró, se detiene el UAT y se propone extender ese mismo link mediante autorización separada.

## Rollout DEV y gate postmerge

1. Mantener el PR en Draft.
2. Aprobar CORS Preview de forma controlada.
3. Ejecutar UAT real y revisar evidencia.
4. Recibir aprobación explícita de Ramón antes de Ready o merge.
5. Después de merge a `dev`, fijar `CAPTCHA_EXPECTED_HOSTNAME` al hostname DEV canónico y `CAPTCHA_EXPECTED_ACTION=provider_intake_submit` mediante cambio autorizado.
6. Reprobar el portal canónico y confirmar que el árbol de `provider-intake` no cambió.

## Rollback frontend

El rollback consiste en revertir los commits de este portal o retirar `solicitar.html` del deployment de Vercel. No requiere tocar la Edge Function, migrations, secrets, base de datos ni Storage. Si CORS Preview ya fue agregado, retirarlo solo después de verificar que no corresponde a otro Preview activo.

## Riesgos y pendientes

- CORS Preview bloquea `link-info` hasta autorización.
- La frontera física de body puede responder antes que la Edge Function.
- Malware scanning y content disarm permanecen fuera de alcance; los archivos siguen en cuarentena backend.
- La confiabilidad final de Turnstile y del submit requiere UAT real.
- CSP se declara en HTML; un release futuro puede reforzarla con headers de Vercel, incluida protección `frame-ancestors`.
- Lighthouse depende de disponibilidad local o del Preview; no se inventan scores.

## Fase 1D pendiente

Quedan fuera: bandeja interna, triage, matching, creación de proveedor, conversión a `payment_request`, seguimiento, edición posterior, notificaciones, aprobadores, centros de costo, presupuesto, batches, layouts y canales de mensajería.
