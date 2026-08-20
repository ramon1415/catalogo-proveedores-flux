# Payroll N3F — real physical format certification

Status: `REAL_PHYSICAL_EVIDENCE_RECOVERED / CONTRACTS_VERSIONED / DEV_APPLY_PENDING / PROD_UNTOUCHED`.

Baseline DEV before N3F: `7eb127461ddc31b52342670ea0993295561433de`.

No employee name, RFC, CURP, NSS, account or CLABE from the supplied payroll package is stored in this repository. Real files remain outside Git; tests use sanitized fixtures that preserve byte/layout structure only.

## Product boundary

Flux does not calculate payroll. The external accountant/process remains the authority for perceptions, deductions, taxes, leave and payroll calculation. Flux receives the resulting package, verifies physical files, snapshots the run, supports approval and later reconciles the treasury channels.

Incident emails are supporting evidence only. They may be stored as confidential run evidence in a later slice, but they do not drive payroll formulas or silently correct the external accountant's cover.

## Real evidence received

| Evidence | SHA-256 | Physical observation | N3F authority |
| --- | --- | --- | --- |
| Cover XLSX | `b7ceabc47629e1214593564780cf451f9726b7acd8a121b69f33a6d352041d85` | sheet `OPERADORA TLACATECPAN`, header row 5, 23 people | `operadora-tlacatecpan-cover-v1` |
| BBVA same-bank payroll TXT | `be1e006909b84cd35b8fd385f2d3968bdbe2525c729165d0e93a431aab058b6f` | 17 records, 108 useful ASCII bytes + CRLF | `bbva-payroll-nomina108-v1` |
| BBVA interbank/SPEI TXT | `8b386aab81d021026dfbe2cea2463a69fd25c26ca0d862a4a91f5e722a312d11` | 5 records, existing 128-byte useful contract + CRLF | existing `bbva-simulator-pagos-interbancarios-128-v1` confirmed by real run |
| Duplicate SPEI copy | same `8b386aab...` | byte-identical duplicate | must deduplicate by hash if both are supplied |
| TOKA funding TXT | `603a3129dbf5b3fe4e04c769ee39daa685e2f3e9fdce0a6837da69ee1fec38df` | 1 interbank-style funding record | existing 128-byte contract, file kind `layout_toka` |
| TOKA CFDI XML | `8bb71600482e2d5a10b9bc12d2aa68721171b057e8a9bbb4775893b8b2f86780` | CFDI 4.0 + `valesdedespensa` complement | `toka-cfdi-vales-v1` |
| TOKA PDF | `356e341cae9d9c759a8e9900741b1efc3a1119a35c2eda7af7a90a55612a16eb` | human-readable confirmation of benefit, commission, VAT and total deposit | certification evidence; not required runtime parser |
| TOKA XLSM | `66f20373ceea98aec461ff91526a182c2155bc1435e807fc0f88fc1ff042450d` | byte-identical to the previously recovered generator source | supporting generator evidence only |
| Legacy payroll generator XLS | `d99b73519826e9272fd40c9add040c60dc48f609aebc0c0a1178d07e6d134f90` | contains payroll-layout generator strings | supporting evidence; physical TXT remains byte authority |

## Real cover contract

The real cover is parsed structurally from OOXML; no OCR, macro execution, ActiveX or network access.

Required headers are located by name on row 5 rather than by hardcoded column letter:

- `RFC`
- `CURP`
- `Nombre completo`
- `Banco`
- `Cuenta banco`
- `CLABE`
- `Vales De Despensa`
- `Neto a pagar`
- `Neto en efectivo (sin vales)`

NSS is not a cover requirement because the supplied cover does not expose an NSS column. Identity remains valid through RFC/CURP under the existing snapshot model.

Observed aggregate controls:

- people: `23`
- employee net: `MXN 118,851.80`
- cash / bank transfer amount: `MXN 117,535.09`
- voucher employee benefit: `MXN 1,316.71`
- zero-net people: `1`

The zero-net row is material to the snapshot even though it generates no bank transfer. N3F therefore permits a `payroll_run_lines` row with `net=bank=spei=vouchers=0`; positive rows retain exact component equality.

## BBVA same-bank physical contract

The supplied payroll TXT proves the `Nomina 108` variant, not the earlier generic 85-byte same-bank generator.

Per record:

| Field | Width |
| --- | ---: |
| consecutive | 9 |
| RFC field | 16 |
| type | 2 (`99`) |
| destination account field | 20 |
| amount in cents | 15 |
| employee name | 40 |
| bank | 3 (`001`) |
| plaza | 3 (`001`) |
| useful bytes | 108 |
| record terminator | CRLF |

Real sample control:

- records: `17`
- amount: `MXN 81,185.26`

The 108-byte record does not encode the source account. For a same-bank-only run, Flux may use the selected, server-resolved company bank account as capture authority, but must not label it as verified from bank-layout bytes. When an interbank/TOKA rail exists, its encoded source account must match the selected source account.

## SPEI contract confirmed by the real run

The existing 128-useful-byte + CRLF parser converges with the supplied run:

- records: `5`
- amount: `MXN 36,349.83`
- source account is encoded in every record and must match the selected source account.

The two uploaded SPEI files are byte-identical. A duplicate file must not create a second logical rail or duplicate employee payment.

Names are not a blocking identity key. The real layouts contain spelling/truncation differences; exact unique destination + amount remains the bank match authority. A name difference is recorded as a warning only.

`81,185.26 + 36,349.83 = 117,535.09`, exactly matching the cover cash total.

## TOKA is two operational documents for one channel

The `vales` channel requires both:

1. `cfdi_vales` — CFDI XML: employee benefit breakdown and provider commission/tax.
2. `layout_toka` — TXT: actual treasury funding transfer to TOKA.

The supplied CFDI proves:

- employee voucher benefit: `MXN 1,316.71`
- commission: `MXN 26.33`
- VAT: `MXN 4.21`
- provider charge: `MXN 30.54`
- expected funding: `MXN 1,347.25`

The supplied funding TXT requests:

- actual funding: `MXN 1,347.26`

Therefore the real run contains a `+MXN 0.01` funding variance. N3F never rounds, overwrites or invents a reason for that difference.

The model separates:

- `benefit_amount` — employee benefit from the CFDI complement;
- `fee_amount` — provider commission;
- `tax_amount` — provider tax;
- `expected_funding_amount = benefit + fee + tax`;
- `amount` — actual treasury outflow from `layout_toka`.

Any non-zero difference between `amount` and `expected_funding_amount` sets `finance_review_required`. A materialized draft cannot be submitted for approval until Finance explicitly acknowledges the variance with a note. No automatic tolerance is invented from this single sample.

## Approval amount vs employee net

N3F preserves two business totals:

- employee net control: `MXN 118,851.80`
- actual treasury request: `81,185.26 + 36,349.83 + 1,347.26 = MXN 118,882.35`

`payment_requests.amount_requested` is the actual treasury request. The employee net remains a reconciliation/control total derived from `payroll_run_lines`.

This prevents TOKA commission/VAT from being attributed to an employee while ensuring leadership approves the actual cash outflow.

## Matching rules proven by the real package

- same bank: unique destination account + amount;
- SPEI: unique CLABE + amount;
- TOKA employee benefit: RFC, fallback CURP;
- name: warning/advisory only when exact financial identity is already unique;
- cover `Banco` text is descriptive and is not the routing authority;
- one employee may be present in the cover with zero net and no payout rail.

The real sample reconciles:

- `17/17` same-bank records;
- `5/5` SPEI records;
- one zero-net cover person;
- voucher benefit exactly to the TOKA complement;
- cover cash exactly to same-bank + SPEI.

## Server trust boundary

The public materialization operation continues to accept only:

- capture session id;
- expected version;
- idempotency key.

For each file the Edge function still:

`SERVER DOWNLOAD -> PATH/MIME/SIZE -> SHA-256 -> SERVER PARSE -> CROSS-CHECK -> ATOMIC MATERIALIZATION`

Browser parser metadata is diagnostic only.

The real formats are server-parsed as:

- cover -> `payroll_real_formats.parseCoverXlsx`;
- same bank -> `parseSameBank108`;
- SPEI -> existing canonical `parsePayrollSpeiTxt`;
- TOKA funding -> existing canonical `parsePayrollSpeiTxt`;
- TOKA CFDI -> `parseTokaCfdi`;
- package -> `payroll_real_reconcile.reconcilePackage`.

## Optional channel contract

Channels remain declared per run. The file inventory is conditional:

- `banco` -> `layout_mismo_banco` required;
- `spei` -> `layout_spei` required;
- `vales` -> both `layout_toka` and `cfdi_vales` required.

A channel not declared is not required. Cover amounts that imply an undeclared rail still fail package reconciliation.

## Explicit exclusions

N3F does not:

- calculate payroll;
- interpret the incident email as formulas;
- persist real employee source files in Git;
- create an employee master;
- generate bank layouts;
- upload anything to BBVA or TOKA;
- disperse money;
- reconcile post-bank receipts;
- touch PROD or `main`.

## Proposed DEV schema/runtime change

Migration `20260820002000_payroll_n3f_real_formats_toka_funding.sql` is a forward candidate and is not applied by the Draft gate. It:

- admits zero-net snapshot rows;
- extends the existing `vales` channel with benefit/fee/tax/expected funding fields;
- adds staged `layout_toka` support;
- promotes real cover/same-bank/TOKA-CFDI parser metadata to the same server-reverified staging pattern already used by SPEI;
- requires both TOKA documents when `vales` is declared;
- stores actual treasury channel amount separately from employee benefit;
- adds a Finance-only funding-variance acknowledgement RPC and a pre-submit guard;
- keeps payroll outside weekly approval batches and normal Flux layout generation.

## Gate

`REAL_PHYSICAL_CONTRACTS_IDENTIFIED / SANITIZED_TESTS_REQUIRED / DEV_MIGRATION_NOT_APPLIED / DEV_EDGE_NOT_DEPLOYED / REAL_PAYROLL_NOT_MATERIALIZED / PROD_UNTOUCHED / MAIN_UNTOUCHED`
