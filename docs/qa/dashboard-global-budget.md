# Dashboard: global consumption

The operational report counts spending against the unchanged active monthly budget.
It includes ordinary requests, payroll, non-budget requests (including Sin partida),
approved exceptions and IMSS/ISN obligations, including categories without budget lines.
This is read-only reporting; no approval/payment gate or budget allocation changes.

- Scope: active company and budget month, not bank payment date.
- Used: paid plus pending commitments. Paid, approved, scheduled and finance-validation
  requests count regardless of the original budget decision. Submitted/pending-approval
  requests retain the existing reservation rule (budget decision aprobable).
- Draft, rejected, cancelled and changes-requested records are excluded.
- Comparable base: recorded subtotal, otherwise requested amount, converted to MXN.
- Gross paid is displayed separately and includes the recorded taxes/withholdings.
- Payroll is counted at request level, never added again from channels or receipts.
- IMSS/ISN are independent obligations and counted once in submitted/approved/paid states.
- Negative remaining balance stays negative and produces a global overrun alert.
- Missing currency conversion makes the budget summary unavailable rather than overstating availability.
- Category, monthly chart, headline and drilldown totals share the same report.

The public RPC is SECURITY INVOKER. Its private SECURITY DEFINER helper requires an
explicit authenticated identity, the existing dashboard role guard and active company
access. It returns aggregates only. Anonymous execution is revoked on both functions.
Existing table permissions and the payment-validation budget view are unchanged.

Deployment migration mapping (identical SQL): DEV 20260918171311,
PROD / canonical repository filename 20260918171356.

Verification: PGlite executes the real migration against synthetic ledger fixtures,
including exceptions, no-budget categories, payroll, IMSS/ISN, taxes, FX, excluded
statuses, overrun and access denial. React/API tests cover shared totals, company/year
switching, failed requests and stale responses. Run:

    node --test scripts/qa/dashboard-global-budget.test.mjs scripts/qa/dashboard-operational.test.mjs scripts/qa/pwa-*.test.mjs
    npm --prefix app run build
