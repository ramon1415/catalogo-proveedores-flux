# historical_actuals schema audit

Paquete read-only para auditar `public.historical_actuals` en DEV.

## Motivo

`historical_actuals` existe como objeto ad-hoc en DEV, pero no hay DDL exacto en el paquete de migraciones del repo. Este paquete exporta solo metadatos para decidir una migracion posterior sin inventar columnas, constraints, policies ni grants.

## Seguridad

- Los scripts contienen solo `SELECT`.
- No leen filas de negocio.
- No modifican datos ni esquema.
- Deben ejecutarse solo en DEV cuando exista aprobacion operativa.

## Ejecucion manual futura

No ejecutar desde este PR.

Cuando se autorice, usar:

```text
Actions -> Deploy Supabase DEV Manual -> Run workflow
Branch: dev
script_path: ops/schema-audit/historical-actuals
confirm_dev: scsirgbuqjcwoaxfacth
```

## Resultado esperado

- `HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT` si existe en DEV.
- `HISTORICAL_ACTUALS_NOT_FOUND_IN_TARGET` si no existe en el ambiente consultado.
