# Payroll N5B — budget UX integration

## Purpose

N5B connects the N5A budget gate to the existing payroll capture experience without changing database contracts.

The backend already blocks payroll submission unless the current budget result is `aprobable`. N5B makes that dependency visible before Finance reaches the submit action.

## Capture behavior

When a materialized payroll draft is open in `solicitudes.html`, N5B reads the existing session and aggregate submission summary.

If `budget_ready = false`:

- the payroll approval section is visually blocked;
- the approver selector / submit action are not available;
- a visible budget panel explains whether the request is pending or blocked;
- Finance receives a `Configurar presupuesto` CTA;
- the CTA opens `nomina_presupuesto.html?request_id=<payroll-request>`.

If `budget_ready = true`:

- the N5B visual block is removed;
- the panel shows the validated month and available-after amount;
- existing N3G rules still decide whether approval is visible, including the TOKA variance acknowledgement gate.

N5B never forces the approval section visible. It only adds or removes its own budget-specific block class.

## Deep link

`payroll_budget_deeplink.js` reads the validated `request_id` query parameter and selects the matching row in the N5A budget queue once it is rendered.

The query parameter does not authorize access. The existing N5A Finance/requester/company RPC rules remain authoritative.

## Preservation of existing frontend budget guards

`solicitudes.html` already loads `budget_live_frontend_guards.js` last.

N5B preserves the exact pre-N5B file as `budget_live_frontend_guards_base.js` and turns the existing loaded path into a small wrapper that:

1. loads the preserved base guard from the same origin;
2. waits for it to load;
3. installs the N5B payroll-only visual gate.

The N5B contract test verifies the preserved base file using its Git blob SHA.

## Security / privacy

N5B reads only:

- `get_payroll_capture_sessions(...)`;
- `get_payroll_submission_summary(...)`.

It introduces no new database mutation, migration, Storage call, Edge invocation, approval RPC or bank action.

The panel renders only aggregate budget status, month and available-after amount. It does not render employee PII or banking identifiers.

## Explicit exclusions

- no migration;
- no new RPC;
- no payroll calculation;
- no budget calculation in browser;
- no provision percentages;
- no materialization change;
- no approval workflow change;
- no bank action;
- no PROD/main changes in N5B DEV certification.
