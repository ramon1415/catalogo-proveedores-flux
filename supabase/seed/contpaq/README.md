# Semilla contable CONTPAQ

Artefactos de datos para poblar `contpaq_accounts` con el árbol completo y
`budget_account_mappings` con los 87 mapeos validados.

## Origen

Generados de forma determinista en el repo del módulo de export:

- Repo:   `carlosquantta/flux-contpaq-export`
- Rama:   `seed/catalogo-contable-y-mapeos`
- Commit: `0a0175e8e7570fcc87e288b88d8b8b584a7c509e`
- Scripts: `scripts/generar_seed_contable.mjs` y `scripts/generar_seed_mapeos.mjs`
  (en ese orden — el primero inicia el MANIFEST, el segundo le apenda)

`MANIFEST.txt` trae el sha256 de cada archivo fuente (.xls de CONTPAQ) y de
cada salida. Para reproducir los hashes desde cero hace falta el repo de
origen, que tiene los .xls y los generadores.

## Contenido

| Archivo | Qué carga |
|---|---|
| `catalogo_operadora.sql` | 1,646 cuentas · 1,402 de detalle · 1,440 rubros NIF |
| `catalogo_soporte_fersana.sql` | 694 cuentas · 638 de detalle · 272 rubros NIF |
| `catalogo_flux_financiera.sql` | 1,013 cuentas · 924 de detalle · 507 rubros NIF |
| `mapeos_operadora.sql` | 87 mapeos · 22 nombre_exacto · 65 criterio · 6 needs_review |

Los `.csv` son la misma información en formato revisable dentro del PR.

## Antes de ejecutar

Sustituir `:company_id` por el UUID real de la empresa. Para Operadora en DEV:
`9680353c-9b86-4730-82e1-fce664f048a2`.

Los dos SQL son idempotentes: el catálogo hace `on conflict do update` (re-sync)
y los mapeos `on conflict do nothing` (no pisan lo que se haya hecho a mano).

## Validaciones esperadas tras la carga

- 1,646 cuentas con `cta_sup` y `tipo` no nulos
- 87 mapeos · 22 / 65 / 6
- Los 63 códigos distintos pasan los cinco candados: existen, son hoja del
  árbol, son `cta_mayor = 2` y son `tipo = G`

## Alcance de esta carpeta

Contiene **el catálogo contable y los mapeos partida→cuenta**, que es lo que
este PR necesita.

**No contiene la capa de renglones ejecutivos** (cuenta → renglón de
presentación). Esa es otra capa del modelo: el *bucket presupuestal* agrupa
partidas y cuentas para comparar contra presupuesto, mientras que el *renglón
ejecutivo* agrupa cuentas para presentar un estado financiero. Se parecen y
conviene no confundirlas.

Sus artefactos viven en el repo de origen, en `data/seed/renglones_<empresa>.sql`,
y entran con las tareas de estados financieros — no con el mapper.

El `MANIFEST.txt` de esta carpeta es un **extracto** del completo por esa razón.

## Nota sobre las razones textuales

Las razones línea-por-línea del seed de juicio original (agosto) **no están
versionadas** — se perdieron con el scratchpad de esa sesión y **no se
reconstruyeron por heurística**. Lo verificable es el par partida→cuenta
(aplicado y validado en DEV), el método derivado por comparación normalizada
de nombres, y las 6 banderas `needs_review`. La derivación reproduce la
partición original exacta: 22 / 65.
