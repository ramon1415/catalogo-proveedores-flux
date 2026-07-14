# BATCH-017 — checklist manual para requester puro en DEV

Estado actual: **BLOCKED**. La revisión read-only de Configuración → Sistema no encontró un perfil con rol exclusivamente Operativo/requester. No se modificaron usuarios, roles ni membresías.

## Preparación autorizada

1. En Supabase Dashboard del proyecto DEV, crear un usuario Auth de QA con correo controlado. No registrar contraseñas, tokens ni enlaces de invitación en este repositorio.
2. Crear o vincular su fila de perfil mediante el procedimiento administrativo vigente del proyecto.
3. Asignar únicamente el rol Operativo/requester requerido por Flux.
4. Vincularlo a la compañía DEV utilizada para la prueba.
5. Verificar en Configuración → Sistema que no tenga roles adicionales: admin, sysadmin, planner, treasury, finance, director ni equivalentes.
6. Cerrar cualquier sesión privilegiada y abrir una sesión nueva únicamente con el usuario de QA.

## Retest de separación de funciones

1. Confirmar que el usuario puede crear y consultar su propia solicitud en DEV.
2. Confirmar que no puede aprobar una solicitud ni un corte como Dirección.
3. Confirmar que no puede liberar un corte, marcar layout, crear fondo de caja, registrar entrega, comprobar, ejecutar pago ni acceder a controles administrativos.
4. Confirmar que las acciones prohibidas no aparecen en la interfaz y que una llamada directa, si se prueba con herramientas autorizadas, es rechazada por RLS/RPC.
5. Capturar evidencia sin secretos: usuario anonimizado, rol visible, compañía, acción intentada y resultado.
6. Eliminar o desactivar el usuario de QA conforme a la política del proyecto cuando concluya la prueba.

## Criterio de cierre

BATCH-017 pasa sólo si las capacidades de requester funcionan y todas las acciones incompatibles con ese rol quedan denegadas. Cualquier rol extra, acceso heredado o evidencia incompleta mantiene el caso BLOCKED; una autorización indebida lo convierte en FAIL.
