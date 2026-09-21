# Conciliación de módulos con PROD como referencia

Estado: preparado, sin reparación del historial ni ejecución de SQL remoto. Base DEV `37c9645`; main observado `a5391ea`. Capturas de sólo lectura del 8 de septiembre: PROD 18:59:51 UTC y DEV 18:59:52 UTC.

## Decisión y alcance exacto

PROD es la referencia de lo liberado. DEV tiene funcionalidades nuevas y un baseline distinto; igualar nombres o cantidades no demuestra equivalencia de esquemas. Este tramo prepara únicamente dos módulos cuya fuente del repo coincide byte a byte con el SQL registrado en PROD y cuyos efectos vigentes se comprobaron en ambos ambientes.

| Módulo | Archivo anterior DEV | Versión canónica ya registrada en PROD | Historial DEV | Acción propuesta |
|---|---|---|---|---|
| Incidencias | 20260827090000 | 20260901074848 | Ausente | Renombrar archivo y registrar como aplicada en DEV, sin ejecutar su SQL |
| Nómina | 20260827100000 | 20260901074849 | Ausente | Renombrar archivo y registrar como aplicada en DEV, sin ejecutar su SQL |

El PR conserva todos los bytes de ambos SQL y actualiza sólo las referencias activas y rutas del manifiesto. Los hashes siguen siendo `541c9040ab7d2bb8b952e0ac567621cf88c1f1c481e413f1d62351aa945793ec` y `e2741f8211be4db9178cd035c23a86fc22449d2a1c9e5e584962a77ff800cb50`.

## Estado real que debe conservarse

En ambos ambientes existen los dos módulos activos y sus releases 1. Operadora tiene Incidencias y Nómina habilitados; Fersana tiene Incidencias deshabilitado y Nómina habilitado. DEV contiene cuatro empresas adicionales de QA con ambos módulos apagados. Se conservan estas diferencias de datos de prueba y todas las configuraciones actuales, incluidos hold/channel/version.

La migración antigua de Incidencias exige exactamente una empresa: ahora DEV tiene seis y PROD dos. No debe reejecutarse. Nómina se creó apagada y se habilitó posteriormente; registrar ese origen no significa apagarla otra vez. Se registra equivalencia del efecto histórico con evolución posterior, no la igualdad del estado actual con el seed original.

## Reparación propuesta, aún no autorizada

`docs/ops/supabase-cli-migrations.md` exige autorización explícita para reparar el historial. La propuesta añade exclusivamente `20260901074848` y `20260901074849` como aplicadas en DEV (`scsirgbuqjcwoaxfacth`). No elimina ni actualiza registros existentes. Sobre la captura actual, DEV pasaría de 117 a 119 versiones. Si hay entregas concurrentes, conservarlas y calcular el resultado como inventario vigente más dos.

El flujo estándar documentado por [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-migration-repair) es:

```bash
supabase migration repair 20260901074848 20260901074849 --status applied --linked
```

No se ejecutó el comando. Debe comprobarse previamente que el enlace identifica DEV, confirmar ambas ausencias, los hashes exactos, la configuración de módulos y la revisión del PR; tomar un snapshot actualizado si cambió el alcance. Nunca usar un enlace PROD. Se localizó el CLI 2.113.0 ya disponible en caché y se verificó `migration repair --help`. Una consulta de sólo lectura (`projects list`) confirmó que carece de access token. No se han solicitado ni expuesto credenciales. El conector Supabase sí está autenticado; su sesión no se comparte automáticamente con el CLI.

La reparación registra metadatos; no ejecuta los cuerpos SQL. Después se verifican las dos nuevas versiones, conservación de todas las filas previas, configuración de módulos y contratos reales DEV. Sólo entonces integrar el renombre preparado. Si hace falta revertir exclusivamente estas adiciones, confirmar primero que no fueron usadas por otro despliegue y retirar sólo esas dos nuevas marcas mediante reparación autorizada; no revertir tablas o activaciones.

## Alternativa concreta que requiere autorización expresa

Para evitar pedir credenciales por chat, se preparó una única transacción de metadatos para ejecutar mediante el conector autenticado, exclusivamente en el proyecto DEV. **Esto sería una excepción al medio CLI del runbook y no está autorizada por un «continúa» genérico.** Se requiere aprobar expresamente tanto las dos versiones como el uso del conector en lugar de CLI. No se añade un runner de despliegue ni un workflow.

El archivo `metadata-repair.sql` del paquete de aprobación tiene SHA-256 `8a7c226320b662f0de3f7d063241666566cc291cd9b3b80e6382e571762afd3d`. Su transacción comprueba que ambos destinos estén ausentes; inserta sólo version/name/statements de las dos fuentes PROD ya verificadas; exige exactamente dos filas y confirma. Los cuerpos históricos quedan almacenados como texto en statements: no se ejecutan. Si cualquiera existe, aborta sin sobrescribirla. No copia created_by/idempotency_key/rollback de PROD ni modifica filas existentes. Su ejecución real sobre el esquema de ledger aislado pasa 117→119; retirar esas dos adiciones de la base aislada restaura el estado original 117. Es una prueba de la transacción exacta preparada, no del transporte remoto.

La captura de origen se conserva en el paquete; antes de ejecutar se revalidan las dos ausencias, fuentes, entorno y configuración. No se importará el SQL de limpieza histórica. La autorización de esta alternativa no autoriza `db push`, nuevas migraciones, cambios de PROD ni futuras reparaciones.

## Snapshot y verificación

El paquete `Flux_Conciliacion_Modulos_PROD_Referencia_2026-09-08.zip` conserva columnas del ledger, inventarios completos versión/nombre de DEV y PROD, filas completas seleccionadas de Fersana/mantenimiento DEV y los tres orígenes PROD, módulos/releases/configuraciones y el plan exacto. Es un snapshot del alcance de metadatos, no un backup integral de las bases ni de todos los cuerpos de migraciones.

La prueba PGlite 0.3.16 restaura las filas completas seleccionadas, modela únicamente las dos adiciones de metadatos (117 → 119) y su reversión (119 → 117), y verifica igualdad con el estado original. Ejecuta la transacción exacta de metadatos preparada contra una base aislada, sin ejecutar SQL de negocio ni acceder a bases remotas; no sustituye una prueba del transporte CLI/conector. Los dos destinos estaban ausentes en el snapshot.

Validación local del repo: 14/14 contratos Fersana y 14/14 hashes del manifiesto correctos. [Evidencia](../qa/module-history-prod-reference-2026-09-08.json).

## Separado de esta autorización

- Fersana: DEV registra `20260831004813`, PROD `20260901074850`. El SQL conservado por #584 coincide exactamente con PROD. #584 cerró repo↔DEV, no DEV↔PROD. Un futuro cambio a la versión PROD debe acompañar el hardening dependiente: `20260831004957` → `20260901074851`; renombrar sólo el origen colocaría su dependiente antes de crear las tablas. Revisar además funciones posteriores que sustituyen RPC antes de cambiar el orden.
- Registro de módulos: PROD `20260901074845` / `20260901074847`; DEV `20260826223239` / `20260826223357`. Requiere comparar fuentes y dependencias como otro tramo, no deducir igualdad sólo del nombre.
- Las tres fuentes de módulos/onboarding aplicadas en PROD no aparecen como archivos activos con esos sufijos en main. Hay que recuperar su procedencia y acordar una cadena compartida; no copiar todo DEV a main ni reparar PROD de forma masiva.
- `20260906003626_drop_backup_tables`: fila histórica archivada como evidencia, sin importar su SQL al directorio activo y sin autorizar su retiro. La limpieza sigue en 86bbw39a5 con respaldo verificado.
- `20260908184710_payroll_obligations_shared_budget_guard`: desarrollo concurrente de IMSS/ISN, cuya entrega debe converger en su PR de origen.
- Replay detenido en `047_precheck: public layout contract drifted` y Supabase Preview con versiones remotas sin archivo. Este PR no los resuelve. El cambio de orden de estos dos seeds queda pendiente de la reconstrucción completa; no aplicar un push general para probarlo.

La comparación nominal es sólo un inventario inicial: DEV tiene un baseline consolidado y PROD conserva migraciones individuales y paquetes con sufijos distintos. Los nombres compartidos incluyen duplicados en DEV, como la reparación de extraordinarios. No equiparar nombres distintos con funcionalidades faltantes ni reparar esa historia sin contrastar objetos vigentes.
