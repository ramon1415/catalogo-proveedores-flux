# IMSS e ISN dentro de Nómina

Fecha: 2026-09-08. Entrega de integración para DEV, PR #578.

Ramón confirmó que los cuatro PDF enviados por Carlos son **ejemplos de
formato**. No se registra la empresa de las muestras ni sus obligaciones.
Los originales, importes, referencias y datos de empleados quedan fuera de
Git. Los casos versionados son sintéticos.

## Alcance implementado

| Etapa | Comportamiento |
| --- | --- |
| Captura | Sección IMSS / ISN dentro de Nómina, borrador recuperable por empresa, lectura por contenido y carga privada de PDF. |
| IMSS | SIPARE como documento monetario principal; SUA y EMA como soportes opcionales. Exige consistencia de RFC, registro patronal, periodo, importe y vencimiento cuando conste. No suma los tres soportes. |
| ISN | Formato CDMX de las muestras. Respeta el total final impreso; el talón no crea otra obligación. No generaliza a otros estados. |
| Envío | Validación de bytes, hash, pertenencia y datos en servidor; partida, centro, mes y disponibilidad presupuestal requeridos. |
| Finanzas | Confirmar montos, adjuntar comprobante bancario, revisar/completar importe, fecha y referencia, cerrar como pagada. El flujo DEV mantiene la obligación privada y no entra al corte semanal. |
| Pago | El importe debe coincidir con la obligación; fecha y referencia reconocidas del PDF deben coincidir con lo confirmado. La línea de captura no sirve como comprobante. Estado pagado inmutable e idempotente. |
| Avisos | Solicitud enviada al responsable de Tesorería configurado por empresa; pago cerrado al perfil creador. Correo con estilo Flux y liga privada. |
| Interfaz | Archivos con estado y descarga uniforme; listado y modal reutilizan el scroll interno y la corrección del selector de archivos de Nómina. |

Flux registra los documentos y la confirmación del pago externo. No calcula
cuotas, tasas, recargos o vencimientos fiscales ni ejecuta transferencias.
Las fechas límite de los formatos nunca se toman como fecha de pago.

## Privacidad y permisos

| Acción | Captura explícita por empresa | Finanzas por empresa | SysAdmin autorizado |
| --- | --- | --- | --- |
| Crear, editar y enviar | Sí | Solo con concesión adicional de captura | Sí |
| Historial | De su empresa autorizada | Pendientes de confirmación/pago y sus cierres; enlace directo a pagadas | Sí |
| Confirmar, subir comprobante, cerrar | No por la concesión de captura | Sí | Sí |
| Administrar configuración | No | No por el rol Finanzas | Administración controlada |

Se reutilizan `payroll_capture_grants` y los helpers vigentes de membresía
activa por empresa. No se modifican los roles globales de Ara o Yulma, los
permisos de sueldos ni los demás módulos. Cada RPC revalida permisos. Las
cuatro tablas nuevas tienen RLS y acceso directo revocado a anon/authenticated;
la interfaz consume RPCs de alcance explícito. El bucket privado solo acepta
cargas previamente reservadas al actor; descarga por URL firmada de 120 s.
Los lectores persisten una lista explícita de datos corporativos y agregados,
sin texto íntegro ni filas de empleados.

## Presupuesto

IMSS e ISN **sí utilizan presupuesto**, como establece
`20260903041213_fonacot_no_presupuestal.sql`. No se les aplica la excepción de
la nómina de sueldos. La vista canónica `budget_availability` conserva sus
cálculos previos y suma únicamente los agregados de las obligaciones privadas:
enviada/confirmada/pagada comprometen una vez; pagada ejerce; cancelada libera.
No se crean solicitudes normales espejo ni partidas duplicadas.

En DEV, Operadora Tlacatecpan tiene las asignaciones existentes de Carga Social
e ISN en Rancho San Juan Tlacatecpan. Soporte Fersana carece de asignaciones:
puede guardar borradores, pero no enviar. No se inventan centro ni presupuesto.
La aprobación de montos por Finanzas implementada aquí debe validarse en la
prueba operativa antes de promover IMSS/ISN a PROD; no cambia aprobaciones
presupuestales de solicitudes normales.

Los envíos de obligaciones bloquean las líneas presupuestales aplicables y
revisan la disponibilidad canónica. La competencia secuencial con solicitudes
normales está probada. **La concurrencia real entre ambos caminos sigue como
gate antes de PROD**; el bloqueo de este RPC no acredita que todos los caminos
históricos de solicitudes normales usen el mismo bloqueo.

## Base y servicios DEV

- `20260908172940_payroll_obligations_imss_isn.sql`: tablas, permisos, Storage,
  RPCs, presupuesto agregado, outbox y recuperación por cron cada minuto.
- `20260908173408_payroll_obligations_app_origin.sql`: liga propia por empresa
  para IMSS/ISN, independiente de los previews antiguos de correos de sueldos.
- `payroll-obligations` v1: validación JWT y perfil, PDF de máximo 10 MB/20
  páginas, lectura `unpdf@1.4.0`, persistencia de agregados y descarga segura.
- `payroll-obligation-notifications` v1: autenticación por secreto del dispatcher,
  modos disabled/test_only/real, destinatarios revalidados, idempotencia y
  reintentos. Los tipos de eventos son exclusivos de obligaciones.
- Configuración explícita por empresa/tipo; no se hereda la activación de
  correos de sueldos. DEV usa únicamente la cuenta de QA autorizada de Ramón.
  `test_only` requiere un perfil de QA; `real` rechaza una configuración de QA.
- El aviso contiene enlace al comprobante privado, no adjuntos sensibles.

## Evidencia y límites de la validación

- Lectura de todas las páginas de los cuatro ejemplos con Poppler/PDF.js y
  comparación visual: clasificación y agregados consistentes. La diferencia
  de RFC de la muestra SUA se conserva como caso negativo, no se corrige por
  mayoría. Son formatos de referencia, no un paquete a importar.
- 46 pruebas dirigidas: lectores (8), servicios (5), ciclo/RLS/presupuesto en
  PGlite (7), interfaz React (3), regresiones de comprobante (11), modal (3)
  y avisos de sueldos (9). PDFs de prueba generados en memoria.
- Compilación y TypeScript de la aplicación completos.
- Ciclo de ambos tipos contra los RPCs reales de DEV en una transacción con
  rollback: borrador → documento → envío → confirmación → comprobante → pagada;
  dos eventos por obligación. Se simuló la frontera de validación del servicio
  con agregados sintéticos: no equivale a una carga E2E desde el navegador.
- Worker desplegado: dry run HTTP 200, `test_only`, configuración completa,
  cero correos enviados. Servicio de archivos rechaza peticiones sin JWT.
- Advisors: sin nuevas advertencias de acceso anónimo; cuatro tablas privadas
  sin políticas de SELECT directo y siete RPCs autenticados son intencionales.
- La revisión visual del despliegue y la sesión autenticada de navegador no
  pudieron completarse por timeouts de la conexión del navegador. Las pruebas
  de componentes no sustituyen esa revisión.

## Siguiente gate

1. Prueba operativa autenticada en DEV: documentos sintéticos coherentes con
   la empresa, guardar/reabrir/descargar, confirmación, comprobante bancario y
   correo a la cuenta de QA. Validar celular y scroll interno visualmente.
2. Resolver la asignación de Fersana si operará obligaciones, confirmar centros,
   mes presupuestal y política de confirmación con Finanzas.
3. Cerrar la prueba de concurrencia presupuestal y usar un comprobante bancario
   representativo del pago IMSS/ISN para completar la cobertura del lector.
4. Preparar un release IMSS/ISN acotado después de esos gates. Esta entrega no
   modifica PROD ni declara completa la spec amplia de ClickUp 86bbw5mff.

El rol RH global, la bandeja transversal de comprobaciones y el feed contable
siguen como entregas independientes.


## Ajustes de UAT - 8 de septiembre de 2026

- Carga y guardado de borrador anuncian éxito dentro del modal y por toast,
  únicamente después de completar la operación. Cancelar el selector vacío
  no inicia una carga ni descarta la confirmación anterior.
- Antes de enviar aparece un resumen para confirmar montos. El nuevo RPC
  `submit_reviewed_payroll_obligation` valida versión e importe y registra la
  revisión. Si quien captura tiene capacidad de Finanzas, envío y confirmación
  ocurren en una sola transacción; no aparece otra confirmación después.
  Captura sin capacidad de pago conserva el paso de revisión por Finanzas.
- Documentos con fondo contrastado, iconos PDF/descarga y sección titulada.
  Pago completado usa una tarjeta de éxito verde con icono de confirmación.
  Navegación Sueldos / IMSS-ISN subrayada; acciones de crear llevan +.
- Los dos correos ISN reportados como faltantes estaban en INBOX, sin leer:
  solicitud 18:14:01 UTC y pago 18:15:02 UTC. La espera correspondía al cron
  de un minuto. No se reenvían correos ya entregados.
- La migración `20260908182623_payroll_obligations_review_feedback.sql` activa
  el worker al insertar cada evento propio; pg_net inicia después del commit.
  Conserva el cron como recuperación y la misma idempotencia y cuenta de QA.
- Worker de notificaciones v2 en DEV: el correo reconoce si Finanzas ya
  confirmó los montos, para no pedir una confirmación duplicada.
- Suite dirigida ampliada a 52 pruebas: orden de revisión/envío en ambos tipos,
  permisos, monto/versión, idempotencia, mensajes de éxito/error y trigger
  limitado a eventos de obligaciones en empresas habilitadas.
