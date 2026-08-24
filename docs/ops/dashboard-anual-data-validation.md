# Dashboard anual — procedencia y validación de datos

Fecha de registro: 2026-08-24

## Procedencia

`historical_actuals` contiene el histórico contable de Operadora de 2024 a julio de 2026. La carga se originó en auxiliares contables. La validación independiente disponible se hizo contra balanzas de comprobación de CONTPAQ.

La vista presenta cifras **por familia de cuenta contable**:

- cuentas `4xx`: ingresos contables;
- cuentas `6xx`: gastos contables.

Esta clasificación puede diferir de reportes ejecutivos que excluyan cuentas no consideradas ingreso operativo.

## Conciliación independiente

| Periodo | Familia | Balanza CONTPAQ | `historical_actuals` | Diferencia |
|---|---|---:|---:|---:|
| 2025 | Ingresos 4xx | 9,062,481.38 | 9,062,481.38 | 0.00 |
| 2025 | Gastos 6xx | 9,286,961.57 | 9,286,961.57 | 0.00 |
| 2026 YTD julio | Ingresos 4xx | 6,775,863.01 | 6,775,863.01 | 0.00 |
| 2026 YTD julio | Gastos 6xx | 6,862,629.43 | 6,862,629.43 | 0.00 |

## Limitación 2024

El ejercicio 2024 no cuenta con una balanza independiente disponible. Sus cifras provienen únicamente de los auxiliares de origen y deben conservar esa salvedad en cualquier certificación posterior.

## Diferencia frente a la presentación ejecutiva de César

| Fuente | Ingresos YTD julio de 2026 |
|---|---:|
| Dashboard — todas las cuentas 4xx | 6,775,863 |
| Presentación de César | 6,767,920 |
| Diferencia de clasificación | 7,943 |

La diferencia corresponde a cuentas `4xx` que la presentación no clasifica como ingreso operativo. No representa una diferencia contra la fuente contable del Dashboard.

## Control de acceso

El histórico contable se considera sensible. La migración de esta rebanada reemplaza las políticas amplias de `historical_actuals` por RLS estricta de lectura y escritura para `sysadmin`.
