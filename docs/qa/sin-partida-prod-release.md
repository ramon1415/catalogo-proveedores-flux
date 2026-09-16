# Sin partida en producción

Base: `main` en `ca6bc085d49ca5ae1f041c54a0abffead2e0b4b0`. Promoción acotada de la funcionalidad de DEV, adaptada a los RPC y al diseño actuales de PROD.

## Resultado esperado

- Una sola categoría `SIN_PARTIDA`, visible para los perfiles que ya pueden crear solicitudes en Operadora y Fersana. Se ofrece sin presupuesto mensual ni asignación de responsable.
- Se conserva el diseño de reembolsos de PROD, con empresa/centro/mes dentro del desglose, identidad del solicitante y resumen lateral. Los únicos atributos añadidos al componente del desglose son etiquetas accesibles.
- César se asigna automáticamente y queda bloqueado como aprobador. Su aprobación sigue siendo una decisión explícita; no se otorgan permisos nuevos de captura, edición ni autoaprobación.
- Después de aprobar se presenta `Sin partida (descripción de la solicitud)`. La descripción se guarda en la solicitud, sin multiplicar categorías. El filtro agrupa todas por el mismo ID; cortes y exportaciones conservan el detalle descriptivo.
- Los reembolsos Sin partida llevan todos sus gastos en esa clasificación. Los gastos de partidas presupuestadas se capturan en otra solicitud, para conservar su validación presupuestal.

## Compatibilidad y despliegue

Migración: `20260916011005_requests_sin_partida_cesar_prod.sql`. Se aplica antes del frontend y aborta si las cinco funciones de producción que modifica cambiaron respecto de la base revisada.

Se preservan las firmas y privilegios existentes, los wrappers de documentos, la validación de propietario/ruta de los adjuntos, las restricciones de beneficiario por empresa, los controles de edición exclusivos de Finanzas y la inmutabilidad de reembolsos terminados. Se adaptan únicamente la creación base, el enrutamiento del aprobador, la disponibilidad y la aceptación de la categoría común en los dos RPC de reembolsos.

La configuración identifica a César por su identidad verificada y a las empresas por RFC, sin reutilizar UUID de DEV. No modifica ni aprueba solicitudes históricas. La política interna tiene RLS y carece de acceso de clientes; la consulta pública de aprobador exige autenticación y pertenencia a la empresa.

## Validación

- 156 pruebas del gate de publicación aprobadas: flujo React por empresa/perfil, layout de PROD, presupuesto normal, documentos opcionales, reembolsos, convenio, permisos y PWA.
- 11 pruebas SQL ejecutan la migración completa sobre las definiciones reales de las funciones de PROD, en PGlite con datos ficticios. Incluyen creación atómica con tres gastos, rollback de mezclas/adjuntos inválidos, aprobación humana de César, edición de Finanzas y solicitudes terminadas.
- Compilación TypeScript/Vite y artefacto estático de Vercel aprobados.
- Suite amplia: 618 pruebas aprobadas de 629. Las 11 fallas restantes se reproducen en `main` sin este cambio: contratos históricos de notificaciones, portal y rutas legacy, y dos aserciones antiguas de reembolsos anteriores al guardado atómico/documento opcional. Se conserva esa evidencia y no se deshabilitan pruebas.
- Sin prueba visual autenticada: las sesiones de navegador disponibles están cerradas. La cobertura de formularios se ejecuta con React; la publicación se verifica mediante su estado y sus assets servidos.

El workflow `sin-partida-prod.yml` reproduce el gate sin acceso a la base de producción. Después de aplicar la migración se deben verificar categoría, enrutamiento, privilegios, auditoría de seguridad y huellas de los datos históricos y funciones preservadas.
