# CONTPAQ Mapper — carga de semilla y UAT DEV

Fecha de ejecución: 2026-08-24  
Proyecto Supabase: `scsirgbuqjcwoaxfacth`  
Empresa DEV: `Operadora Tlacatecpan`  
`company_id`: `9680353c-9b86-4730-82e1-fce664f048a2`  
PR: `#410`  
Estado: `PASS / DEV_SEED_AND_UAT_COMPLETE / PROD_UNTOUCHED`

## 1. Alcance del gate

Este gate se limitó a:

1. verificar los artefactos versionados de catálogo y mapeos;
2. cargar y re-ejecutar la semilla de Operadora únicamente en DEV;
3. validar estructura de árbol, elegibilidad y ausencia de doble conteo;
4. validar RLS, permisos de lectura/escritura y pruebas negativas;
5. conciliar el Dashboard anual con las cifras previamente verificadas;
6. preservar las seis banderas `needs_review` sin inventar razones formales.

No se hizo merge a `main`, no se aplicó DDL en PROD y no se cargaron datos en PROD.

## 2. Artefactos de origen

Commit de semilla copiado a la rama del PR:

```text
4f56c254984e0e42bea37e1d41772d1a7c9ca50f
```

Carpeta:

```text
supabase/seed/contpaq/
```

Archivos utilizados para Operadora:

| Archivo | SHA-256 verificado |
|---|---|
| `catalogo_operadora.csv` | `8a461f10752b4eed82df2d336934b21056de5684b22e573fee492654bf5707c6` |
| `catalogo_operadora.sql` | `3c68d1579e68b694975d460325d156226d93a46986036c35afbce1d7e77ba4a8` |
| `mapeos_operadora.csv` | `827ee2cab2e42f4f7c37fab715c2dc3750bbb621a176909fc79be9a72d63e55a` |
| `mapeos_operadora.sql` | `abb102d2c0469a5baafda3ab7f50201afad01889bfa7bdc394291eabc140bd23` |

GitHub Actions verificó los hashes y produjo el artefacto:

```text
workflow run: 32789869991
artifact id: 9542741310
artifact digest: sha256:f4d9fb918224dbd7f4d0824d1bc00b531bae1ec81194353b764c6b4194f08971
```

La carga se ejecutó desde los contenidos versionados después de volver a validar en el servidor DEV los hashes del SQL de catálogo y del CSV de mapeos.

### Límite de verificación

Se verificó:

- integridad de las salidas copiadas;
- conteos;
- consistencia estructural;
- doble ejecución funcional idempotente.

No se volvió a ejecutar en este gate el generador original contra los `.xls` del repositorio externo de Carlos. Por tanto, no se reclama una verificación independiente del determinismo desde las fuentes originales; sí se verificó el determinismo funcional de la semilla versionada ya copiada.

## 3. Ajustes de esquema detectados durante el preflight

### 3.1 Evidencia técnica separada de razón formal

Se agregó `mapping_evidence` para conservar observaciones reproducibles del seed sin presentarlas como una aprobación editorial de Finanzas.

Reglas:

- `mapping_evidence`: evidencia derivada y administrada por servidor;
- `mapping_reason`: razón formal capturada por un usuario autorizado;
- un usuario autenticado no puede insertar ni alterar `mapping_evidence`;
- para resolver `needs_review`, `mapping_reason` debe tener al menos ocho caracteres;
- un criterio nuevo sin evidencia versionada requiere razón formal.

### 3.2 Consistencia `cta_mayor` vs. hoja

El catálogo real contiene 97 cuentas con `cta_mayor = 2` que son agrupadoras con descendientes y, correctamente, tienen `is_detail = false`.

Se corrigió la regla incorrecta que trataba `cta_mayor = 2` como equivalente a cuenta terminal. El contrato válido es unidireccional:

```sql
NOT is_detail OR cta_mayor = 2
```

La condición de hoja continúa evaluándose por separado mediante `cta_sup`.

### 3.3 Gate de autorización antes del dominio

El trigger ahora verifica rol y membresía antes de consultar el catálogo. Así, Dirección u Operación reciben:

```text
contpaq_mapper_company_access_denied
```

y no un error engañoso de “cuenta no encontrada”.

## 4. Migraciones DEV relacionadas

```text
20260824212048 historical_actuals_sysadmin_rls
20260824213154 contpaq_mapper_schema_tree
20260824214309 contpaq_mapper_audit_hardening
20260824215209 contpaq_mapper_trigger_scope_hardening
20260824231800 contpaq_mapper_evidence_contract
20260824234000 contpaq_account_detail_tree_consistency
20260825001000 contpaq_mapper_trigger_access_gate
20260825002500 contpaq_mapping_evidence_server_managed
```

Todas fueron aplicadas únicamente en DEV.

## 5. Resultado de la carga

| Control | Resultado |
|---|---:|
| Cuentas Operadora | 1,646 |
| Marcadas `is_detail` | 1,402 |
| Con `cta_sup` | 1,646 |
| Con `tipo` | 1,646 |
| Con `rubro_nif` | 1,440 |
| Con `sincronizado_el` | 1,646 |
| Agrupadoras nivel 2 | 97 |
| Agrupadoras nivel 2 con hijos | 97 |
| Mapeos | 87 |
| Cuentas distintas mapeadas | 63 |
| Método `exact_name` | 22 |
| Método `judgment` | 65 |
| `needs_review` | 6 |
| Con `mapping_evidence` | 87 |
| Con razón formal | 0 |
| Mapeos inválidos | 0 |

## 6. Idempotencia funcional

La misma semilla fue aplicada dos veces. Se compararon huellas de negocio excluyendo timestamps de sincronización y auditoría.

```text
catalog_fingerprint = 0af590eeb4066058df9335aa81890262a17128085a2e5c3cf66ea78c8f51cddc
mapping_fingerprint = 3d3b34824c21a47b3d0c09bf12537c2f2dc9aedf28e19775905dfe905eb996dc
```

Resultado:

```text
PASS / FUNCTIONAL_IDEMPOTENCE
```

## 7. Validación del árbol y doble conteo

Las 63 cuentas distintas utilizadas por los 87 mapeos cumplen:

- existen en el catálogo;
- están activas;
- tienen `sincronizado_el`;
- son `cta_mayor = 2`;
- están marcadas `is_detail = true`;
- son naturaleza `G`;
- no tienen descendientes.

Rollup por los dos renglones superiores del estado financiero:

| Cuenta superior | Nombre del catálogo | Cuentas distintas |
|---|---|---:|
| `60200000000` | `Admministración RSJT` | 59 |
| `60300000000` | `Gastos de administración` | 4 |

Total: 63.

## 8. UAT de permisos

### Lectura

| Perfil | Histórico | Catálogo | Mapeos | Candidatos elegibles |
|---|---:|---:|---:|---:|
| SysAdmin | 1,280 | 1,646 | 87 | 694 |
| Administración/Finanzas con membresía | 0 | 1,646 | 87 | 694 |
| Dirección | 0 | 0 | 0 | 0 |
| Operación | 0 | 0 | 0 | 0 |

Esto confirma:

- `historical_actuals` permanece exclusivo de SysAdmin;
- Administración/Finanzas puede operar el mapper dentro de su empresa;
- Dirección y Operación quedan fuera.

### Escritura

| Prueba | Resultado |
|---|---|
| Administración crea y elimina un mapeo válido | PASS |
| Administración cambia agrupación presupuestal | PASS |
| Administración intenta modificar catálogo CONTPAQ | BLOQUEADO |
| Dirección intenta crear mapeo | BLOQUEADO |
| Dirección intenta cambiar agrupación | 0 filas afectadas |
| Operación intenta crear mapeo | BLOQUEADO |

Todos los cambios sintéticos fueron ejecutados dentro de transacciones revertidas.

## 9. UAT de candados

| Prueba | Error esperado | Resultado |
|---|---|---|
| Cuenta inexistente | `contpaq_mapping_account_not_found` | PASS |
| Cuenta inactiva | `contpaq_mapping_account_inactive` | PASS |
| Cuenta sin sincronización | `contpaq_catalog_tree_metadata_incomplete` | PASS |
| Cuenta no detalle | `contpaq_mapping_account_not_detail` | PASS |
| Cuenta no gasto | `contpaq_mapping_account_not_expense` | PASS |
| Cuenta con descendientes | `contpaq_mapping_account_has_children` | PASS |
| Criterio sin evidencia ni razón | `contpaq_mapping_evidence_required` | PASS |
| Mapeo válido | Insert/delete | PASS |
| Resolver review sin razón formal | `contpaq_mapping_review_reason_required` | PASS |
| Resolver review con razón formal | Update | PASS |
| Navegador intenta insertar evidencia | `contpaq_mapping_evidence_server_managed` | PASS |
| Navegador intenta alterar evidencia | `contpaq_mapping_evidence_server_managed` | PASS |
| Navegador captura razón formal | Update | PASS |

## 10. Dashboard anual

Las cifras de `historical_actuals` continúan conciliando con la evidencia independiente documentada:

| Periodo | Familia | Total |
|---|---|---:|
| 2025 | Ingresos 4xx | 9,062,481.38 |
| 2025 | Gastos 6xx | 9,286,961.57 |
| 2026 YTD julio | Ingresos 4xx | 6,775,863.01 |
| 2026 YTD julio | Gastos 6xx | 6,862,629.43 |

2024 permanece sin verificación independiente.

La vista debe mantener el copy:

```text
por familia de cuenta contable
```

La diferencia de MXN 7,943 frente a la presentación de César corresponde a clasificación entre todo 4xx e ingreso operativo, no a una discrepancia del ledger.

## 11. Seis revisiones pendientes de Finanzas

| Partida | Cuenta | Evidencia técnica |
|---|---|---|
| Carga Social (IMSS, Infonavit, AFORES) | Cuota Patronal IMSS | tokens compartidos: imss |
| Gastos extraordinarios | Gastos Corporativos | tokens compartidos: gastos |
| Identificadores | Apoyo a personal | asignación conceptual |
| ISR | Impuestos | asignación conceptual |
| Servicios de Personal | Worky | asignación conceptual |
| Servicios y suministros | Consumibles Campo | asignación conceptual |

Las seis conservan:

```text
needs_review = true
mapping_reason = null
```

No se inventaron razones. Para retirar la bandera, Finanzas deberá capturar una razón formal que quedará auditada.

## 12. Interfaz

El mapper ahora muestra por separado:

- evidencia técnica del seed, de solo lectura;
- razón formal de Finanzas, editable;
- bandera `needs_review`;
- método del mapeo.

El navegador ya no envía `updated_by` ni `updated_at`; ambos valores son fijados por el servidor.

## 13. Estado de producción

Sentinel de solo lectura al cierre del gate:

| Control | PROD |
|---|---:|
| `historical_actuals` | 1,280 |
| `contpaq_accounts` | No existe |
| `budget_account_mappings` | No existe |
| Migraciones nuevas | No aplicadas |
| Catálogo y mapeos | No cargados |

## 14. Resultado y siguiente gate

```text
PASS / DEV_SEED_LOADED /
PASS / FUNCTIONAL_IDEMPOTENCE /
PASS / DATABASE_AND_PERMISSION_UAT /
PASS / DASHBOARD_LEDGER_RECONCILIATION /
WAIT / SIX_FINANCE_REASONS /
NO_PROD_MERGE_YET
```

Antes de cualquier promoción:

1. revisión visual de Preview del Dashboard anual y del Mapper;
2. validación de las seis decisiones por Finanzas;
3. actualización de los PR apilados contra el `main` vigente;
4. plan de aplicación PROD con precheck, respaldo lógico, migraciones, semilla y postcheck;
5. autorización explícita de merge y promoción.
