# Payroll N3G — real capture UI

Status: `DRAFT / UI_AND_RPC_CONTRACT_VERSIONED / DEV_DB_NOT_APPLIED / EDGE_NOT_DEPLOYED / PROD_UNTOUCHED`.

Baseline DEV: `ab1aa6610b40b9e398ac756eddf1675964595bd3` (N3F merged).

## Purpose

N3G connects the N3F-certified real physical payroll contracts to the Finance workflow in `solicitudes.html`. Flux still does not calculate payroll and still does not disperse money.

## Finance flow

1. Select `Nómina`.
2. Capture company, source account, cost center, ordinary/extraordinary subtype and period.
3. Declare active rails: BBVA same bank, SPEI and/or TOKA.
4. Upload the physical package conditionally:
   - cover XLSX always;
   - `Nomina 108` TXT when same-bank is used;
   - SPEI TXT when interbank is used;
   - TOKA funding TXT + TOKA CFDI XML when vouchers are used.
5. Save to the private `payroll-private` staging bucket.
6. Invoke JWT-protected `payroll-materialize`.
7. Server downloads, hashes, reparses and reconciles all active physical files.
8. Show aggregate controls only:
   - employee net;
   - actual Treasury outflow;
   - channel totals;
   - TOKA benefit/fee/VAT/expected funding/actual funding.
9. If TOKA funding differs from expected funding, Finance must record an acknowledgement note.
10. Load eligible approvers from the existing individual approval pool/rules and submit with `submit_payroll_for_approval`.

## No employee PII in the Finance summary UI

The capture/summary controller does not render employee names, RFC, CURP, NSS, account numbers, CLABE or raw bank references. Employee-level snapshots remain protected by the existing payroll RLS contract.

## Accounting context

N3A materialization and approval rules require a cost center. N2B staging did not persist it from the payroll UI. N3G adds `save_payroll_capture_session_n3g`, which validates the selected cost center through the existing `company_cost_centers` mapping and persists it on the capture session.

No new accounting table or hardcoded cost center is introduced.

## Staging authority

- SPEI may keep browser parser metadata as diagnostics: `client_parsed_unverified / browser_client_attested`.
- Cover, same-bank, TOKA funding and TOKA CFDI remain `server_verification_pending / server_only`.
- Every physical file is still authoritative only after server redownload + SHA-256 + server parser.

## Materialization retry

N3G preserves the original pre-materialization version as a safe retry key after successful materialization. `get_payroll_materialization_context_internal` allows exactly the current version or `current - 1` only for a materialized session. The internal materializer still returns `already_materialized` only when the idempotency hash exactly matches the original request.

This closes the network-timeout retry gap without opening a stale-write path.

## Aggregate submission summary

`get_payroll_submission_summary` is Finance-only and returns only aggregate/business workflow fields:

- request id/status;
- company/cost center;
- employee net total;
- Treasury amount requested;
- payroll period/subtype;
- channel totals and TOKA funding breakdown;
- variance acknowledgement state;
- selected approver snapshot once submitted.

It does not return employee rows or bank identifiers.

## Explicit exclusions

N3G does not:

- calculate payroll;
- change employee net values;
- generate bank layouts;
- upload to BBVA/TOKA;
- mark requests paid or scheduled;
- add weekly approval batches;
- implement dispersion;
- implement post-bank reconciliation;
- touch PROD or `main`.

## Draft gate

Before any persistent DEV apply:

1. static/syntax CI;
2. Vercel Preview;
3. transactional migration dry-run with rollback;
4. zero-state postcheck.

After a successful DEV apply, only synthetic rollback UAT is allowed until Finance performs visual UAT. Real payroll materialization remains separately authorized.
