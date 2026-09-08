# DEV: conciliación del historial y diferencia real de ingresos recurrentes

Estado actualizado 2026-09-08: **hardening puntual aplicado y verificado en DEV como 20260908000916**. La conciliación histórica y Supabase Preview siguen pendientes. El inventario del 7-sep se conserva como evidencia del diagnóstico previo.

Base revisada: `523f72baf7e8a1bbf273b52d5359d0d4830e8c79`. Inventario DEV `scsirgbuqjcwoaxfacth` capturado en transacción de solo lectura el **2026-09-07 23:49:03 UTC**, PostgreSQL 17.6. [Inventario y hashes](../qa/migration-history-dev-inventory-2026-09-07.json). Este archivo conserva evidencia de versiones; no sustituye un respaldo restaurable.

## Hallazgo que requiere SQL nuevo

La migración local `20260831120000_tenant_recurring_income.sql` contiene protecciones que el SQL registrado en DEV como `20260831194350` nunca incluyó. El catálogo actual confirma:

- `recurring_income_templates` y `tenant_income_entries` tienen RLS, pero `anon`, `authenticated` y `service_role` conservan permisos amplios, incluido `TRUNCATE`. RLS no restringe las operaciones que afectan toda la tabla ([PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)). Esto es un hallazgo de privilegios; no se ejecutó una prueba destructiva en DEV ni se afirma una vía de explotación HTTP.
- La FK actual sólo relaciona `template_id → recurring_income_templates.id`. Falta asegurar que ingreso y plantilla pertenecen a la misma empresa.
- El generador tiene `search_path=public` y carece del guard explícito `auth.uid() is null` presente en el repo.
- A las 23:37 UTC ambas tablas tenían **0 filas** y **0 referencias cruzadas**. Estos conteos deben repetirse inmediatamente antes de aplicar.

Se preparó `20260907234427_tenant_recurring_income_runtime_hardening.sql`, creada con `supabase migration new` (CLI 2.113.0). Su alcance es exactamente:

1. Añadir la clave única `(company_id,id)`, sustituir la FK simple por la compuesta y crear su índice de soporte en ingresos. Al eliminar una plantilla se conserva el ingreso y su empresa; sólo `template_id` queda vacío.
2. Retirar permisos de `PUBLIC`/`anon` y dejar CRUD a `authenticated`/`service_role` en **esas dos tablas**.
3. Reponer la definición del generador ya aprobada en el repo: sesión explícita, membresía y `search_path=public,pg_temp`.

La migración es transaccional, con límites de espera de bloqueo y duración. Una referencia cruzada existente provoca rollback; no se corrige ni elimina silenciosamente. Mantiene las políticas RLS, los datos y los respaldos. Reaplicarla conserva filas y políticas. No ejecuta el generador ni crea ingresos.

Pruebas: `scripts/qa/recurring-income-hardening.test.mjs` ejecuta el DDL histórico real y el SQL propuesto en PostgreSQL 17.5 aislado mediante PGlite 0.3.16. Ocho casos verifican permisos, FK entre empresas incluso con BYPASSRLS, membresía, sesión ausente, generación idempotente, borrado de plantilla sin borrar ingreso, repetición de la migración y rollback ante datos incompatibles. Los helpers de autenticación/membresía son fixtures: no sustituye pruebas de sesión en Supabase.

Validación local: TypeScript, Vite y artifact estático correctos; suite con artifact: **1077 pasan, 0 fallas, 0 omitidas**. Los ocho casos de la migración se repitieron después de añadir el índice de soporte. [Evidencia previa de DEV a las 23:53:39 UTC](../qa/recurring-income-runtime-before-2026-09-07.json): confirma que la corrección todavía no está aplicada y que las dos tablas siguen vacías.

## Inventario de versiones

| Grupo | Cantidad | Tratamiento |
|---|---:|---|
| Versiones presentes con el mismo número | 75 | Conservar. El número por sí solo no prueba que el texto SQL sea idéntico. |
| Mismo nombre con otra fecha | 23 | 20 candidatos a renombre sin diferencia de instrucciones; tres requieren la revisión de contenido indicada abajo. |
| Segunda ejecución de la misma corrección | 1 | Conservar evidencia de ambas ejecuciones; no borrar la fila duplicada por conveniencia. |
| Cambios antiguos presentes sólo en DEV | 4 | Recuperar fuente y orden; algunos fueron reemplazados por versiones v2. |
| Borrado histórico de respaldos | 1 | Fuera de la cadena que pueda volver a ejecutarse; cualquier ajuste del registro requiere autorización. |
| Nómina del PR #568, aún fuera de DEV en Git | 3 | Coordinar los nombres antes de integrar su SQL; no copiar la lógica de un PR pendiente como si estuviera revisada. |
| **Total registrado en DEV** | **107** | **100 archivos en la base del repo; 32 versiones remotas sin archivo con el mismo número, 25 archivos locales sin ese número remoto.** |

La nueva migración de este PR no se incluye en esos 100 archivos históricos. Fue autorizada como `20260907234427` y quedó registrada en DEV como **`20260908000916`**; el archivo ahora usa la versión efectiva, con exactamente el mismo contenido. DEV pasó de 107 a 108 registros.

### Mapa de los 23 nombres con fechas distintas

Los destinos son las versiones que DEV ya registró. Los nombres locales y su contenido aún no se cambian en este PR: los renombres se ejecutarán como un conjunto revisado junto con la recuperación de fuentes, para preservar dependencias y consumidores que usan rutas exactas.

| Archivo local: versión | Versión DEV | Nombre / decisión |
|---|---|---|
| 20260827202122 | 20260827203337 | payment_batch_bbva_padded_source_account_hotfix — idéntico |
| 20260827225332 | 20260827231155 | payroll_active_company_scope — idéntico |
| 20260827231436 | 20260827232110 | payroll_service_role_claim_compat — idéntico |
| 20260831003419 | 20260831004813 | fersana_company_access_onboarding — revisar guards/seed; conservar mejoras posteriores |
| 20260831005200 | 20260831004957 | fersana_company_access_advisor_hardening — idéntico |
| 20260831033300 | 20260831033553 | operator_own_payment_requests — comentarios |
| 20260831120000 | 20260831194350 | tenant_recurring_income — requiere el hardening nuevo de este PR |
| 20260831155017 | 20260831195803 | notification_payment_outcome_dispatch_recovery_dev — idéntico |
| 20260831201500 | 20260831201434 | notification_payment_outcome_authorized_retry_dev — idéntico |
| 20260831210159 | 20260831211229 | notification_dev_dynamic_business_recipients — idéntico |
| 20260831130000 | 20260831233032 | budget_category_responsible — comentarios |
| 20260901055111 | 20260901065625 | company_scoped_roles_foundation — override inicial distinto; hardening posterior confirmado en catálogo |
| 20260901062149 | 20260901071915 | company_scoped_rls_rpc_cutover — idéntico |
| 20260901063043 | 20260901071923 | company_scoped_rpc_cutover — idéntico |
| 20260901070846 | 20260901071929 | company_scoped_power_override_hardening — idéntico |
| 20260901180000 | 20260901102134 | desglose_fiscal_subtotal_budget — comentarios; debe preceder el patch UUID |
| 20260902030000 | 20260902041542 | fix_extraordinary_execution_context_recursion — idéntico; segunda ejecución 20260903023224 |
| 20260903014009 | 20260903015237 | budget_category_shared_access — comentarios |
| 20260907174500 | 20260907173216 | payroll_provision_pending_does_not_block_dev — comentarios |
| 20260907120000 | 20260907184613 | payroll_folio_en_materializacion — comentarios y envoltura transaccional; revisar orden de reemplazos de funciones |
| 20260907161500 | 20260907221608 | payroll_capture_file_download_context_dev — idéntico; sufijo `_dev` remoto |
| 20260907164000 | 20260907225200 | payroll_nonbudget_finance_confirm — comentarios |
| 20260907164100 | 20260907225213 | payroll_finance_confirm_trigger_safe — salto de línea |

El SQL del onboarding aplicado originalmente omite cuatro guards de sesión del repo e incluye un seed de Fersana que el repo difiere a otra etapa. DEV tiene mejoras posteriores en `request_company_access`, `approve_company_access_request` y `list_company_access_requests`; no debe reponerse la función antigua completa. La diferencia restante de guards debe tratarse sobre las definiciones vigentes, sin perder el comportamiento de reapertura de solicitudes.

### Entradas sin pareja y módulos sin versión registrada

| Versión | Situación | Acción pendiente |
|---|---|---|
| 20260901171427 | invoice_uuid_anti_duplicado | Recuperar la fuente, después de la migración fiscal; el índice UUID sí existe actualmente. |
| 20260903023224 | Segunda ejecución idéntica de extraordinary recursion | Mantener evidencia y decidir su representación histórica; no reejecutar el fix en DEV. |
| 20260903035514 | partida_predictions | Recuperar fuente y verificar su sucesora 20260903213133. |
| 20260903040733 | partida_unsure_flag | Recuperar fuente y verificar su sucesora 20260903213224. |
| 20260903041629 | confirm_provider_account_rpc | Recuperar fuente y verificar su sucesora 20260903213236. |
| 20260906003626 | drop_backup_tables | SQL histórico con borrado por patrón: **no importar a migrations ni ejecutar**. Respaldos siguen en tarea 86bbw39a5. |
| 20260907232403 | payroll_confirmation_weekly_cut_bridge | En #568 como 20260907173000; renombrar a la versión DEV. |
| 20260907232743 | payroll_direct_finance_confirmation_snapshot | En #568 como 20260907173100; renombrar a la versión DEV. |
| 20260907233050 | payroll_weekly_cut_submit_bridge | En #568 como 20260907173200; renombrar a la versión DEV. |
| 20260827090000 local | platform_module_incidencias | Módulo y release 1 existen; habilitado sólo para Operadora. No reejecutar el guard de una empresa: DEV tiene seis. |
| 20260827100000 local | platform_module_nomina | Módulo y release 1 existen; habilitado actualmente en Operadora/Fersana. Preservar activaciones posteriores. |

El SQL de las tres migraciones de #568 se comparó con sus ejecuciones remotas y coincide al omitir comentarios/formato. Su lógica de negocio y su integración siguen siendo responsabilidad de la revisión de #568.

### Diferencias con número coincidente

Se contrastaron 98 pares de textos, incluyendo una ejecución duplicada y excluyendo el baseline: 28 coinciden en bytes y 88 tras comparación léxica que omite formato/comentarios/envolturas. Esta normalización sirve para localizar diferencias, no certifica equivalencia semántica.

- Registro de módulos: el SQL inicial remoto tiene políticas `FOR ALL` e índice distinto; la migración posterior de hardening los corrige. El catálogo actual confirma políticas separadas y `company_modules_module_version_idx`.
- FB-Integración `20260902200000` y `20260902201500`: el ledger guarda comentarios de registro, no el SQL completo. Las dos FKs compuestas y el índice de reversa sí se confirmaron en el catálogo. **No sustituir los archivos ejecutables del repo por esos comentarios.**
- Histórico financiero: la política transitoria varía en casts explícitos; existe una sustitución posterior. El backfill remoto de `flujo` por prefijo no está en el repo; conservar la decisión de no reclasificar datos por prefijo al reconstruir.
- Los textos de dispatcher/graph reviews contienen diferencias de formato, comentarios o metadatos que la comparación conservadora señala para revisión. No se infiere una regresión de negocio ni se reemplazan funciones vigentes por versiones antiguas.
- El baseline tiene statements divididos por la CLI; no se auditó su equivalencia semántica en este corte.

## Ejecución autorizada del hardening — 8 de septiembre

Ramón autorizó aplicar únicamente el hardening preparado en DEV, con snapshot previo y advisors/check de privilegios posteriores. Se ejecutó una vez y se registró como **20260908000916**. SHA-256 del SQL antes/después: `5a4882e14525e8b8a5999cc9a013ad1c6bd1a7ed97902ba3ff3e379bece01240`.

- Snapshot capturado a las 00:05:24 UTC; ZIP SHA-256 `b29bdd3295c93de20f27bd5894d520bcbded7e79d80578b1de1974478433cc17`, guardado antes de aplicar. Contiene datos/esquema/ACL de los dos objetos, función y ledger completo; no es un backup de todo Supabase. Reconstrucción, aplicación y restauración aislada del catálogo previo: PASS.
- Post-check a las 00:10:11 UTC: FK compuesta validada, ambos índices válidos y listos, RLS conservado, anon sin privilegios de tabla ni EXECUTE, auth/service con sólo CRUD y sin TRUNCATE. Generador con sesión explícita y `search_path=public,pg_temp`.
- Las dos tablas siguen con 0 filas. Inventario de 186 tablas idéntico; no se creó/eliminó ninguna tabla. Las 107 filas anteriores del ledger son idénticas al snapshot al comparar JSON por contenido; sólo se añadió esta migración con SQL exacto.
- Advisors: seguridad 242 → 242, sin entradas nuevas o retiradas. El aviso existente de [RPC SECURITY DEFINER accesible por usuarios autenticados](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) sigue siendo intencional: el RPC exige sesión y membresía.
- Rendimiento 329 → 330: sólo se añade [índice nuevo aún sin uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), nivel INFO, sobre `tenant_income_entries_company_template_idx`. Se conserva para dar soporte a la FK; ambas tablas están vacías. Los dos avisos previos de FK `created_by` sin índice permanecen fuera de este alcance.
- Se añadieron tres contratos al catálogo real de DEV para detectar una regresión futura de permisos, FK/índices o guard del generador. Catálogo capturado a las 00:12:34 UTC: **111 contratos pasan, 0 fallas, 0 omitidos**. Los ocho casos aislados también pasan después del renombre.
- [Evidencia de ejecución y comparación](../qa/pr569-dev-execution-2026-09-08.json). No se ejecutó migration repair ni otra migración. No se modificó PROD ni se tocó ningún respaldo.

## Secuencia de aplicación y cierre (plan histórico; pasos 1 y 2 completados)

1. **Aplicar sólo el hardening nuevo, cuando Ramón autorice DEV.** Snapshot recuperable previo de las dos tablas, definición/config/ACL de la función y ledger. Repetir los conteos y revisar el hash del archivo. Aplicación selectiva: no lanzar `db push --linked` sobre toda la cadena mientras existan los desajustes. Si el mecanismo de aplicación genera otro número, renombrar inmediatamente el archivo a ese número efectivo antes del merge, como se hizo en #552; no crear una segunda ejecución para arreglar el nombre.
2. Ejecutar [pre/post de sólo lectura](../../scripts/qa/recurring-income-runtime-readonly.sql), advisors de seguridad/rendimiento y comparación de privilegios. Esperado: FK compuesta validada, `anon` sin CRUD/TRUNCATE/EXECUTE, auth/service con CRUD y sin TRUNCATE, generador con sesión explícita y search_path fijo, conteos sin cambio. Sólo entonces registrar el cierre del hardening.
3. Resolver la dependencia #568 y completar el conjunto de renombres/recuperaciones indicado arriba. Conservar los archivos aprobados y documentar las diferencias reales con correcciones hacia adelante.
4. Preparar el snapshot íntegro de las filas afectadas de `supabase_migrations.schema_migrations`. Candidatos de reparación **sujetos a aprobación específica**: marcar los dos módulos locales como ya aplicados, una vez revalidado el estado; retirar únicamente del ledger activo la ejecución histórica `20260906003626` después de archivar su fila completa como evidencia de mantenimiento. Retirar del ledger no revierte el SQL que se ejecutó ni recupera tablas. No se ejecuta el SQL de borrado y no se tocan respaldos.
5. Revisar y autorizar la lista exacta de `migration repair`; abortar si el ledger cambia durante la ventana. El mandato de [supabase-cli-migrations.md](supabase-cli-migrations.md) exige autorización explícita para este comando. Este PR no la presume ni ejecuta reparaciones.
6. Verificar igualdad de versiones, `db push --dry-run` sin migraciones históricas pendientes, suite, advisors y Supabase Preview exitoso en el commit integrado. Ningún guard se desactiva para lograr el cierre.

La reconstrucción aislada del baseline y las siguientes cuatro migraciones pasa en PGlite 0.3.16 / PostgreSQL 17.5. Se detiene de nuevo en `047_precheck: public layout contract drifted`, igual que la sonda anterior con PGlite 0.5.8. Por tanto, no basta atribuirlo a un cambio de versión mayor: falta comparar el contrato exacto y la captura del baseline. No se eludió el guard ni se declara validada la reconstrucción completa.

## PROD y exclusiones

PROD (`ucantptjhwttexzmslvm`) conserva 118 versiones de una cadena histórica distinta; sólo tres números coinciden con la base activa de DEV. Requiere su propia reconciliación revisada. No aplicar el baseline DEV ni correr un push general a PROD. `main` sigue en `b998919341b1e337f0cc2a7b7d31b289b4944e7c`.

La migración de seguridad #552 permanece canónica en `20260907171549`. No se consultaron datos de negocio de PROD en esta revisión. El único cambio de ambiente fue el hardening autorizado en DEV, documentado arriba. No se enviaron mensajes a Carlos y no se ejecutó ninguna limpieza de respaldos.
