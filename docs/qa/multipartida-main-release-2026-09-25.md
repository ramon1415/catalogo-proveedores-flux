# Paquete multi-partida para main

Base: main `45a5937`. Origen revisado: PR #697, `a24b45e`. No incluye el resto de cambios de dev.

## Comportamiento

Captura de solicitud normal con varias partidas, con o sin comprobante. El cliente envía las líneas dentro del RPC; la base de datos crea solicitud, líneas y enlace en una sola transacción. El consumo corresponde a cada partida, incluyendo líneas presupuestales bajo una principal no presupuestal. Las obligaciones compartidas se bloquean y revalidan en el helper privado autorizado por empresa. Reembolsos y convenios conservan sus rutas propias.

## Orden de base de datos

Aplicar las siete migraciones del paquete en este orden, dentro de una única transacción de release (quitar los BEGIN/COMMIT individuales al agruparlas):

1. 20260924181500_payment_request_distributions_multipartida
2. 20260924190000_payment_request_distribution_budget_validation
3. 20260925120000_budget_availability_distribution_aware
4. 20260925130000_multipartida_prod_hardening
5. 20260925155322_multipartida_private_settings_fix
6. 20260925160000_request_with_document_distributions
7. 20260925171716_multipartida_preserve_rpc_permissions

La séptima conserva los permisos actuales de PROD: authenticated y service_role pueden ejecutar; PUBLIC y anon no. Los argumentos opcionales mantienen las llamadas del cliente anterior durante la transición. Aplicar backend antes de publicar el cliente. Registrar estas versiones con el mecanismo de migración del despliegue; no reparar ni reescribir el desfase histórico de migraciones como parte de este paquete.

Antes de aplicar: respaldos disponibles, comparar el esquema vigente, verificar firmas/dependencias y guardar agregados de disponibilidad. Después: agregados sin cambio para las solicitudes existentes sin reparto, firmas core22/document22/document23, permisos, asesores y comprobación de aplicación. No crear solicitudes financieras reales de prueba en PROD.

## Verificación local

- Build TypeScript/Vite aprobado.
- 40 pruebas focalizadas aprobadas, cero fallos: captura, comprobante atómico, compatibilidad, permisos y RPC.
- Suite completa sobre este paquete: 695 aprobadas, 12 fallos, 1 omitida (708).
- Control con main sin cambios en el mismo entorno: 669 aprobadas, los mismos 12 fallos, 1 omitida (682). No se afirma que la suite completa esté verde.
- Los fallos preexistentes corresponden a contratos de notificaciones/portal, ámbito de beneficiarios, comprobantes de reembolso y fixture de fechas del resumen semanal. Se conservaron sin ocultar ni omitir pruebas.
- Concurrencia nativa con dos conexiones: evidencia previa en el documento adjunto; no se presenta como prueba concurrente del servicio alojado.

## Estado externo

PROD sin cambios. El conector consultado el 25-sep devuelve current_user=session_user=supabase_read_only_user. No hay credencial de escritura disponible en este trabajo. Falta aplicar y verificar backend por un canal autorizado de escritura, y después publicar el cliente. La revisión de asesores es preflight, no verificación posterior al despliegue.
