# Payroll N3E — visual QA in DEV

Status: `DRAFT_PR / VISUAL_QA_ONLY / NO_DB_WRITES / NO_BANK_ACTIONS / PROD_UNTOUCHED`.

Base DEV: `7eb127461ddc31b52342670ea0993295561433de` (PR #376 merged).

## Purpose

N3E connects the already-certified synthetic payroll package to a dedicated Flux DEV page so the user can validate the experience visually without weakening the real payroll controls.

Target page:

`/nomina_qa.html`

The page is intentionally separate from the real Finance capture path. It uses Flux branding/navigation, requires a recognized DEV role, and refuses Production hosts.

## Synthetic package served by DEV

The page downloads four repository fixtures and accepts them only when SHA-256 matches exactly:

| Fixture | SHA-256 | Expected result |
| --- | --- | --- |
| `Caratula_Nomina_Sintetica_QA_Flux.xlsx` | `1c50510376ef71dbf4f3c5087a74140860136cadafe49f896f95f9ce8768fe94` | 8 people / MXN 66,651.50 |
| `BBVA_Mismo_Banco_Nomina_Sintetica_QA_Flux.txt` | `c8dfd71874c9fb7d8a9e3d8b87ed52198bb98d1e1cfeb7580f24cef447f25cf8` | 3 records / MXN 22,850.50 |
| `SPEI_Nomina_Sintetica_QA_Flux.txt` | `26450184918d52a9784b250edf90f5f7d6b3da56db7c89b32a66cf5ffe59c306` | 5 records / MXN 41,701.00 |
| `TOKA_Vales_Nomina_Sintetica_QA_Flux.xml` | `3e16bcbe4dcf39e7e46bc91aa8e682cd40460a8b0202c20b294db3e37cd7674c` | 3 records / MXN 2,100.00 |

The visual model reuses the production-domain payroll normalization and validation functions:

`normalizePayrollBankRecords -> normalizePayrollTokaRecords -> mergePayrollSources -> validatePayrollRun`

Expected exact control:

`22,850.50 + 41,701.00 + 2,100.00 = 66,651.50`

## Visual E2E timeline

When the package passes, the page displays:

1. `Paquete QA 4/4` — exact hashes and QA-only contracts.
2. `Cross-check 8/8` — carátula ↔ BBVA ↔ SPEI ↔ TOKA.
3. `Materialización N3A` — marked as PASS from previously accepted rollback UAT evidence.
4. `Submit N3B` — marked as PASS from rollback UAT evidence and idempotency certification.
5. `Aprobación` — marked as PASS from the existing individual approval path certification.
6. `Freeze post-decisión` — no payment/dispersion lifecycle is enabled.

Steps 3–5 are evidence visualization only. `nomina_qa.html` does not replay them and does not write database state.

## Safety boundaries

The page/runtime:

- is blocked on known Production hosts;
- requires an authenticated role in the existing admin/Finance/Direction role families;
- does not call `supabaseClient`, `getFluxSupabaseClient`, `.rpc(...)`, `submit_payroll_for_approval`, `decide_payment_request`, or `materialize_payroll_capture_internal`;
- does not upload to `payroll-private`;
- sends no emails;
- generates no PAGOSBBV/PAGOSINT/CIE layouts;
- performs no BBVA/TOKA action;
- contains no real payroll data.

Every evaluation result is explicit:

- `qaOnly=true`
- `certifiedPhysicalSource=false`
- `realCertification=false`
- `serverMutation=false`
- `bankAction=false`

## Real physical format remains blocked

N3E does not change these authoritative states:

- `COVER_SHEET_XLSX = UNSUPPORTED_PENDING_SOURCE_CONTRACT`
- `BBVA_SAME_BANK_TXT = PARTIAL_CONTRACT_ONLY`
- `TOKA_XML = MISSING_PHYSICAL_SOURCE`

The synthetic package proves the model and UX only. It does not certify the accountant/despacho source or bank/TOKA physical formats.

## Gate

`PASS_TARGET / PAYROLL_N3E_VISUAL_QA_READY / FULL_SYNTHETIC_PACKAGE_4_OF_4 / PERSON_MATCH_8_OF_8 / TOTALS_EXACT / DEV_ONLY / READ_ONLY / REAL_FORMAT_STATUS_UNCHANGED / DISPERSION_NOT_STARTED / PROD_UNTOUCHED / MAIN_UNTOUCHED`
