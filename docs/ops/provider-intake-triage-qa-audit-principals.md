# Principales QA de auditoría para triage de proveedores

## Propósito

`QA_TRIAGE_FINANCE_1` y `QA_TRIAGE_FINANCE_2` son identidades ficticias,
permanentes y exclusivas de Supabase DEV. Permiten ejecutar pruebas autenticadas
de concurrencia y dejan una referencia estable en `payment_intake.triaged_by` y
`payment_intake_events.actor_profile_id`.

No representan personas reales. No deben existir en PROD ni recibir privilegios
de administrador, sysadmin o acceso fuera del alcance de Fase 1D.

## Identificación

Cada usuario Auth conserva metadata:

- `qa_fixture=true`;
- `qa_scope=provider_intake_triage_1d`;
- `qa_identity_type=persistent_audit_principal`;
- `qa_alias=QA_TRIAGE_FINANCE_1` o `QA_TRIAGE_FINANCE_2`.

El perfil usa el alias como nombre, un correo reservado de QA y
`active=false` cuando está en reposo.

## Ciclo de activación

1. Confirmar que el entorno es DEV y el project ref es
   `scsirgbuqjcwoaxfacth`.
2. Rotar una contraseña aleatoria que no se persiste en artefactos.
3. Retirar cualquier ban temporal del usuario Auth.
4. Activar el perfil.
5. Crear solo el rol `finance`.
6. Crear solo una membership activa a la empresa de fixtures seleccionada.
7. Crear una sesión separada por principal.
8. Ejecutar únicamente la matriz UAT autorizada.

La activación debe ser temporal y quedar protegida por un cleanup independiente
que se ejecute aunque falle el UAT.

## Ciclo de desactivación

1. Cerrar globalmente las sesiones y revocar refresh tokens.
2. Banear o bloquear el usuario Auth.
3. Rotar la contraseña a un valor aleatorio no conservado.
4. Eliminar todos los `user_roles` del perfil.
5. Eliminar o desactivar todas sus memberships.
6. Establecer `profiles.active=false`.
7. Confirmar que un refresh token anterior y un login nuevo son rechazados.

El perfil y el usuario Auth bloqueado permanecen intencionalmente. No se deben
eliminar mientras sean referenciados por el ledger.

## Prohibición PROD

Antes de crear, activar o recuperar una identidad, verificar el project ref. Si
no coincide exactamente con DEV, detener la operación. Nunca copiar credenciales,
metadata, perfiles, roles, memberships o eventos QA a PROD.

## Auditoría

Cada ejecución debe registrar de forma sanitizada:

- alias, nunca UUID ni correo completo;
- estado de activación y desactivación;
- cero sesiones activas;
- perfil inactivo al terminar;
- cero roles y memberships;
- usuario Auth bloqueado;
- pruebas de login y refresh rechazadas.

Los eventos de triage permanecen append-only. No borrar, anonimizar ni
reescribir `actor_profile_id`, `triaged_by` o metadata v2.

## Recuperación

Si un principal no puede activarse, no crear un tercero con el mismo propósito.
Inspeccionar Auth, perfil, roles y memberships por metadata/alias, corregir solo
el estado de acceso y volver a ejecutar el precheck. No cambiar FKs ni el ledger.

Si el cleanup falla, ejecutar inmediatamente el modo cleanup-only. Gate 2 no
puede quedar en PASS hasta demostrar cero acceso efectivo.

## Revisión periódica

Mensualmente y antes de cada UAT:

- confirmar que ambos usuarios siguen bloqueados;
- confirmar `profiles.active=false`;
- confirmar cero roles y memberships;
- confirmar ausencia en PROD;
- revisar que no existan otros usuarios con el mismo `qa_scope`;
- documentar cualquier desviación como incidente IAM.
