# Payroll N3B — Individual approval DEV certification

Status: `DEV_APPLIED_AND_CERTIFIED / PR_DRAFT / SYNTHETIC_ROLLBACK_UAT_PASS / PROD_UNTOUCHED`.

Git baseline DEV before N3B: `cc778e76193ab2e578ad2021d61d8b9b9329273f`.

## Product contract

N3B does not create a parallel payroll approval system. It reuses the existing individual payment-request approval path:

`N3A materialized draft -> Finance submit -> selected approver -> decide_payment_request -> approved/rejected/changes_requested`

Payroll remains excluded from weekly approval batches and from Flux-generated bank layouts.

## Discovery confirmed against DEV

- `approval_batch_request_eligibility()` returns `payroll_uses_separate_flow` for `payroll/nomina` requests. N3B does not redefine it.
- `decide_payment_request()` writes `payment_request_approvals` and transitions the request to `approved`, `rejected`, or `changes_requested`.
- `payment_request_decision_notification_event` already enqueues decision notifications after an approval record is inserted. N3B does not fork that notification engine.
- Normal request creation selects an approver from `approver_assignments` when an active requester/company pool exists; otherwise it uses `approval_rules`.
- `validate_payment_request_approver_scope_update` makes approver selection immutable after creation. N3B adds one narrowly validated exception for `nomina + draft + no approver` to become `submitted` with one approver snapshot.
- `payment_requests` is directly updatable by authenticated users under RLS, so payroll status and materialized fields require database guards rather than UI-only routing.
- `payment_request_approvals` was readable and directly writable at the table privilege surface even though the product writes decisions through `decide_payment_request()`. N3B preserves authenticated `SELECT`, revokes authenticated/anon direct DML, and keeps the existing decision RPC executable.

## Applied DEV migrations

Supabase DEV ledger records exactly one application of each forward migration:

1. `20260819213907_payroll_n3b_individual_approval.sql`
2. `20260819213919_payroll_n3b_approval_write_hardening.sql`
3. `20260819214917_payroll_n3b_post_decision_freeze.sql`

The Git filenames are aligned to those authoritative remote versions. No migration repair was used.

The first attempt to apply the functional migration failed inside its transaction because PL/pgSQL requires parentheses around `CASE` when used after `IS DISTINCT FROM`. The failed transaction left no migration ledger entry or partial schema. The source was corrected in Git, covered by a contract assertion, CI passed, and the corrected migration was then applied once.

## `submit_payroll_for_approval`

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

Retrying the same submitted request with the same approver snapshot returns `already_submitted` and produces no second status transition or submission notification.

## One-time approver selection

The existing approver-update trigger remains active for all normal requests and all payroll updates except the exact N3B transition. A dedicated payroll trigger validates that transition and reuses:

- `payment_request_has_active_approver_pool`
- `approver_assignments`
- `is_payment_request_approver_for_company`
- `payment_request_rule_allows`

After submission, approver selection and `submitted_at` are immutable.

## Direct-decision and direct-write protection

N3B keeps `decide_payment_request()` as the approval rule engine and does not redefine it.

Payroll-only database guards require:

- approval rows only for a valid materialized `submitted` payroll request;
- the approval actor to equal the selected approver;
- action/from/to-state consistency;
- the matching approval row to exist in the same transaction before `submitted -> approved/rejected/changes_requested` can occur.

Additionally, authenticated and anon direct `INSERT/UPDATE/DELETE` privileges on `payment_request_approvals` are revoked. Authenticated users retain `SELECT` for approval history and `EXECUTE` on `decide_payment_request()`.

## Materialization and post-decision freeze

After N3A materialization, payroll financial/material fields are immutable at the `payment_requests` surface, including company, source account, cost center, budget context, amount, currency, requester, payroll period/subtype, provider fields, payment method, extraordinary flag, concept, description and notes.

`submitted_at` is created only on the one-time `draft -> submitted` transition.

After a decision, payroll status is frozen in `approved`, `rejected` or `changes_requested`. N3B does not permit transition to paid/scheduled/execution states. A later dispersion phase must explicitly introduce the next lifecycle transition.

## Submission and decision notifications

N3A suppresses `payment_request.created` at materialization time. N3B emits the same logical notification contract on `draft -> submitted` with idempotency key:

`payment_request.created:<request_id>:approver`

Synthetic certification proved exactly one logical submit notification across a retry.

Decision notifications continue through the existing:

`payment_request_approvals -> payment_request_decision_notification_event -> enqueue_payment_request_decision_notification()`

Approval and rejection produced their expected decision events without employee PII in payloads.

## Synthetic rollback UAT

The DEV certification used two fully synthetic payroll model fixtures marked `NÓMINA TEST N3B - NO PAGAR`, entirely inside one explicit transaction that ended with `ROLLBACK`.

Because DEV has no active Finance profile, one pre-existing inactive Finance profile was temporarily activated only inside the rollback transaction. A Finance company membership and approver assignment were also created only inside that transaction. No role, email or persistent IAM record was changed.

The UAT proved:

- non-Finance submit denied with `PAYROLL_FINANCE_REQUIRED`;
- Finance submit of its own materialized payroll succeeds;
- retry returns `already_submitted` and does not duplicate notification;
- weekly batch eligibility remains false with `payroll_uses_separate_flow`;
- materialized payment fields cannot be edited;
- `submitted_at` cannot be rewritten;
- selected approver can approve one synthetic payroll and reject another;
- approval/rejection ledger rows are created through the existing decision RPC;
- approval/rejection notifications are generated by the existing notification engine;
- a second payroll decision is blocked;
- post-decision transition to payment is blocked;
- payroll channels, run files, run lines and materialization evidence remain intact through approval/rejection;
- approval batch items = 0;
- payment layout lines = 0;
- bank actions = 0.

The transaction returned `PAYROLL_N3B_SYNTHETIC_ROLLBACK_UAT / PASS` and then rolled back.

## Post-UAT cleanup proof

Read-only postchecks outside the UAT transaction confirmed:

- payroll requests = 0;
- capture sessions/files = 0;
- payroll-private objects = 0;
- payroll channels/run files/run lines = 0;
- payroll approvals/batch items/layout lines/notifications = 0;
- synthetic request/activity markers = 0;
- temporary Finance membership = 0;
- temporary approver assignment = 0;
- the Finance profile returned to inactive;
- active Finance profiles in DEV = 0.

The dependency remains:

`PAYROLL_ACTIVE_FINANCE_PROFILE_REQUIRED_BEFORE_RECURRENT_OR_REALISTIC_UAT`

## Physical-format blocker

Real payroll remains blocked by the mandatory cover adapter:

`COVER_SHEET_XLSX = UNSUPPORTED_PENDING_SOURCE_CONTRACT`

Additional format states remain:

- SPEI: `CERTIFIED / SUPPORTED`
- BBVA same-bank: `PENDING_FORMAT_CERTIFICATION`
- TOKA XML: `CONDITIONAL / PENDING`

## Explicit exclusions

N3B does not:

- materialize a real payroll;
- persist synthetic UAT data;
- create or persist a Finance profile/role change;
- alter weekly approval batch eligibility;
- generate PAGOSBBV/PAGOSINT/CIE;
- disperse through BBVA Net Cash or TOKA;
- reconcile payments;
- touch PROD or `main`.

## Gate result

`PASS / PAYROLL_N3B_MIGRATIONS_APPLIED_DEV / PAYROLL_N3B_APPROVAL_WRITE_HARDENED / PAYROLL_N3B_SYNTHETIC_ROLLBACK_UAT_PASS / PAYROLL_FINANCE_SUBMIT_PASS / PAYROLL_NON_FINANCE_SUBMIT_BLOCKED / PAYROLL_SUBMISSION_NOTIFICATION_EXACTLY_ONCE / PAYROLL_APPROVAL_PASS / PAYROLL_REJECTION_PASS / PAYROLL_DECISION_REPLAY_BLOCKED / PAYROLL_MATERIALIZED_REQUEST_IMMUTABLE / PAYROLL_POST_DECISION_FROZEN / WEEKLY_BATCH_EXCLUSION_PRESERVED / PAYROLL_LAYOUT_ISOLATION_PRESERVED / PAYROLL_UAT_CLEANUP_PASS / PR_DRAFT / REAL_PAYROLL_STILL_BLOCKED_BY_COVER / DISPERSION_NOT_STARTED / PROD_UNTOUCHED / MAIN_UNTOUCHED`
