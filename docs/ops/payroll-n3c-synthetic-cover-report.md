# Payroll N3C — Synthetic cover XLSX QA adapter

Status: `SYNTHETIC_QA_ONLY / REAL_PHYSICAL_COVER_STILL_UNCERTIFIED / PROD_UNTOUCHED`.

Baseline DEV: `be3cde192701ecd5175ba265c45a74bcecca9d19` (N3B merged).

## Purpose

N3C introduces a deterministic XLSX parser only for the synthetic QA workbook generated to exercise the payroll cover path without real employee data. It does **not** certify the accountant/despacho physical cover format and does not relax the production fail-closed contract.

## Synthetic workbook evidence

Generated QA workbook:

`Caratula_Nomina_Sintetica_QA_Flux.xlsx`

SHA-256:

`1c50510376ef71dbf4f3c5087a74140860136cadafe49f896f95f9ce8768fe94`

Classification:

`INTERNAL_SYNTHETIC_QA_FIXTURE / NOT_A_REAL_PAYROLL_SOURCE`

The workbook contains explicit visible warnings that it is synthetic and must not be used for payments.

Canonical QA worksheet:

`OPERADORA TLACATECPAN`

Expected headers at row 8:

- `ID_QA`
- `EMPLEADO`
- `RFC`
- `CURP`
- `NSS`
- `BANCO`
- `CUENTA`
- `CLABE`
- `NETO`
- `MISMO_BANCO`
- `SPEI`
- `VALES`
- `TOTAL_CONTROL`
- `VALIDACIÓN`
- `CANAL_PRINCIPAL`

The QA contract also checks the positions recovered from the historical macro external link:

- `C6 → AD18`
- `C7 → AD11`
- `C8 → AD19`
- `C9 → AD14`
- `C10 → AD9`

For QA only, the generated workbook puts the corresponding synthetic SPEI amounts in those `AD` cells. This exercises the recovered positions but does not assert that column `AD` has that meaning in the missing real cover.

## Deterministic QA extraction

The adapter parses OOXML directly from the XLSX ZIP container. No OCR, macro execution, ActiveX, network access or external spreadsheet library is used.

Expected synthetic result:

- people: `8`
- net total: `MXN 66,651.50`
- same-bank total: `MXN 22,850.50`
- SPEI total: `MXN 41,701.00`
- vouchers total: `MXN 2,100.00`
- total reconciliation: `PASS`

The parser returns canonical employee fields only to the payroll parsing layer. Error results use safe issue metadata (`code`, `severity`, `source`, optional `row`/`field`) rather than echoing employee identifiers, account values or amounts.

## Safety gates

The parser returns these explicit flags on success:

- `qaOnly=true`
- `certifiedPhysicalSource=false`
- `contractVersion=flux-synthetic-cover-qa-v1`

Therefore this adapter cannot by itself make a real payroll capture materializable.

The authoritative real-format state remains:

`COVER_SHEET_XLSX = UNSUPPORTED_PENDING_SOURCE_CONTRACT`

The exact real file still sought is:

`OPERADORA TLACATECPAN - Reporte de nómina periodo 15.xlsx`

No real XLSX headers, offsets, rows, formulas or byte contract are inferred from the synthetic fixture.

## Other format states remain unchanged

- SPEI TXT: `CERTIFIED / SUPPORTED`
- BBVA same-bank payroll TXT: `PENDING_FORMAT_CERTIFICATION`
- TOKA XML / employee breakdown: `CONDITIONAL / PENDING`

No synthetic artifact is promoted to a banking or accountant/despacho source contract.

## Scope

This gate contains only:

- `payroll_cover_qa_parser.js`
- N3C QA contract tests
- this report
- payroll CI wiring

It does not:

- modify Supabase schema or data;
- change N3A/N3B migrations;
- deploy an Edge Function;
- enable real payroll materialization;
- create an active Finance profile;
- generate or upload a bank file;
- enable dispersion or reconciliation;
- touch PROD or `main`.

## Gate result target

`PASS / PAYROLL_N3C_SYNTHETIC_COVER_QA_ADAPTER_READY / QA_XLSX_PARSE_PASS / QA_TOTAL_RECONCILIATION_PASS / NO_OCR / NO_REAL_FORMAT_CERTIFICATION / REAL_COVER_STILL_REQUIRED / DEV_DB_UNTOUCHED / PROD_UNTOUCHED`
