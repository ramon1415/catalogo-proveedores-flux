# Solicitudes Sin partida

## Regla confirmada

Operadora y Fersana comparten una clasificación `SIN_PARTIDA`. Cualquier perfil que
ya puede crear solicitudes puede elegirla sin necesitar una partida asignada o un
presupuesto mensual. Se envía a César, quien debe aprobarla expresamente.
Después de aprobar, la etiqueta es `Sin partida (descripción de la solicitud)`;
la categoría sigue siendo la misma hasta el pago. No se crean categorías por concepto.

## Implementación

- Catálogo común no presupuestal; política privada de aprobación por empresa,
  resuelta contra el perfil verificado `cesar@quantta.mx` y sus membresías activas.
- El servidor determina el aprobador, sin depender del selector ni del pool habitual
  del solicitante. No cambia sus asignaciones para solicitudes con partida.
- Se conserva la prohibición de aprobar una solicitud propia. César no puede crear
  una solicitud cuyo aprobador sea él mismo; no se designa un sustituto implícito.
- El aprobador debe utilizar el RPC normal de decisión, con identidad autenticada
  coincidente y evento de auditoría. No basta editar `status` ni indicar otro actor.
- La descripción aprobada es un snapshot protegido. Cambiar el gasto o su importe
  retira la aprobación y exige una nueva decisión. Solicitudes programadas/pagadas
  no aceptan esos cambios. Corte, layout y comprobante conservan sus controles habituales.
- Reembolso Sin partida: todos sus renglones deben compartir esa clasificación y
  sumar el total antes de aprobar. Los gastos con partida se capturan por separado,
  para evitar que un renglón desconocido omita el presupuesto de los demás.
- Selector disponible a todos los perfiles de captura, filtro por categoría en
  Solicitudes, descripción en detalle/historial de aprobación y cortes/exportación.
- La nueva columna se añade a DEV antes del despliegue del frontend.

## Evidencia local

- Build y TypeScript sin errores; artefacto estático construido.
- Suite completa: **1,265 pruebas aprobadas; 0 fallas; 0 omitidas**.
- PostgreSQL PGlite ejecuta la migración y las funciones reales de creación/decisión:
  2 empresas × 4 roles × 8 tipos ordinarios, estado enviado, César seleccionado,
  rechazo de suplantación/autoaprobación, cambio material, aislamiento de empresa,
  reembolso incompleto/mixto y conservación de clasificación hasta pagada.
- React real: captura de proveedor en ambas empresas y los cuatro grupos de roles;
  reembolso a empleado en ambas empresas; disponibilidad sin presupuesto/responsable.
- Filtro único agrupa conceptos aprobados distintos sin cruzar empresas; la suite
  móvil verifica filas, filtros y scroll con los estilos de la PWA.
- Las pruebas usan datos ficticios y adaptadores de red locales. No se aprobó ni pagó
  una solicitud real ni se enviaron correos de prueba.

## DEV / promoción

Base DEV: `8613ddc34e44d1a365fd186dcad5cda033696f0d`.
Migración: `20260916002650_requests_sin_partida_cesar.sql`.

La revisión de PROD fue de solo lectura. Su RPC `create_payment_request` y su guard
de aprobadores difieren de DEV (incluye otra firma de compatibilidad y controles de
reembolso); por ello **no se debe aplicar esta migración de DEV a PROD sin adaptar
esas funciones sobre sus versiones vigentes**. La siguiente promoción debe ser
acotada y conservar convenio, documento y permisos de reembolso de producción.

## UAT

1. En DEV seleccionar Operadora o Fersana y abrir Nueva solicitud.
2. Elegir Sin partida y capturar una descripción clara. El aprobador es César.
3. Enviar: permanece pendiente; el texto mostrado es Sin partida.
4. César aprueba en su cola: aparece Sin partida (descripción).
5. En Solicitudes filtrar por Sin partida y elegir el estatus deseado: todas
   comparten una categoría aunque sus descripciones sean diferentes.
6. Repetir con un reembolso y probar filtros/detalle desde móvil/PWA.

### Verificación de base DEV

Migración aplicada como `20260916002650`. Una sola categoría, dos rutas activas
a César y cero solicitudes nuevas (sin datos QA persistidos). El RPC de consulta
requiere usuario autenticado con membresía y no permite ejecución anónima; los
guards no son invocables directamente por usuarios.
