# Payroll N5A — Budget gate before approval

## Purpose

N5A closes the budget-control gap between certified payroll materialization and the existing N3B individual approval flow.

Flux does **not** calculate payroll and N5A does not introduce legal/employer provision factors. It reuses the existing Flux budget model:

- `budget_lines`
- `budget_versions`
- `company_cost_center_budget_categories`
- `budget_availability`
- `verify_budget_availability(...)`

## Problem closed by N5A

Before N5A, a materialized payroll request could remain with:

- `budget_category_id = null`
- `budget_month = null`
- `budget_decision = not_checked`

and `submit_payroll_for_approval(...)` did not require a current budget decision.

Because `budget_availability.committed` and `.executed` only count requests with `budget_decision='aprobable'`, such payroll could move through approval without becoming a budget commitment.

## N5A lifecycle

1. Payroll physical package is materialized independently by N3A/N3F/N3G.
2. While the materialized request is still `draft`, Finance opens `nomina_presupuesto.html`.
3. Finance selects budget month + allowed budget category for the existing company/cost center.
4. `set_payroll_budget_context(...)` stores that narrow context and calls the canonical existing budget validation.
5. Flux snapshots `budget_decision`, available before/after, shortfall, checked time and result.
6. At `submit_payroll_for_approval(...)`, Flux locks the matching active `budget_lines` row and runs the budget validation again.
7. Only `aprobable` may transition `draft -> submitted`.
8. Existing `budget_availability` automatically counts the submitted payroll as `committed`.
9. Existing N4B `paid` close automatically moves the same request into `executed` reporting.

## Concurrency

The submit-time check locks every active budget line for the exact:

`company + cost center + category + month`

scope with `FOR UPDATE`.

Concurrent payroll submissions for the same budget scope therefore serialize. The later transaction evaluates `budget_availability` after the earlier transaction commits.

## Immutability

Materialized payroll remains immutable.

The only new exception is budget context (`budget_category_id`, `budget_month`) while status is `draft`, and only when `set_payroll_budget_context(...)` places the transaction-local N5A token.

Budget validation snapshot fields are separately server-owned and require the N5A snapshot token.

Direct `draft -> submitted` is also blocked. The status guard requires the transaction-local `app.payroll_n5a_submit` token set only by the budget-gated submit RPC.

N4B `approved -> paid` gating remains preserved.

## Finance UI

`nomina_presupuesto.html` shows aggregate data only:

- request / company / cost center
- payroll period
- Treasury total
- budget month
- allowed budget categories
- budgeted / committed / executed / available
- current budget decision and last validation

The UI does not expose employee PII and does not upload files, generate layouts or execute payments.

## Explicit exclusions

- no payroll calculation
- no employee-level budget calculation
- no IMSS/ISR/aguinaldo/vacation provision percentages
- no new budget table
- no budget-line mutation or backfill
- no automatic budget creation
- no bank action
- no PROD/main changes in N5A DEV certification
