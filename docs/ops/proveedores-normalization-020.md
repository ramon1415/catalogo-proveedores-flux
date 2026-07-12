# Normalizacion canonica de proveedores (migration 020)

## 1. Objetivo

Normalizar `public.proveedores` sin mover datos a `public.providers`, reforzar las reglas fiscales y bancarias, mantener compatibilidad con la aplicacion actual y detener la aplicacion completa ante datos ambiguos.

## 2. Alcance

- RFC opcional, normalizado y unico.
- CLABE opcional, normalizada, validada y unica.
- Unicidad de banco + cuenta cuando no existe CLABE.
- Alias obligatorio y unico, con generacion server-side cuando no se informa.
- Nueva columna nullable `persona_tipo`.
- RLS acotado a los roles usados por la aplicacion.
- Prechecks y postchecks transaccionales.

## 3. Fuera de alcance

- Migrar, poblar o sincronizar `public.providers`.
- Modificar `provider_bank_accounts` o `payment_requests.provider_id`.
- Hacer dual-write o crear triggers hacia `providers`.
- Depurar, borrar, fusionar o reactivar proveedores.
- Limpiar usuarios, roles o tickets.
- Crear un importador CSV.
- Aplicar SQL, `db push` o `migration repair` desde este PR.

## 4. Tabla canonica

`public.proveedores` permanece como fuente canonica. Solicitudes, layouts y conciliaciones conservan sus referencias actuales a `proveedores.id`.

## 5. Estado de `providers`

`public.providers`, `public.provider_bank_accounts` y `public.proveedor_provider_links` quedan congeladas. Migration 020 no agrega dependencias, datos, foreign keys ni sincronizacion hacia esas tablas.

## 6. RFC

El RFC es opcional. Una cadena vacia se convierte a `NULL`; cualquier valor informado se guarda como `upper(trim(rfc))`.

La expresion aplicada es:

```regex
^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$
```

Admite RFC de persona moral (12 caracteres), persona fisica (13 caracteres), `&` y `Ñ` en el bloque inicial. No se eliminan guiones ni espacios internos de forma silenciosa: esos valores abortan para revision.

La unicidad se aplica a todos los proveedores, activos e inactivos, mediante `proveedores_rfc_normalized_uidx` sobre `upper(btrim(rfc))` cuando el RFC no es `NULL`.

## 7. CLABE

La CLABE es opcional. Se permiten digitos y separadores esperados (espacios o guiones); al guardar se eliminan esos separadores. El resultado debe contener exactamente 18 digitos.

Letras, puntuacion distinta de guion o cualquier valor ambiguo provoca error. La unicidad incluye registros activos e inactivos mediante `proveedores_clabe_normalized_uidx`.

## 8. Banco + cuenta

Cuando `clabe IS NULL` y existen banco y cuenta, la identidad bancaria secundaria es:

```text
lower(colapsar_espacios(trim(banco))) + lower(colapsar_espacios(trim(cuenta_bancaria)))
```

La migracion no elimina caracteres de la cuenta. Solo recorta extremos y colapsa espacios internos. La expresion evita falsos duplicados de un mismo numero entre bancos diferentes, pero no resuelve variantes semanticas del nombre de un banco; esas variantes requieren un catalogo bancario futuro.

## 9. Precedencia de deduplicacion

1. RFC, cuando existe.
2. CLABE, cuando existe.
3. Banco + numero de cuenta, cuando no existe CLABE.
4. Nombre, razon social y alias se usan para presentacion y revision manual, no como identidad fiscal.

## 10. Alias automatico

`alias` conserva sus reglas `NOT NULL` y `UNIQUE`. Adicionalmente, `proveedores_alias_normalized_uidx` evita diferencias solo por mayusculas o espacios repetidos.

- Un alias informado se recorta y conserva. Si ya existe de forma normalizada, la escritura falla con `alias_duplicado`.
- Un alias vacio se deriva de `nombre_completo`, luego `beneficiary_name` y finalmente `PROVEEDOR`.
- El alias generado se limita a 120 caracteres por operabilidad, aunque la columna real es `text` sin limite declarado.
- Ante colision se agrega `-` y los primeros ocho caracteres estables del UUID.
- No hay loops ni cambios silenciosos a aliases proporcionados.
- Los aliases historicos no se reescriben durante el despliegue; un alias vacio o duplicado hace fallar el precheck.

## 11. `persona_tipo`

Se agrega `persona_tipo text NULL`. Los valores almacenados son exclusivamente:

- `fisica`
- `moral`
- `NULL`

Entradas como `física`, `persona física` y `PF` se normalizan a `fisica`; `persona moral` y `PM` se normalizan a `moral`. Los registros historicos quedan `NULL` si no traen el dato; no se infiere desde el RFC.

La columna queda conceptualmente preparada para un futuro mapeo a `providers.provider_type`, sin crear hoy esa dependencia.

## 12. RLS y privilegios

Estado real anterior encontrado en DEV:

- SELECT: policy legacy `Autenticados pueden leer proveedores`, declarada para `public` y condicionada a `auth.role() = 'authenticated'`.
- INSERT: cualquier `authenticated` (`with check true`).
- UPDATE: cualquier `authenticated` (`using/with check true`).
- Privilegios de tabla: el grant global de migration 004 incluye operaciones que la pantalla no necesita.

La policy SELECT legacy no estaba reflejada en migration 004. Migration 020 la reconoce de forma explicita en el precheck y la elimina antes de crear `proveedores_select_members`; no se acepta ninguna policy desconocida de manera generica.

Estado posterior:

| Operacion DB | Policy | Roles funcionales |
| --- | --- | --- |
| SELECT | `proveedores_select_members` | `flux_member_roles()` |
| INSERT | `proveedores_insert_members` | `flux_member_roles()` |
| UPDATE | `proveedores_update_managers` | `flux_approver_roles()` |
| DELETE | Sin policy y sin grant | Ninguno desde frontend |

La matriz funcional completa queda asi:

| Accion | Solicitante/Operacion | Finanzas/Direccion/Sysadmin |
| --- | --- | --- |
| Consultar proveedores | Si | Si |
| Alta basica | Si | Si |
| Editar datos fiscales o bancarios | No | Si |
| Cargar o reemplazar CSF | No | Si |
| Desactivar o reactivar | No | Si |
| DELETE fisico | No | No desde frontend |

La alta basica para miembros conserva "Agregar proveedor" desde solicitudes sin conceder administracion posterior. La edicion, baja logica y administracion de CSF quedan restringidas a Finanzas, Direccion y Sysadmin, coherente con `FluxAuth.canManageProviders()` y con la policy de UPDATE. Los nombres `treasury`, `tesoreria` y `administracion` son aliases tecnicos heredados comprendidos dentro del grupo funcional Finanzas; no representan roles de negocio nuevos. `anon` pierde privilegios de tabla. No se usa `service_role` en frontend.

En el catalogo, un miembro operativo conserva el alta basica, pero ve los registros en modo de solo lectura. El selector de CSF queda deshabilitado con el mensaje "La Constancia de Situacion Fiscal sera administrada por Finanzas". La proteccion visual complementa RLS: manipular el frontend no permite editar, desactivar ni vincular una CSF.

La migracion aborta si detecta una policy de `proveedores` no reconocida, para no eliminar silenciosamente una regla creada fuera del historial versionado.

## 13. Prechecks

Antes de normalizar o crear indices se comprueba:

- existencia de `public.proveedores`;
- policies reconocidas;
- aliases vacios o duplicados normalizados;
- RFC invalidos o duplicados normalizados;
- CLABE ambiguas, invalidas o duplicadas;
- duplicados banco + cuenta cuando no hay CLABE;
- valores de `persona_tipo` no normalizables.

Cada hallazgo lanza `RAISE EXCEPTION` con una muestra de hasta 25 casos. La transaccion completa hace rollback; no se borran ni fusionan registros.

## 14. Postchecks

La migration valida dentro de la misma transaccion:

- columna `persona_tipo` presente;
- cuatro indices unicos presentes;
- tres policies RLS presentes;
- trigger de normalizacion presente y habilitado.

Validacion manual posterior recomendada:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'proveedores'
  and column_name = 'persona_tipo';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'proveedores'
order by indexname;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'proveedores'
order by policyname;
```

## 15. Recuperacion

La aplicacion inicial es atomica. Si un precheck o una sentencia falla, PostgreSQL revierte la migration completa.

Si se requiere revertir despues de una aplicacion exitosa, se debe preparar una migration nueva y revisada que:

1. restaure las policies anteriores solo si negocio acepta de nuevo su amplitud;
2. retire el trigger y los indices de migration 020;
3. retire los CHECK constraints;
4. conserve `persona_tipo` mientras contenga datos, o exporte esos datos antes de retirarla.

No ejecutar rollback destructivo manual ni editar migration 020 una vez promovida.

## 16. Respaldo existente

Migration 020 no referencia, modifica, elimina ni reconstruye `zzbackup_proveedores_20260709`. Tampoco repite la depuracion previa.

## 17. Aplicacion primero en DEV

1. Confirmar backup DEV vigente.
2. Revisar los prechecks en modo read-only si se desea anticipar bloqueos.
3. Aplicar exclusivamente migration 020 mediante el proceso autorizado.
4. Ejecutar los postchecks.
5. Validar alta, edicion, baja logica, CSF y seleccion de proveedor.
6. No promover mientras exista un hallazgo de datos o RLS.

## 18. Validaciones DEV antes de PROD

- Alta con alias informado.
- Alta sin alias y verificacion del alias generado.
- Rechazo claro de alias duplicado.
- RFC vacio a `NULL`, RFC valido normalizado y RFC invalido rechazado.
- CLABE con espacios/guiones normalizada y CLABE invalida rechazada.
- Duplicados RFC, CLABE y banco+cuenta rechazados incluso si el registro existente esta inactivo.
- `persona_tipo` normalizado para PF/PM y variantes con acento.
- Edicion permitida para roles administradores y denegada para roles operativos.
- Alta rapida permitida a un miembro autorizado.
- Alta basica desde Operacion sin UPDATE posterior ni intento de carga CSF.
- Catalogo abierto directamente por Operacion: filas de solo lectura, CSF deshabilitada y UPDATE denegado por RLS.
- Alta desde catalogo por Finanzas/Direccion/Sysadmin con carga y vinculacion de CSF.
- Reemplazo de CSF permitido solo a Finanzas/Direccion/Sysadmin.
- Baja logica con `activo=false`.
- CSF: carga, reemplazo y signed URL.
- Solicitud, layout BBVA/interbancario, efectivo y comprobantes sin regresion.

PROD requiere backup confirmado, evidencia del resultado DEV, auditoria de duplicados en read-only y autorizacion separada.

## 19. Columnas del CSV del cliente

| Columna cliente | Columna real | Regla |
| --- | --- | --- |
| `razon_social` | `nombre_completo` | Texto de presentacion; no identidad fiscal. |
| `alias` | `alias` | Opcional en carga; DB lo genera si falta. |
| `rfc` | `rfc` | Opcional; formato mexicano y unico. |
| `persona_tipo` | `persona_tipo` | `fisica`, `moral` o vacio. |
| `metodo_pago` | `metodo_pago` | Debe coincidir con el enum vigente. |
| `banco` | `banco` | Requerido para destino bancario. |
| `cuenta` | `cuenta_bancaria` | No eliminar caracteres; revisar formato. |
| `clabe` | `clabe` | Opcional; 18 digitos. |
| `tipo_cuenta` | `tipo_cuenta` | `CLABE`, `Cuenta` o vacio segun destino. |
| `correo` | `email` | Opcional. |
| `telefono` | `telefono` | Opcional. |
| `direccion` | Sin columna canonica actual | No importar; conservar en fuente hasta definir campo. |
| `activo` | `activo` | Booleano; baja logica. |
| `constancia_situacion_fiscal` | `csf_file_path` | Ruta privada de Storage; nunca binario ni signed URL. |

Campos operativos adicionales a considerar: `destination_type`, `beneficiary_name`, `convenio_number`, `tipo_proveedor` y `notas`.

## 20. Casos a corregir antes de importar

- RFC o CLABE duplicados.
- RFC fuera de la expresion documentada.
- CLABE con letras o longitud distinta de 18.
- Cuenta sin banco cuando no existe CLABE.
- Alias explicito duplicado.
- `persona_tipo` fuera del catalogo permitido.
- Metodo de pago o tipo de cuenta fuera de los valores vigentes.
- Ruta CSF publica, signed URL o contenido binario en lugar de `csf_file_path`.
- Direccion sin columna destino aprobada.

La carga del CSV y cualquier correccion de datos requieren un proceso posterior expresamente autorizado; migration 020 no importa registros.
