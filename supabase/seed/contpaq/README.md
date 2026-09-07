# Semilla FB-Integración (CONTPAQ → Flux)

Datos de referencia que las migraciones `20260901232529`, `20260901235805` y
`20260902045510` **no** cargan y que el tab *Mapeo CONTPAQ* y el export de
pólizas necesitan: catálogo contable con árbol (Operadora y Soporte Fersana),
renglones ejecutivos, padrón de terceros de Operadora y el mapeo
partida→cuenta de las 60 partidas de Soporte Fersana.

## Cómo se aplica

```bash
DATABASE_URL='postgres://…' supabase/seed/contpaq/apply.sh
```

`apply.sh` verifica el `MANIFEST.txt` (sha256 de cada archivo), sustituye
`:company_id` por el uuid fijo de cada empresa, corre todo en **una**
transacción con `ON_ERROR_STOP` y termina con `postcheck.sql`.

## Idempotencia

Todas las sentencias son `insert … on conflict`:

| archivo | llave | en conflicto |
|---|---|---|
| 10_/11_ catálogo | (company_id, code) | actualiza nombre/árbol/tipo (el catálogo de CONTPAQ manda) |
| 20_/21_ renglones | (company_id, account_code, layer) | actualiza line_name |
| 30_ terceros | (company_id, id_contpaq) | actualiza nombre/rfc/tipo |
| 40_ mapeos SF | (company_id, budget_category_id, contpaq_account_code) | **no hace nada**: lo que Finanzas ya decidió se respeta |

Una segunda corrida deja los conteos de `postcheck.sql` idénticos. Los 18
mapeos con `needs_review = true` se cargan como pendientes y **no** se
aprueban: siguen visibles en el tab Mapeo CONTPAQ hasta que Finanzas los
resuelva.

## Qué NO está aquí

- Los archivos fuente de CONTPAQ (.xls del catálogo, CSV del padrón): viven
  en el módulo `flux-contpaq-export` con su sha256 en el MANIFEST.
- Los mapeos partida→cuenta de Operadora (87): son del mapper y ya viven en
  DEV desde su propio proceso de revisión.
- Cuentas bancarias, impuestos y proveedores→cuenta: se capturan en el tab.
