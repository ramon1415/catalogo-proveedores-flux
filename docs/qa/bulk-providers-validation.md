# Alta masiva de proveedores: validacion aislada de #561

Fecha: 2026-09-21. Tarea ClickUp: 86bbw6nt6.
Base exacta revisada: c8e71c0681f8dd7a9c473303607e699554cce5aa.
Rama de trabajo: fix/ramon-bulk-provider-validation. NO main, NO PROD.

## Revision tecnica y procedencia

Ramon compartio el visto bueno tecnico de Carlos para el paquete local y sus 57 pruebas. La ejecucion, compilacion, navegador e integracion quedan del lado de Ramon; Carlos solo para dudas concretas.

Se conservan byte a byte los archivos aprobados bulkProviders.ts, BulkProviderModal.tsx, api.ts y bulk-providers.test.mjs. El CSS incorpora el ajuste visual separado ya probado localmente: encabezado alineado arriba y cierre de 44 x 44 px. No cambia el alta individual.

## Alcance

- Parser estricto CSV/TSV, encabezados opcionales, comillas, separadores, columnas vacias y ceros de CLABE. Maximo 200 filas y 200000 caracteres.
- Metodos canonicos y validacion de RFC/CLABE. La validacion de formato no certifica datos fiscales ni bancarios.
- Catalogo compartido con las reglas actuales y RLS intacta, paginacion de identidades e inclusion de inactivos.
- Deteccion de duplicados y conflictos por RFC, alias y CLABE; nunca actualizar ni reactivar un proveedor existente.
- Resultados por fila, reintentos precedidos por lectura, y detencion ante confirmacion incierta o cambio de contexto. Los indices unicos existentes son la ultima proteccion de concurrencia.
- No se cambian pagos, presupuestos, historicos, cuentas origen, cron, secretos, roles ni migraciones.

## Evidencia local

57/57 pruebas originales ejecutadas nuevamente antes de publicar. Los tres tests de adaptador y 27 casos de Chromium del paquete anterior son evidencia local separada con servicios simulados; no son UAT en DEV ni se atribuyen a esta CI.

## CI de esta rama

Permiso contents:read, checkout sin credenciales persistidas, Node 22.16.0, npm ci con el lockfile existente, typecheck y build de TODA la aplicacion. No se usa ningun secret de Supabase ni Vercel, no hay despliegue ni escrituras a bases.

El bundle de QA usa https://flux-qa.invalid y una cadena sintetica no secreta como clave. Es SOLO para navegador offline con transporte simulado; NO es un paquete para desplegar a DEV o PROD. Se conserva por tres dias como artefacto privado del mismo repositorio junto al codigo fuente necesario, sin .env, credenciales, .git ni datos de negocio.

## Condiciones antes de integrar o escribir en DEV

1. Verificar CI en el SHA exacto y compatibilidad con dev vigente; no asumir que el viejo head de #561 contiene cambios actuales.
2. Navegador con aplicacion completa y dependencias reales, escritorio/movil, claro/oscuro; PWA instalada por separado.
3. Verificar aislamiento efectivo y notificaciones apagadas antes de UAT con escritura; no se ha acreditado ese gate.
4. Confirmar en DEV el error RPC code 23505 y el flujo no-transferencia con beneficiary_name nulo. La documentacion o un mock no sustituyen estos casos.
5. No fusionar ni promover a main/PROD. No ejecutar espejo, migraciones, limpieza o notificaciones.

Este documento no afirma que el build ni UAT hayan pasado: consultar los resultados del workflow del commit exacto.
