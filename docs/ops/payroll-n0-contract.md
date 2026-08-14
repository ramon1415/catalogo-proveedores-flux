# Payroll N0 foundation contract

Status: **review draft; do not apply to DEV in N0**

Target branch: `dev`

Baseline audited: 2026-08-14

## A. Baseline

- DEV HEAD: `360864050c739cc185f79cb58a5fe35e0d1e9795`.
- MAIN reference: `7295a7a11a9015ca24d5f73144d3745a64bb6396`.
- DEV project: `scsirgbuqjcwoaxfacth`, PostgreSQL 17.6, read-only discovery.
- DEV migration ledger:
  - `20260811035345 flux_dev_authoritative_brownfield_baseline_v2`
  - `20260811035346 043_provider_intake_payment_draft`
  - `20260811215129 044_provider_intake_payment_conversion`
  - `20260811230137 045_provider_intake_ramon_uat_product_improvements`
  - `20260812001555 046_provider_aware_intake_links`
  - `20260812210013 047_fix_dev_layout_candidate_recursion`
  - `20260813005145 048_allow_sysadmin_provider_intake_links`
  - `20260813011425 049_snapshot_bbva_cie_convenio_number`
- No payroll/nomina tables, migrations, source fixtures, parsers, or UI implementation exist in DEV.
- The only historical payroll behavior is a fail-closed exclusion in approval flows: `approval_batch_request_eligibility` returns `payroll_uses_separate_flow`, and `begin_extraordinary_authorization` rejects payroll/nomina.
- All 257 remotely accessible refs were searched for `fwdnom15_2026operadoratlacatecpan`, `nomina`, `nómina`, `payroll`, `001001`, `TOKA`, `caratula`, and payroll/SPEI variants. No superseded implementation was recovered.

MAIN and DEV intentionally differ at this cut. N0 starts from DEV and does not reconcile or rebase MAIN.

## B. Existing-system audit

### Payment request

`payment_requests.request_type` is the canonical parent discriminator. Provider fields are nullable. The existing source-account field is `company_bank_account_id`; it must reference an existing company account and is not duplicated for payroll.

The current request constraint requires at least one event or `cost_center_id`. Payroll therefore keeps `cost_center_id` required. The N0 draft also requires company, source account, subtype, and period, and forbids provider/provider-account values for payroll only. Existing request rows remain unchanged.

### Approval

The current batch/Director/Finance release model approves one `payment_requests.amount_requested`. That matches the approved rule: one payroll run is one request and approval is for the run total, not employees or channels.

N0 leaves approval fail-closed. N3 must make a narrow change to `approval_batch_request_eligibility`: accept `request_type=nomina` without a provider, retain company/cost-center/budget/amount checks, and remove only `payroll_uses_separate_flow` after capture and RLS are live. No new approval engine is justified.

### Attachments and storage

`upload_helper.js` and the shared `payment-receipts` bucket are not reusable for payroll PII: their MIME contract excludes XLSX/TXT/XML as a set and the bucket has temporary anonymous policies. Existing private payment-batch storage is PDF-specific.

The draft therefore defines a dedicated private `payroll-private` bucket with opaque `{payment_request_uuid}/{file_uuid}.{ext}` paths, a 25 MiB ceiling, a MIME allowlist, Finance-only interactive policies, and no delete policy. It does not upload anything.

### Layouts

`create_payment_layout` consumes `approval_batch_payment_layout_candidates`. Payroll layouts are processor-provided and must never become PAGOSBBV, PAGOSINT, or CIE lines. The draft filters payroll from the candidate wrapper and also rejects any direct `payment_layout_lines` insert/update for a payroll request.

### Receipt batches

The existing ingestion/evidence path is BBVA PDF-oriented. `payment_request_receipt_links` has unique constraints on request, operation, and evidence. Its one-receipt-per-request cardinality cannot represent banco, SPEI, and vales receipts for one payroll request.

Result: `PAYROLL_CHANNEL_RECEIPT_EXTENSION_REQUIRED`. Do not weaken or overload the existing link.

### Budget

`budget_lines` is the correct forecast target and has a monthly uniqueness contract by version, company, cost center, category, and month. It has no payroll provenance/idempotency field. N5 must use a deterministic monthly recompute/upsert or add the minimum generic provenance contract before automatic accrual; incremental inserts on retries are unsafe.

### Roles and RLS

Canonical live roles include 2 Finance, 7 Director, 3 SysAdmin, and 2 SuperAdmin profiles. There is no RH role. The two Finance profiles currently have no active company-membership row, so a company-membership requirement would deny the required Finance access.

N0 therefore defines an explicit interactive PII gate for `finance`, `finanzas`, `treasury`, `tesoreria`, or `administracion`. It deliberately does not call `flux_finance_roles()`, because that helper also includes SysAdmin. Interactive SysAdmin, Director, requester, generic authenticated, anon, and public do not receive payroll-person or payroll-file access. Platform `service_role` remains the controlled server path and is not an interactive role.

DEV also has pre-existing, non-payroll tables with RLS disabled. That advisory is outside N0 and is not altered by this proposal.

## C. Locked payroll data model

### `payment_requests` additive extension

| Field | Contract |
| --- | --- |
| `request_type` | New enum value `nomina` |
| `payroll_subtype` | `ordinaria` or `extraordinaria`, payroll only |
| `payroll_period_start` | Required for payroll |
| `payroll_period_end` | Required for payroll; start must not exceed end |
| `company_id` | Existing field; required for payroll |
| `company_bank_account_id` | Existing field; required source account |
| `cost_center_id` | Existing field; retained for approval/budget reuse |
| `amount_requested` | Exact run total |
| provider fields | All null for payroll |

There is no `payroll_runs` parent. There is no employee master and no synthetic “Nómina” provider.

### `payroll_channels`

One relational row for each required aggregate channel: `banco`, `spei`, or `vales`. V1 permits at most one row per request/channel. Each row stores exact amount/currency, external layout reference, dispersion state/actor/time, and reconciliation state/actor/time. JSONB channels are prohibited.

A deferred database guard enforces:

`payment_requests.amount_requested = SUM(payroll_channels.amount)`

The deferral allows the request and all channel rows to be created or adjusted atomically in one future Finance RPC.

### `payroll_run_files`

Finance-only file metadata for:

- `caratula`
- `layout_mismo_banco`
- `layout_spei`
- `layout_toka`
- `cfdi_vales`
- `comprobante`
- `cfdi_nomina`
- `otros`

It records opaque storage location, safe original filename metadata, MIME, byte size, SHA-256, uploader/time, parser state/version, and an allowlisted redacted parsing summary. Raw rows, identifiers, accounts, and salaries are forbidden in parsing metadata.

### `payroll_run_lines`

One row per person per request. It is a run snapshot, not a master. It stores name, RFC, CURP, NSS, bank/account/CLABE, exact net/bank/SPEI/vouchers amounts, the cover source row, and reconciliation state.

The database enforces:

`net_amount = bank_amount + spei_amount + vouchers_amount`

No PII indexes are created. The only line index is request/source-row oriented.

### Receipt extension for N4

The locked relational shape is `payroll_channel_receipt_links`, not a change to the normal receipt link:

- `id`
- `payroll_channel_id`
- exactly one of `payment_operation_evidence_id` or `payroll_run_file_id`
- amount, currency, payment date
- `linked_by`, `linked_at`
- stable idempotency key
- unique channel/evidence contracts
- append-only/immutable trigger

This table is intentionally not in the N0 foundation migration. Its implementation belongs with the N4 atomic reconciliation RPC and real controlled receipt examples.

### Provision configuration for N5

No suitable live factor table exists. The proposed configuration shape is `payroll_provision_factors(company_id, concept_code, factor, budget_category_id, effective_from, effective_to, active)`. It is configuration, not an accrual ledger. No legal rate or formula is hardcoded, and no provision table is added in N0.

## D. PII contract

High-PII fields are employee name, RFC, CURP, NSS, bank name, account, CLABE, and all person-level amounts. The source files and filenames are also treated as PII-bearing.

| Actor | Channel summary | Files/person detail |
| --- | --- | --- |
| Finance canonical role | Yes | Yes |
| Requester for the run | Yes | No |
| Assigned approver / active company Director | Yes | No |
| RH | Not applicable; no canonical role exists | No |
| SysAdmin / SuperAdmin interactive role | No | No |
| Generic authenticated | No | No |
| Anon / public | No | No |
| Controlled `service_role` | Server-only | Server-only |

New tables enable and force RLS. Direct authenticated writes are revoked; future mutations must use narrow Finance RPCs. Sensitive audit triggers store actor, table, row ID, timestamp, operation, and changed field names only. Old/new PII and monetary values are never copied to `activity_log`.

## E. Source evidence and gates

| Evidence | SHA-256 | What it proves | What it does not prove |
| --- | --- | --- | --- |
| `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm` | `cc5b4376a2bd7c9b8e1de02b29cafbf186e03d371bc0b9ce7364bc4da26df556` | A BBVA simulator-derived workbook contains hidden payroll variants and VBA artifacts | Generated payroll TXT bytes, offsets, encoding, or acceptance |
| `Qna 15_2026 AFE Macro TOKA.xlsm` | `66f20373ceea98aec461ff91526a182c2155bc1435e807fc0f88fc1ff042450d` | The same simulator family and payroll input-sheet concepts exist | TOKA XML contract or generated payroll TXT bytes |
| `spec_solicitud_nomina.md` | `c18796c80ad446ee6cab98e6f6e848f6d908dd705a431779d6af2f46dabe16db` | Internal functional intent | A bank, XLSX, or fiscal file specification |
| `PAGOSINT_TEST_PR182_INTERBANCARIO.txt` | Repository test artifact | Existing generic PAGOSINT behavior | Payroll SPEI equivalence |

Safe workbook introspection confirmed input concepts for `Pagos Mismo Banco`, `Pagos Interbancarios`, `Nomina 108`, `Nomina TR`, and `Nomina 232`. It did not recover generated payroll TXT files or a fully extractable/verified VBA output contract. No cover-sheet XLSX or TOKA XML fixture was found. No real employee data was copied into the repository.

Evidence gate by source:

| Source | Structured schema proven | Physical format proven | N0 result |
| --- | --- | --- | --- |
| Carátula XLSX | Concept only | No workbook fixture/header contract | File adapter blocked |
| Same-bank payroll TXT | Input concepts only | No offsets/record length/encoding | Byte parser blocked |
| Payroll SPEI TXT | Input concepts only | No proof it equals PAGOSINT | Byte parser blocked |
| TOKA XML | Concept only | No namespace/element fixture | XML adapter blocked |

Required next evidence is one controlled, de-identified or authorized real example of each source, with known totals and source account where applicable. TXT examples must preserve original bytes and be accompanied by channel identification; the review must derive record length, line endings, encoding, offsets, padding, constants, and header/trailer behavior. The XLSX must preserve sheet names and structured headers. TOKA needs an original XML with namespace/element meaning. Hash every source before analysis. Do not commit those originals.

## F. Parser boundary

`payroll_parser.js` is a pure UMD module at version `payroll-normalized-v1`. It performs no Supabase or file I/O and provides:

- exact string-to-minor-unit money parsing;
- deterministic text/identifier/account normalizers;
- contract-driven normalization of already extracted cover rows;
- normalization of already structured banco/SPEI and TOKA records;
- deterministic cross-source merge;
- person/channel/request total validation;
- stable redacted issue objects.

The physical adapters `parsePayrollCoverSheet`, `parsePayrollBbvaSameBank`, `parsePayrollSpei`, and `parsePayrollTokaXml` deliberately return `PAYROLL_SOURCE_FIXTURES_REQUIRED` and `PAYROLL_LAYOUT_FORMAT_UNSUPPORTED`. There are no inferred fixed-width offsets and no regex XML parser.

The repository has no package manifest, lockfile, Node-version contract, XLSX library, or XML dependency. N1 must choose the adapter runtime first. If the browser runtime remains authoritative, structured XLSX extraction needs a separately reviewed maintained library, while XML can use a namespace-aware structured DOM adapter. Neither decision is smuggled into N0.

The only committed fixture is labelled `INTERNAL_SYNTHETIC_MODEL_NOT_SOURCE_FORMAT`. It contains three clearly synthetic normalized people: one banco+vales, one SPEI+vales, and one without vales.

## G. Validation contract

Matching is fail-closed:

- Banco/SPEI: normalized account or CLABE, then exact amount; normalized name is secondary verification only.
- TOKA: RFC first, then CURP.
- Zero or multiple candidates are blocking. Fuzzy name matching never auto-accepts.
- Money is parsed from decimal strings into safe integer minor units. Floats are rejected.
- Per person: net equals banco + SPEI + vales.
- Per channel: person subtotals equal the channel row.
- Per request: channel total equals `amount_requested`.
- Cover cash equals banco + SPEI; cover vouchers equal vales.
- Source account and period are required and mismatches are blocking.
- No discrepancy is auto-corrected.

The parser exposes stable issue codes including the approved cover, layout, employee match, amount, total, source-account, period, PII, and provision-base failures. Issues contain only source/row/field context, never source values.

The banco/SPEI XOR is not enforced in N0 because the available physical sources do not prove it as an invariant across all valid runs.

## H. Approval integration

Reuse is designed, not activated:

1. N2 creates one payroll `payment_requests` row and its channels atomically after source validation.
2. N3 removes the current payroll-specific eligibility block and allows the existing request/batch/Director/Finance flow to approve the run total.
3. Directors read request and channel summary only.
4. Payroll remains excluded from normal layout candidates throughout.

No employee-level or channel-level approval is introduced.

## I. Layout exclusion

The migration draft has two independent guards:

1. `approval_batch_payment_layout_candidates` removes any request whose `request_type::text = 'nomina'`.
2. `payment_layout_lines_reject_payroll` raises `payroll_external_layout_required` on direct insert/update.

Normal PAGOSBBV, PAGOSINT, and CIE code paths are otherwise unchanged.

## J. Dispersion design

Flux never connects to BBVA or TOKA. Finance uses the externally supplied layout and later changes each required channel from `pending` to `dispersed`, recording actor and timestamp. Failed attempts require a note. No bank credentials are stored.

The `vales` row is one aggregate TOKA transfer even when the cover/CFDI contains many people.

## K. Receipt reconciliation design

Reconciliation is by channel, not person. Banco and SPEI can reference existing BBVA operation evidence when compatible; TOKA can reference a controlled payroll file. N4 must create an immutable `payroll_channel_receipt_links` row and atomically lock the request/channels, verify exact amount/currency and all required links, mark channels reconciled, and set the request `paid` only once. A stable idempotency key prevents retry duplication.

No `payment_receipt.linked` employee audience, employee email, provider email, or CFDI delivery is created.

## L. Provision design

Provision is budget forecast only. Finance configures itemized factors per company/concept/category/effective date. Flux multiplies an explicitly mapped structured cover base by the configured factor; unresolved sheet/header provenance raises `PAYROLL_PROVISION_BASE_UNRESOLVED`. PTU, finiquito, or any concept not representable by a configured simple factor remains outside automatic accrual.

N5 must write itemized monthly `budget_lines` through a deterministic idempotent recompute/upsert. It must never calculate legal payroll amounts, create a separate accrual ledger, or treat forecast as cash reservation/accounting liability.

## M. N0 tests

The N0 workflow runs:

- JavaScript syntax;
- exact money and normalized parser tests;
- merge/cross-source happy path;
- account-not-found, amount mismatch, duplicate, invalid layout record, unmatched TOKA identifier, source-account mismatch, and total-mismatch negatives;
- explicit physical-adapter fail-closed assertions;
- migration, RLS, redacted audit, relational-channel, no-PII-index, and layout-exclusion static contracts;
- existing CIE and payment-batch parser regressions.

Tests use synthetic data only and do not connect to Supabase.

## N. Migration draft

`supabase/migrations/20260814170907_payroll_n0_foundation_contract.sql` contains only the reviewed foundation: additive request fields, channels/files/person snapshots, exact constraints, private storage contract, strict RLS, redacted audit, and layout exclusion.

It has not been applied. N1 authorization must include a fresh DEV drift check, SQL review/lint, backup/precheck plan, application, postchecks, and RLS tests with controlled synthetic rows.

## O. Draft PR contract

Branch: `feature/ramon-payroll-n0-contract` from the audited DEV SHA.

Base: `dev`.

Title: `Define payroll foundation and parser contracts`.

State: Draft; never merge in N0.

## P. DEV mutation ledger

- Database DDL/DML: 0
- Migration apply: 0
- Storage writes/uploads: 0
- Real payroll rows/files: 0
- Deployments: 0

Only read-only introspection was performed against DEV.

## Q. PROD mutation ledger

- Queries: 0
- Writes: 0
- Migrations: 0
- Storage: 0
- Deployments: 0

## R. Open dependencies

1. `PAYROLL_SOURCE_FIXTURES_REQUIRED`: controlled original carátula XLSX, same-bank payroll TXT, payroll SPEI TXT, and TOKA XML.
2. `NO_FIXED_WIDTH_GUESSES`: byte parsers remain blocked until offsets, encoding, record length, line endings, and header/trailer rules are proven.
3. `PAYROLL_CHANNEL_RECEIPT_EXTENSION_REQUIRED`: implement the locked N4 link/RPC contract; do not relax the normal receipt uniqueness constraints.
4. Choose and security-review the N1 structured XLSX adapter/runtime.
5. Define exact cover-sheet provision-base header/cell provenance before N5.
6. Decide retention/deletion policy for private payroll files; N0 intentionally creates no delete policy.

## S. Recommended N1–N5 sequence

- **N1:** authorize/apply the reviewed foundation to DEV; validate RLS and enum/request constraints with synthetic data only.
- **N2:** Finance capture UI, private uploads, structured adapters, source reconciliation, and atomic request/channel creation.
- **N3:** minimal existing approval integration and manual dispersion state transitions.
- **N4:** immutable channel receipt links, evidence reconciliation, and idempotent paid closure.
- **N5:** configurable provision factors and deterministic budget forecast upsert.

No N1–N5 PR is authorized by this document.

## T. Decision log and final N0 gate

- Relational `payroll_channels`: **YES**
- JSONB channels: **NO**
- One `payroll_run_lines` row per person/run: **YES**
- Employee master: **NO**
- Provider per employee or fake payroll provider: **NO**
- Payroll layouts generated by Flux: **NO**
- Employee receipts emailed by Flux: **NO**
- Reconciliation: **CHANNEL LEVEL**
- Structured parsing: **YES**
- OCR/vision/fuzzy primary match: **NO**
- Provision: **BUDGET FORECAST**
- Factors: **ITEMIZED AND CONFIGURABLE**
- Real employee PII in repository/tests/logs: **NO**

Final N0 status:

`PASS / PAYROLL_N0_FOUNDATION_READY / PAYROLL_SOURCE_FIXTURES_REQUIRED / NO_FORMAT_GUESSES / DRAFT_PR_READY / DEV_DB_UNTOUCHED / PROD_UNTOUCHED`

This status becomes valid only after the branch tests pass and the Draft PR is opened. It does not authorize applying the migration.
