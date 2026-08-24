# Mapper CONTPAQ — contrato, procedencia y gate de carga

Fecha de corte: 2026-08-24  
Ambiente validado: Supabase DEV `scsirgbuqjcwoaxfacth`

## Alcance de esta rebanada

La rebanada crea el contrato de base de datos y una extensión aislada para mapear partidas presupuestales a cuentas CONTPAQ. No reemplaza `configuracion.html` ni `configuracion.js`; por ello conserva la administración vigente de membresías, directores y facultades extraordinarias.

La pestaña **Mapeo CONTPAQ** queda disponible únicamente para:

- SysAdmin: todas las empresas activas.
- Administración / Finanzas: solo empresas donde el perfil tenga membresía activa.
- Dirección y Operación: sin acceso.

El catálogo es de solo lectura para usuarios autenticados autorizados. Su sincronización corresponde a un proceso privilegiado; el mapper únicamente escribe relaciones en `budget_account_mappings`.

## Procedencia y universo de datos

El catálogo de Operadora corresponde al archivo real de CONTPAQ entregado por Denise. No son registros sintéticos ni placeholders.

| Elemento | Cantidad / resultado |
|---|---:|
| Cuentas del catálogo Operadora | 1,646 |
| Partidas presupuestales mapeadas | 87 de 89 |
| Mapeos por coincidencia exacta de nombre | 22 |
| Mapeos por criterio documentado | 65 |
| Cuentas contables distintas utilizadas | 63 |
| Mapeos marcados `needs_review` | 6 |

Los códigos de cuenta se almacenan normalizados, sin guiones. La normalización se ejecuta al importar, no en cada consulta.

## Validación estructural del mapeo inicial

Las 63 cuentas distintas utilizadas por los 87 mapeos fueron validadas antes de liberar el contrato:

| Prueba | Resultado |
|---|---:|
| Existen en el catálogo | 63/63 |
| Son hoja del árbol, sin descendientes | 63/63 |
| Son cuentas de detalle, `cta_mayor = 2` | 63/63 |
| Son de naturaleza gasto, `tipo = G` | 63/63 |

La validación de hoja evita doble conteo silencioso al agregar importes. Los mapeos se concentran en dos agrupaciones presupuestales:

- Administración RSJT: 59.
- Gastos de administración: 4.

## Mapeos que requieren revisión

Los siguientes seis mapeos viajan con `needs_review = true` y conservan su razón de criterio:

1. Carga Social → Cuota Patronal IMSS.
2. Servicios de Personal → Worky.
3. Servicios y suministros → Consumibles Campo.
4. Gastos extraordinarios → Gastos Corporativos.
5. Identificadores → Apoyo a personal.
6. ISR → Impuestos.

El primero requiere especial atención: la partida agrupa IMSS, Infonavit y AFORE, mientras que la cuenta elegida corresponde solamente a IMSS. Es una decisión de criterio atribuida a Denise; no invalida el esquema, pero debe permanecer visible para revisión.

## Por qué no se utilizó el código presupuestal como regla de match

Se descartó el emparejamiento por código porque existen códigos `602` corruptos en el presupuesto. Ejemplos observados:

- CFE apuntaba a Mantenimiento equipo de cómputo.
- Telmex apuntaba a Mantenimiento caballos.

Por lo tanto, el contrato solo admite métodos explícitos:

- `exact_name`
- `judgment`
- `manual`
- `imported`

Cada mapeo por criterio o marcado para revisión debe conservar una razón legible.

## Árbol y metadatos incorporados al esquema

`contpaq_accounts` incorpora desde el inicio:

- `cta_sup`: cuenta padre normalizada.
- `cta_mayor`: 1 renglón, 2 detalle, 3 agrupador, 4 subdetalle.
- `tipo`: naturaleza contable.
- `rubro_nif`: clasificación normativa.
- `activo`: vigencia de la cuenta.
- `sincronizado_el`: última observación en una fuente CONTPAQ.

No se crea una FK autorreferencial dura sobre `cta_sup`, porque el orden del archivo no garantiza que el padre sea procesado antes que el hijo.

La fuente de catálogo contiene registros por token. Los registros `RF` deben ligarse por posición a la cuenta `C` inmediatamente anterior; un parser que filtre primero por tipo de token destruiría esa relación.

## Semántica de re-sincronización

La carga debe ser idempotente y re-sincronizable:

1. Resolver la empresa de destino por identidad estable; nunca copiar el UUID de DEV a PROD.
2. Marcar el inicio de una sincronización.
3. Hacer `upsert` de cada cuenta por `(company_id, code)`.
4. Actualizar nombre, árbol, naturaleza, rubro, `activo = true` y `sincronizado_el`.
5. No borrar cuentas ausentes: marcarlas `activo = false` para conservar histórico.
6. Reportar cuentas nuevas como resultado visible.
7. Reportar movimientos que apunten a cuentas desconocidas.
8. Aplicar los 87 mapeos después de validar que las 63 cuentas objetivo son elegibles.

La necesidad de re-sincronización ya está comprobada: entre junio y julio apareció la cuenta `206-01-104-000 Inmobiliaria Cresana`, asociada a MXN 272,272 de anticipo de cliente, que no existía en el catálogo previo.

## Estado real después de aplicar el DDL en DEV

La migración fue aplicada sin cargar ni borrar filas:

| Control | Resultado DEV |
|---|---:|
| Cuentas antes/después | 1,646 / 1,646 |
| Mapeos antes/después | 87 / 87 |
| Cuentas distintas mapeadas | 63 |
| `needs_review` | 6 |
| Filas con árbol enriquecido | 0 |
| Cuentas elegibles para nuevos mapeos | 0 |

El cero de elegibilidad es intencional y fail-closed. Los registros preexistentes de DEV solo contenían código, nombre, `is_detail` y grupo SAT; no incluían `cta_sup`, `cta_mayor`, `tipo` ni `rubro_nif`. Hasta que el catálogo real sea re-sincronizado con esos campos, el trigger impide crear o cambiar un mapeo.

## Guardas de integridad

La vista `contpaq_account_mapper_candidates` es `security_invoker` y calcula:

- `es_hoja`: no existen cuentas cuyo `cta_sup` sea el código evaluado.
- `elegible_mapper`: cuenta activa, sincronizada, `cta_mayor = 2`, `tipo = G` y hoja.

El trigger `budget_account_mappings_eligible_guard` rechaza:

- cuenta inexistente;
- catálogo sin árbol o naturaleza;
- cuenta inactiva;
- cuenta que no sea detalle;
- cuenta que no sea gasto;
- cuenta con descendientes.

El mismo trigger fija `updated_at` y, cuando existe sesión autenticada, deriva `updated_by` del perfil actual; el navegador no puede atribuir el cambio a otro usuario.

## RLS

- `contpaq_accounts`: lectura para SysAdmin o Administración/Finanzas con membresía activa; escritura únicamente mediante rol privilegiado de sincronización.
- `budget_account_mappings`: lectura y CRUD para SysAdmin o Administración/Finanzas con membresía activa.
- Dirección no aparece en las políticas.
- Ambas tablas tienen RLS habilitada y forzada.
- La vista utiliza `security_invoker = true` para respetar RLS de las tablas base.

## Gate de carga PROD

La migración y la carga a PROD están autorizadas, pero no forman parte de este PR mientras siga vigente `NO_PROD_MERGE_YET`.

El artefacto enriquecido con las 1,646 cuentas, árbol y rubros no fue localizado en el repositorio conectado, la biblioteca de archivos ni los adjuntos de las tareas consultadas. Por seguridad, no se reconstruyen `cta_sup`, `cta_mayor`, `tipo` ni `rubro_nif` por longitud de código, nombre o heurística.

Antes de la carga PROD deben existir y quedar versionados:

- archivo fuente o fixture enriquecido de Operadora;
- manifest con SHA-256, conteos y fecha de sincronización;
- semilla de 87 mapeos con método, razón y `needs_review`;
- resolución explícita del `company_id` de Operadora en PROD;
- precheck y postcheck de 1,646 / 87 / 63 / 6;
- validación 63/63 de existencia, hoja, detalle y gasto;
- rollback lógico que inactive la sincronización sin borrar histórico.
