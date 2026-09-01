# Corte de autorización por empresa

Este documento describe el gate técnico posterior a la fundación de roles por
empresa. No autoriza aplicar SQL, modificar PROD ni asignar identidades.

## Dependencia

La migración `20260901062149_company_scoped_rls_rpc_cutover.sql` depende de
`20260901055111_company_scoped_roles_foundation.sql`. Por eso el PR de corte se
mantiene apilado sobre la rama del PR #475 hasta que la fundación sea aprobada.

## Ola 1 preparada

- Solicitudes de pago: Operador sólo ve/modifica las propias; Finanzas y
  Director ven la empresa correspondiente.
- Hechos CFDI y autorizaciones extraordinarias heredan el `company_id` de la
  solicitud padre.
- Ingesta de pagos, configuración de cortes, cuentas bancarias, incidencias y
  directores usan el rol de la membresía exacta.
- CONTPAQ y las tablas privadas de Nómina exigen Finanzas en la empresa exacta.
- SysAdmin conserva el override global definido por la fundación.

## Ola RPC preparada

- Los RPC heredados de conciliación, ejecución, detalle de cortes, CONTPAQ y
  almacenamiento reemplazan sus checks globales por el rol de la empresa.
- Cada reemplazo valida firma y cantidad exacta de predicados; cualquier drift
  aborta la migración antes de aplicar un cambio parcial.
- El preflight distingue un check global SysAdmin intencional de un check
  global de negocio (Finanzas, Director u Operador).

## Pendiente antes del GO

1. Ejecutar pruebas SQL con dos empresas y cuatro perfiles: Operador, Finanzas,
   Director y SysAdmin; cada caso debe incluir allow y deny cruzado.
2. Ejecutar advisors de seguridad/performance en DEV después de aplicar las
   migraciones, con autorización separada.
3. Ejecutar `paso1c-company-role-cutover-preflight.sql`; sólo un PASS permite
   preparar la matriz real de usuarios.

Estado actual: `NO-GO / CUTOVER_CODE_PREPARED / DEV_EXECUTION_PENDING / PROD_NOT_TOUCHED`.
