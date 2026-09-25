# Paquete multi-partida para main

Base: main `45a5937`. Origen revisado: PR #697, `a24b45e`. No incluye el resto de cambios de dev.

## Comportamiento

Captura de solicitud normal con varias partidas, con o sin comprobante. El cliente envía las líneas dentro del RPC; la base de datos crea solicitud, líneas y enlace en una sola transacción. El consumo corresponde a cada partida, incluyendo líneas presupuestales bajo una principal no presupuestal. Las obligaciones compartidas se bloquean y revalidan en el helper privado autorizado por empresa. Reembolsos y convenios conservan sus rutas propias.

## Orden de base de datos

El archivo activo `20260925173828_multipartida_atomic_prod_release.sql` consolida estas siete fuentes en el mismo orden y una sola transacción. Los originales están en `scripts/qa/fixtures/multipartida-release/` para trazabilidad y regresiones:

1. 20260924181500_payment_request_distributions_multipartida
2. 20260924190000_payment_request_distribution_budget_validation
3. 20260925120000_budget_availability_distribution_aware
4. 20260925130000_multipartida_prod_hardening
5. 20260925155322_multipartida_private_settings_fix
6. 20260925160000_request_with_document_distributions
7. 20260925171716_multipartida_preserve_rpc_permissions

La séptima conserva los permisos actuales de PROD: authenticated y service_role pueden ejecutar; PUBLIC y anon no. Los argumentos opcionales mantienen las llamadas del cliente anterior durante la transición. Aplicar backend antes de publicar el cliente. Se registra únicamente la versión de la migración consolidada, cuyo nombre se alinea con la versión generada por el servicio. No se reparan ni reescriben versiones históricas. La vista restaura explícitamente security_invoker=true; el paquete aborta si cambian las filas de disponibilidad existentes, las firmas o los permisos.

Antes de aplicar: respaldos disponibles, comparar el esquema vigente, verificar firmas/dependencias y guardar agregados de disponibilidad. Después: agregados sin cambio para las solicitudes existentes sin reparto, firmas core22/document22/document23, permisos, asesores y comprobación de aplicación. No crear solicitudes financieras reales de prueba en PROD.

## Verificación local

- Build TypeScript/Vite aprobado.
- 40 pruebas focalizadas aprobadas, cero fallos: captura, comprobante atómico, compatibilidad, permisos y RPC.
- Suite completa sobre este paquete: 695 aprobadas, 12 fallos, 1 omitida (708).
- Control con main sin cambios en el mismo entorno: 669 aprobadas, los mismos 12 fallos, 1 omitida (682). No se afirma que la suite completa esté verde.
- Los fallos preexistentes corresponden a contratos de notificaciones/portal, ámbito de beneficiarios, comprobantes de reembolso y fixture de fechas del resumen semanal. Se conservaron sin ocultar ni omitir pruebas.
- Concurrencia nativa con dos conexiones: evidencia previa en el documento adjunto; no se presenta como prueba concurrente del servicio alojado.

## Estado externo

Canal de migraciones verificado como postgres, read_only=off. Las consultas ordinarias del conector usan un rol de lectura: eso no implica que el canal de migraciones carezca de escritura.

Ensayo del paquete completo en PROD con aborto intencional: 1,322 filas de disponibilidad idénticas, firmas y permisos verificados. No se crearon solicitudes ni se conservaron cambios durante el ensayo. Check backup-readiness aprobado 2026-09-25 03:31 UTC (ejecución 36049733456).

Aplicada y verificada en PROD: `20260925173828_multipartida_atomic_prod_release`. La validación dentro de la misma transacción comprobó la disponibilidad sin cambios. Postcheck: RLS activo en distribuciones, security_invoker=true en la vista, firmas core22/document22/document23, ejecución permitida a authenticated/service_role y denegada a anon; cero distribuciones creadas. El asesor señala el wrapper con documento como SECURITY DEFINER accesible a authenticated: es intencional y conserva el patrón previo, con validación de identidad, propietario de storage y empresa.

Pendiente: publicar y verificar el cliente.
