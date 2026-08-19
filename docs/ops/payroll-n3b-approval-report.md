# Payroll N3B — Individual approval discovery and draft contract

Status: `DRAFT_PR_ONLY / DEV_DB_UNTOUCHED / PROD_UNTOUCHED`

Baseline DEV: `cc778e76193ab2e578ad2021d61d8b9b9329273f`.

## Product contract

N3B does not create a parallel payroll approval system. It reuses the existing individual payment-request approval path:

`N3A materialized draft -> Finance submit -> selected approver -> decide_payment_request -> approved/rejected/changes_requested`

Payroll remains excluded from weekly approval batches and from Flux-generated bank layouts.

## Discovery confirmed against DEV

- `approval_batch_request_eligibility()` returns `payroll_uses_separate_flow` for `payroll/nomina` requests. N3B does not redefine it.
- `decide_payment_request()` writes `payment_request_approvals` and transitions the request to `approved`, `rejected`, or `changes_requested`.
- `payment_request_decision_notification_event` already enqueues decision notifications after an approval record is inserted. N3B does not fork that notification engine.
- Normal request creation selects an approver from `approver_assignments` when an active requester/company pool exists; otherwise it uses `approval_rules`.
- `validate_payment_request_approver_scope_update` makes approver selection immutable after creation. N3B therefore adds one narrowly validated exception for the N3A state `nomina + draft + no approver` to become `submitted` with one approver snapshot.
- `payment_requests` is directly updatable by authenticated users under RLS, so payroll status transitions need a database guard rather than relying only on UI/RPC routing.
- `payment_request_approvals` is readable by the UI for history; decisions in `solicitudes.js` use `decide_payment_request()` rather than direct inserts.

## N3B draft design

### `submit_payroll_for_approval`

Authenticated RPC with internal Finance authorization. N3B v1 requires the submitting Finance profile to be the same profile stored as `requested_by` by N3A materialization.

It accepts only:

- `payment_request_id`
- `approver_id`
- optional `approver_assignment_id`

It cannot mutate payroll amount, channels, files, lines, company, period, source account, or server-verification evidence.

The transition is atomic:

`draft -> submitted`

with:

- `approver_id`
- `approver_assignment_id` when pool-routed
- `approver_selection_source`
- `submitted_at`

Retrying the same submitted request with the same approver snapshot returns `already_submitted` and produces no second status transition.

### One-time approver selection

The existing approver-update trigger remains active for all normal requests and all payroll updates except the exact N3B transition. A dedicated payroll trigger validates that transition and reuses:

- `payment_request_has_active_approver_pool`
- `approver_assignments`
- `is_payment_request_approver_for_company`
- `payment_request_rule_allows`

After submission, the existing approver immutability behavior applies again.

### Direct-decision bypass protection

`decide_payment_request()` currently does not itself require a pre-decision request status. N3B does not fork the function. Instead it adds payroll-only database guards:

- an approval record can be inserted only for a materialized `submitted` payroll request and only by the selected approver;
- a direct payroll status transition from `submitted` to a decision state requires the matching approval record to have been created in the same transaction.

This keeps normal requests unchanged while preventing a payroll draft from skipping submission.

### Submission notification

N3A deliberately suppresses `payment_request.created` at materialization time. Because N3B submits by UPDATE, the normal INSERT trigger would not run. N3B therefore emits the same logical notification contract at `draft -> submitted` using the existing idempotency key:

`payment_request.created:<request_id>:approver`

Materialization remains notification-free; submission creates one logical approver notification; retries do not duplicate it.

### Decision and rejection

Decisions continue through `decide_payment_request()` and the existing `payment_request_decision_notification_event` trigger. Rejection changes only request/approval state and preserves:

- `payroll_channels`
- `payroll_run_files`
- `payroll_run_lines`
- capture provenance
- server hashes
- server verification summary

No automatic return to draft is introduced in N3B.

## Explicit exclusions

N3B does not:

- apply its migration in DEV;
- create a Finance profile or temporary role;
- materialize real payroll;
- modify the N3A migration;
- alter weekly approval batch eligibility;
- generate PAGOSBBV/PAGOSINT/CIE;
- disperse through BBVA Net Cash or TOKA;
- reconcile payments;
- touch PROD or `main`.

## Physical-format blocker

Real payroll remains blocked by the mandatory cover adapter:

`COVER_SHEET_XLSX = UNSUPPORTED_PENDING_SOURCE_CONTRACT`

Additional format states remain:

- SPEI: `CERTIFIED / SUPPORTED`
- BBVA same-bank: `PENDING_FORMAT_CERTIFICATION`
- TOKA XML: `CONDITIONAL / PENDING`

## Target gate result

`PASS / PAYROLL_N3B_DISCOVERY_COMPLETE / EXISTING_INDIVIDUAL_APPROVAL_REUSE_CONFIRMED / WEEKLY_BATCH_EXCLUSION_PRESERVED / PAYROLL_ONE_TIME_APPROVER_SELECTION_READY / PAYROLL_DIRECT_DECISION_BYPASS_BLOCKED / PAYROLL_SUBMIT_CONTRACT_READY / PAYROLL_SUBMISSION_NOTIFICATION_EXACTLY_ONCE / PAYROLL_DECISION_NOTIFICATION_REUSE_CONFIRMED / PAYROLL_REJECTION_PRESERVES_MATERIALIZATION / PAYROLL_LAYOUT_ISOLATION_PRESERVED / DRAFT_PR_READY / DEV_DB_UNTOUCHED / REAL_PAYROLL_STILL_BLOCKED_BY_COVER / DISPERSION_NOT_STARTED / PROD_UNTOUCHED`
