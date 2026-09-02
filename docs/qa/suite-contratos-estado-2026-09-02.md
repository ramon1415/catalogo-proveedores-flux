# Suite de contratos (`scripts/qa`): estado y las 18 pruebas huérfanas

Fecha: 2 de septiembre de 2026 · rama `fix/qa-suite-rot`

## Resumen

Correr la suite completa desde la raíz daba **28 fallas**, ninguna del producto.
Esta rama resuelve **10**; quedan **18** que necesitan una decisión de producto,
no un parche.

| | antes | después |
|---|---|---|
| tests | 523 | 538 |
| pasan | 494 | 519 |
| fallan | 28 | 18 |

**La causa de fondo es que nada corre esta suite.** Ninguna de las 28 pruebas
está referenciada en un workflow: solo se ejecutan si alguien corre el glob a
mano. Por eso llevaban semanas rojas sin que nadie lo notara. Dejarlas en verde
sin conectarlas a CI las vuelve a pudrir en un mes.

## Lo que se arregló aquí (10)

**Arnés de dependencias (6).** No había `package.json` en la raíz, así que la
suite no resolvía lo que importan las Edge Functions. Se agrega uno privado con
`jspdf@2.5.2` y `jspdf-autotable@3.8.4` (las mismas versiones exactas que fija
el workflow de correo) y el script `npm run qa:setup`, que instala raíz y `app/`
—esta última la necesita el contrato de CSF, que compila con el `tsc` del
proyecto—. No afecta el deploy: `vercel.json` fija `framework: null` e
`installCommand: npm --prefix app ci`.

**Consolidación del baseline (2).** `brownfield-baseline-uniqueness` y
`brownfield-extension-dependencies` afirmaban que la carpeta de migraciones
contiene **exactamente un archivo**, cierto solo el día de la consolidación
(11-ago, commit 7e0aa3d). Hoy hay 74. Se reescriben al invariante que sí
perdura: existe un único baseline, es el primero de la cadena, y ninguna versión
se repite.

**Cutover de React a la raíz (2).** `react-corrective-parity` exigía que
comprobantes y cortes fueran iframes del vanilla (`LegacyModuleFrame`); hoy son
pantallas React propias, que es justamente la paridad que el contrato perseguía.
Se verifica la ruta, el componente y su carga diferida.
`fersana-access-onboarding` esperaba `/app/solicitudes`; el prefijo `/app` solo
sobrevive como redirect de compatibilidad en `vercel.json`.

**Allowlist de poder de plataforma.** `company-scoped-roles` buscaba los dos
correos dentro de `auth.tsx`; se movieron a `app/src/lib/platformPower.ts`. Se
apunta al módulo nuevo y **se refuerza**: además de los correos, se exige que
`auth.tsx` importe y use el helper junto con el grupo sysadmin, y que el
allowlist tenga exactamente dos correos.

## Hallazgo aparte: el dispatcher se desplegó fuera de su compuerta

El guard `notification-dispatcher-branded-deploy-dev-guard` fija el blob del
`index.ts` del dispatcher, y el **mismo hash** vive en
`.github/workflows/supabase-dev-notification-dispatcher.yml`, donde bloquea el
despliegue si no coincide.

Ambos estaban en `a45a3c09…`, del 7-ago (commit 60fabb0). Entre el 24 y el 31 de
agosto el dispatcher cambió **siete veces** (PDF de sistema, aislamiento de
eventos por cutoff, ruteo del correo de DEV al Director seleccionado) y el pin
nunca se movió. La compuerta llevaba roja desde el 24 de agosto.

Verificado contra DEV: la función desplegada (versión 50, 31-ago 15:13) tiene un
`index.ts` que hashea `414b318f…`, **idéntico al del repo**. No hay deriva: DEV
corre lo que dice el repositorio. Pero esos despliegues no pasaron por el
workflow certificado, porque el workflow los habría rechazado.

Se recertifican test y workflow a `414b318f…` tras revisar el diff acumulado
(476 líneas, sin cambios en credenciales ni en destinatarios fuera de la lógica
declarada de DEV). **La compuerta queda funcional otra vez, pero el hueco de
proceso sigue abierto:** hay que decidir si el despliegue del dispatcher pasa
siempre por ese workflow o si el guard sobra.

## Las 18 que quedan: decisión de Ramón

Todas fallan por lo mismo: **abren por nombre una migración que ya no existe**.
El 11 de agosto la consolidación del baseline borró 86 archivos y fundió su DDL
en `20260811035345_flux_dev_authoritative_brownfield_baseline_v2.sql`.
Comprobado que **no se perdió ningún objeto**: por ejemplo `payment_batch_items`
hoy se llama `approval_batch_items`, y `approval_rules` y `payment_receipts`
siguen existiendo en DEV.

| prueba | migración que ya no existe |
|---|---|
| provider-intake-action-fingerprint | `030_provider_intake_action_fingerprint.sql` |
| provider-intake-matching-contract | `031_provider_intake_matching.sql` |
| payment-batch-reconciliation-contract | `032_payment_batch_reconciliation.sql` |
| payment-batch-final-reconciliation-contract | `033_payment_batch_final_reconciliation.sql` |
| approval-execution-layout-hotfix-contract | `033_separate_approval_material_from_payment_execution_data.sql` |
| extraordinary-migration-catalog-contract | `036_quarantine_legacy_extraordinary_authorizations.sql` |
| legacy-extraordinary-direct-lineage-contract | `036_quarantine_legacy_extraordinary_authorizations.sql` |
| extraordinary-storage-policy-helper-039-contract | `037_secure_extraordinary_external_authorization.sql` |
| secure-extraordinary-external-authorization-contract | `037_secure_extraordinary_external_authorization.sql` |
| mixed-close-038-contract | `038_materialize_only_released_batch_items.sql` |
| extraordinary-040-atomic-consumption-contract | `040_fix_extraordinary_consumption_and_material_invalidation.sql` |
| p3-permissions-hardening-contract | `044_harden_approval_rules_for_explicit_routing.sql` |
| notifications-receipt-linked-contract | `20260806023116_notifications_receipt_linked.sql` |
| layout-operational-materiality-reconcile-contract | `20260809214308_reconcile_layout_operational_materiality_sol_2026_0006.sql` |
| layout-client-uat-hotfix-contract | `20260810165344_layout_client_uat_preserve_approval_repair_sol_0008_0009.sql` |
| layout-concept-no-reauth-contract | `20260810175316_layout_concept_no_reauth.sql` |
| paid-layout-receipt-match-contract | `20260810185817_paid_layout_receipt_match.sql` |
| provider-intake-payment-conversion-contract (1 caso) | espera que tras `044` solo sigan 5 archivos |

La decisión es una por prueba, y el criterio es este:

- **Retirar** cuando la prueba solo fijaba el texto de una migración histórica.
  Volver a apuntarla al baseline es re-verificar una foto: no atrapa ninguna
  regresión futura, porque el archivo ya no se puede editar.
- **Reescribir contra la base viva** cuando cuida algo que sí puede romperse
  hoy: una política de RLS, un grant, un índice, una constraint. Esas valen y
  conviene que consulten `pg_policies` / `pg_constraint` en vez de un `.sql`.

Los cinco `2026081*` de layout y el de notificaciones son claramente
arqueológicos: describen reparaciones puntuales de solicitudes concretas
(SOL-0006, SOL-0008/0009) que ya ocurrieron. Los de extraordinarios y
provider-intake sí tocan políticas de acceso y merecen la segunda ruta.

## Recomendación

Conectar la suite a CI **en cuanto quede en verde**, con un workflow que corra
`npm run qa:setup && npm test` en cada PR a `dev`. Sin eso, esto se repite.

## Nota suelta

`app/src/pages/LegacyModuleFrame.tsx` ya no lo renderiza ninguna ruta: quedó sin
usar tras el cutover. No se borra aquí para no mezclar alcances.
