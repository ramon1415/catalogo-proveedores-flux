# PR #556 — cierre de revisión E1

7 de septiembre de 2026. Base: `dev`. Correcciones sobre `2070fbb`.

## Problema y comportamiento resultante

La empresa activa normalmente ya está seleccionada al abrir la solicitud.
El prefill anterior no la cambiaba ni advertía una discrepancia con el receptor
del CFDI. La moneda seguía en MXN aunque el documento estuviera en USD.
Además, el snapshot contable podía completarse fuera de orden al cambiar XML.

| Caso | Resultado |
|---|---|
| Empresa vacía y receptor único con acceso | Precarga la empresa. |
| Empresa elegida distinta del receptor | Conserva la selección, explica la discrepancia y ofrece usar la empresa receptora. Bloquea envío hasta resolverla. |
| Receptor desconocido, ambiguo o sin acceso | Mensaje accionable y envío bloqueado; no amplía permisos. |
| XML en USD | Precarga USD y TipoCambio si existen; si falta el tipo de cambio pide capturarlo. |
| Moneda o tipo de cambio editados manualmente | Los conserva; una discrepancia de moneda bloquea envío. |
| Moneda distinta de MXN/USD | Explica que no se admite; no convierte silenciosamente a MXN. |
| Cambio de archivo | Retira importes/concepto/proveedor precargados automáticamente; conserva campos editados manualmente. |
| Lecturas XML fuera de orden | Sólo el archivo vigente puede aportar UUID, precarga y snapshot. |
| Envío mientras lee XML | Bloqueado hasta terminar la lectura. |
| Cambio de adjunto durante creación | Payload y snapshot quedan fijados al enviar; no se mezclan facturas. |
| Crear otra solicitud | Limpia snapshot/UUID y conserva una empresa inicial utilizable, incluso con una sola membresía. |
| Duplicado visible vigente | Banner con enlace a la solicitud y envío bloqueado. |
| Cambio de empresa | Reconsulta duplicados; descarta la respuesta de la empresa anterior. |
| Solicitud rechazada/cancelada | No produce aviso bloqueante: coincide con la excepción del índice único. |
| Alta de proveedor | Sólo desde la factura y con el mismo permiso de administración que el catálogo. Operador recibe indicación de acudir a Finanzas. |

## Verificación

```sh
node --test scripts/qa/solicitud-desde-factura.test.mjs scripts/qa/fb-integracion-contract.test.mjs scripts/qa/react-cfdi-uuid-csf-contract.test.mjs
npm --prefix app run typecheck
npm --prefix app run build
```

- 29 pruebas pasan: 15 E1, 9 FB-Integración y 5 UUID/CSF.
- Las pruebas E1 ejecutan el componente y handlers reales mediante React Test Renderer 18.3.1 (dependencia de desarrollo fijada). Los adaptadores de red/XML y componentes secundarios se simulan; no se escribe información ficticia en ambientes compartidos.
- En las pruebas de persistencia se aísla la validación presupuestal ajena a E1 para comprobar qué UUID, moneda y snapshot llegan a los adaptadores. No constituyen UAT de todo el flujo financiero.
- La prueba del parser entrega un DOM simulado y comprueba los atributos Moneda/TipoCambio. No sustituye una revisión visual del navegador.
- El workflow React ejecuta las pruebas E1 tras instalar las dependencias; cambios a la propia prueba también disparan CI.
- El contrato FB-Integración verifica ambos resets antes de leer otro archivo y la fijación del snapshot antes del RPC; ya no exige que los resets sean líneas contiguas.
- Typecheck y compilación local verificados; checks remotos y despliegue se revisan al publicar/integrar.

## Base de datos y límites

Consulta de catálogo de sólo lectura en Supabase DEV (`scsirgbuqjcwoaxfacth`):

- `payment_requests_invoice_uuid_unique`: único y válido.
- Clave: `(company_id, upper(invoice_uuid))`.
- Predicado: UUID no nulo y estado distinto de `rejected`/`cancelled`.
- La consulta del banner compara UUID sin distinguir mayúsculas y aplica las mismas exclusiones de estado.
- RLS puede ocultar solicitudes de otras personas; el índice único continúa siendo el candado duro. No se modifica RLS ni se usa una lectura privilegiada desde el cliente.
- Operadora Tlacatecpan continúa sin RFC en DEV al revisar. Debe completarse con una fuente verificada para usar E1 allí; no se inventa ese dato. El formulario indica el pendiente al cargar un CFDI cuyo receptor no se puede resolver.
- Sin migraciones nuevas ni cambios al RPC `create_payment_request`.
- E2/E3 permanecen fuera de este cierre; ya existe una primera implementación de predicción en DEV.
- Queda pendiente UAT autenticada por roles; no se afirma haber completado pruebas visuales ni el flujo de pagos real.
