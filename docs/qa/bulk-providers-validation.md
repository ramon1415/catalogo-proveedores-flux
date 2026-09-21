# Alta masiva de proveedores: validacion aislada de #561

Fecha: 2026-09-21. Tarea ClickUp: 86bbw6nt6.
Base original revisada: c8e71c0681f8dd7a9c473303607e699554cce5aa.
DEV incorporado en la rama de trabajo: 09cc3accad17a78143e622c42cbd987fc768f37c.
Rama: fix/ramon-bulk-provider-validation. NO main, NO PROD.

## Revision tecnica y procedencia

Ramon compartio el visto bueno tecnico de Carlos para el paquete local y sus 57 pruebas. La ejecucion, compilacion, navegador e integracion quedan del lado de Ramon; Carlos solo para dudas concretas.

Se conservan byte a byte los archivos aprobados bulkProviders.ts, BulkProviderModal.tsx, api.ts y bulk-providers.test.mjs. El CSS incorpora el ajuste visual separado ya probado localmente: encabezado alineado arriba y cierre de 44 x 44 px. No cambia el alta individual.

## Compatibilidad con DEV actual

La base antigua estaba 131 commits detras de DEV. Se incorpora DEV en esta rama, NO al reves. El arbol parte del DEV verificado y agrega exclusivamente ocho archivos del alcance. ProveedoresPage conserva el scroll interno, su texto de ayuda y atributos accesibles actuales; sobre esa pagina se agrega el boton y montaje del modal masivo. Al revertir solo ese diff de alta masiva, el archivo coincide byte a byte con el blob DEV 5eeda20911d211f29ea0671a415d8f2f68219743. El API individual actual conserva el blob base 78a2e9c6f42b1b61949bbfbe18f4d9afa1e128dd; solo se agregan helpers masivos.

## Alcance

Parser estricto CSV/TSV; metodos canonicos; RFC/CLABE como texto; maximo 200 filas. Catalogo compartido con RLS actual, paginacion e inactivos incluidos. Duplicados/conflictos visibles; ningun UPDATE ni reactivacion desde el lote. Resultados por fila, lectura antes de reintentar y detencion ante confirmacion incierta o cambio de contexto. Indices unicos existentes como ultima proteccion de concurrencia.

No se cambian pagos, presupuestos, historicos, cuentas origen, cron, secretos, roles ni migraciones.

## Evidencia y limitaciones

57/57 tests originales ejecutados localmente antes de publicar. El commit previo ebb167ac789e6123d3dc09aa66472538bee9caa0 aprobo contratos, npm ci, typecheck y build completos en el run 35651273500. Este resultado NO se atribuye automaticamente al nuevo commit con DEV incorporado: requiere su propia CI.

Los tres tests de adaptador y los 27 casos Chromium anteriores son evidencia separada del componente con servicios simulados, no UAT real ni navegador de toda la aplicacion.

## CI y artefacto offline

contents:read, checkout sin credenciales persistidas, Node 22.16.0, npm ci con el lockfile existente, typecheck y build de toda la aplicacion. Sin secretos de Supabase/Vercel, despliegues ni escrituras a bases.

El bundle QA usa https://flux-qa.invalid y una cadena sintetica no secreta. SOLO para navegador offline con transporte simulado; NO desplegar a DEV/PROD. Artefacto de tres dias en este repositorio, sin .env, credenciales, .git ni datos de negocio. La visibilidad depende del repositorio; no se declara privado.

## Gates pendientes

1. CI verde del commit actualizado, seguida de navegador de la aplicacion completa y prueba separada de PWA instalada.
2. Aislamiento efectivo y notificaciones apagadas antes de UAT con escritura; gate aun no acreditado.
3. Confirmar en DEV error RPC code 23505 y flujo no-transferencia con beneficiary_name nulo.
4. No fusionar ni promover a main/PROD. No ejecutar espejo, migraciones, limpieza o notificaciones.
