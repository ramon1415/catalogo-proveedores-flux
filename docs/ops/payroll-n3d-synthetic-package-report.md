# Payroll N3D — synthetic BBVA/TOKA package QA contract

Status: `QA_ONLY / SYNTHETIC_PACKAGE_READY / REAL_PHYSICAL_FORMATS_UNCERTIFIED / PROD_UNTOUCHED`.

Baseline DEV: `46361ec32eb5ecdb14812907e98cd83b5f7d2174` after PR #375.

## Purpose

N3D completes a fully synthetic, deterministic payroll package for QA without claiming that the missing accountant/despacho outputs have been recovered or certified.

The package covers:

- synthetic cover XLSX contract from N3C;
- synthetic BBVA same-bank TXT;
- certified payroll SPEI byte parser using synthetic records;
- synthetic TOKA vouchers XML;
- person-level reconciliation through the existing `mergePayrollSources()` and `validatePayrollRun()` model.

No synthetic adapter is promoted to a real banking or provider format.

## Synthetic BBVA same-bank fixture

File:

`BBVA_Mismo_Banco_Nomina_Sintetica_QA_Flux.txt`

Contract:

- `qaOnly=true`
- `certifiedPhysicalSource=false`
- parser contract: `flux-synthetic-bbva-same-bank-qa-v1`
- SHA-256: `c8dfd71874c9fb7d8a9e3d8b87ed52198bb98d1e1cfeb7580f24cef447f25cf8`
- 3 records
- 85 useful ASCII bytes + CRLF = 87 physical bytes per record
- source account: synthetic `000000000000000001`
- currency marker: `MXP`
- total: MXN 22,850.50

The record layout is intentionally based only on the generic same-bank generator contract recovered from the historical VBA:

`destination18 | source18 | currency3 | amount16 | motive30 | CRLF2`

This does **not** select or certify the real payroll variants `Nomina 108`, `Nomina 232` or `Nomina TR`.

The fixture is constrained to the three same-bank employees in the synthetic cover:

- PERSONA PRUEBA DOS — MXN 9,800.00
- PERSONA PRUEBA CUATRO — MXN 5,800.00
- PERSONA PRUEBA CINCO — MXN 7,250.50

## Synthetic TOKA fixture

File:

`TOKA_Vales_Nomina_Sintetica_QA_Flux.xml`

Contract:

- `qaOnly=true`
- `certifiedPhysicalSource=false`
- parser contract: `flux-synthetic-toka-qa-v1`
- SHA-256: `3e16bcbe4dcf39e7e46bc91aa8e682cd40460a8b0202c20b294db3e37cd7674c`
- 3 voucher records
- total: MXN 2,100.00

The XML schema is an internal Flux QA schema only. It is **not** presented as a TOKA CFDI/XML schema.

Synthetic voucher allocation:

- PRUE040404DD4 — MXN 600.00
- PRUE060606FF6 — MXN 900.00
- PRUE080808HH8 — MXN 600.00

## SPEI QA records

N3D does not add a second SPEI parser. Five synthetic SPEI records are generated in the contract test and parsed with the existing certified N2A parser:

`bbva-simulator-pagos-interbancarios-128-v1`

Total SPEI: MXN 41,701.00.

## Full package reconciliation

Expected package totals:

| Component | MXN | People/records |
| --- | ---: | ---: |
| Cover net | 66,651.50 | 8 people |
| BBVA same-bank | 22,850.50 | 3 records |
| SPEI | 41,701.00 | 5 records |
| TOKA / vouchers | 2,100.00 | 3 records |

Control:

`22,850.50 + 41,701.00 + 2,100.00 = 66,651.50`

The contract test parses the N3C cover, parses both N3D fixtures, parses synthetic SPEI through the certified N2A adapter, normalizes all sources and calls the production-domain functions:

- `normalizePayrollBankRecords()`
- `normalizePayrollTokaRecords()`
- `mergePayrollSources()`
- `validatePayrollRun()`

Expected result:

- 8 people matched deterministically;
- zero source issues;
- zero person-level total mismatches;
- bank total = 2,285,050 minor units;
- SPEI total = 4,170,100 minor units;
- vouchers total = 210,000 minor units;
- request total = 6,665,150 minor units;
- run validation = PASS.

## Hash and fail-closed boundary

Both N3D parsers require the declared SHA-256 to equal the exact fixture hash. A different hash fails closed before the synthetic source is accepted.

The parsers also encode expected synthetic rows and totals, so a caller cannot convert the QA contract into a generic real-file adapter by only passing the known hash string.

## Real-format status remains unchanged

N3D does not alter the physical evidence conclusions from N2A:

- `COVER_SHEET_XLSX = UNSUPPORTED_PENDING_SOURCE_CONTRACT`
- `BBVA_SAME_BANK_TXT = PARTIAL_CONTRACT_ONLY`
- `TOKA_XML = MISSING_PHYSICAL_SOURCE`
- SPEI remains the only physically certified payroll output adapter.

The synthetic fixtures may be used to exercise product workflow and reconciliation. They may not be used to claim bank/provider acceptance or to authorize a real payroll run.

## Explicit exclusions

N3D does not:

- modify Supabase schema or data;
- deploy or modify the N3A materialization Edge Function;
- change N3B approval behavior;
- activate a Finance profile;
- create a real payroll request;
- generate or upload a bank payment file;
- disperse funds;
- reconcile a real payment;
- touch PROD or `main`.

## Target gate

`PASS / PAYROLL_N3D_SYNTHETIC_BBVA_FIXTURE_READY / PAYROLL_N3D_SYNTHETIC_TOKA_FIXTURE_READY / PAYROLL_FULL_PACKAGE_PERSON_MATCH_PASS / PAYROLL_FULL_PACKAGE_TOTALS_PASS / REAL_FORMAT_STATUS_UNCHANGED / DEV_DB_UNTOUCHED / DISPERSION_NOT_STARTED / PROD_UNTOUCHED / MAIN_UNTOUCHED`
