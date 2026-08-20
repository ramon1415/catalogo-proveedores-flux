# Payroll N4A — Manual dispersion by channel

## Purpose

N4A records the operational result of a payroll dispersion that Finance executes **outside Flux**. Flux does not calculate payroll, generate bank layouts, connect to BBVA/TOKA, execute payments, or mark a payroll request paid in this slice.

## Preconditions

A payroll request must:

- be `request_type = nomina`;
- be `status = approved`;
- have a valid N3A/N3F materialization;
- contain one or more `payroll_channels`;
- remain in the separate payroll flow and outside weekly approval batches.

Only Finance/Treasury roles with active company membership can mutate dispersion state.

## Reused data model

No new business table is introduced.

`payroll_channels` already contains:

- `dispersion_status` — `pending | dispersed | failed`;
- `dispersed_at`;
- `dispersed_by`;
- `dispersion_note`;
- later reconciliation fields reserved for N4B.

The existing redacted payroll audit trigger records changed field names without monetary values or payroll PII.

## RPCs

### `get_payroll_dispersion_queue()`

Finance-only queue of approved, materialized payroll runs accessible to the current Finance profile. Returns only request/company/amount/channel-count summary data.

### `get_payroll_dispersion_summary(payment_request_id)`

Aggregate summary for a payroll run. It derives:

- `pending`;
- `partial`;
- `failed`;
- `dispersed`.

The summary exposes no employee rows, RFC, CURP, NSS, account, CLABE, or raw bank references.

### `record_payroll_channel_dispersion(...)`

Allowed actions:

- `pending -> dispersed`;
- `pending -> failed` with a required 3–500 character operational note;
- `failed -> dispersed` after a successful retry.

A `dispersed` channel is final in N4A. Repeating `dispersed` is idempotent. Repeating the same failure note is idempotent; rewriting an existing failure note is blocked.

## Request lifecycle

N4A intentionally **does not change `payment_requests.status`**. An approved payroll request remains `approved`; the operational dispersion state is derived from its channels.

This avoids reopening the N3B post-decision status freeze and avoids triggering unrelated payment-request lifecycle behavior.

## UI

`nomina_dispersion.html` is a Finance-only operational page.

It displays:

- approved payroll requests;
- company;
- approved Treasury amount;
- channel amounts;
- channel dispersion status;
- dispersion timestamps.

It can only call the N4A RPCs. It contains no Storage upload, Edge invocation, layout generation, bank call, approval decision, or paid-state mutation.

## Explicit exclusions

- No real bank action.
- No automatic payment execution.
- No receipt/comprobante upload.
- No reconciliation.
- No `paid`, `scheduled`, or `finance_validation` transition.
- No employee email or receipt delivery.
- No PROD or `main` changes in the DEV certification gate.

## Next slice

N4B will attach channel-level comprobantes using the existing `payroll_run_files(kind='comprobante')` contract, perform controlled reconciliation by channel, and only then define the final request-level paid transition.
