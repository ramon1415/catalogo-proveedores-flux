# Payroll company scope init race hotfix

DEV-only frontend hotfix.

The payroll company bridge could initialize before `payroll_capture.js` had injected `payrollSourceAccount`, so it exited once and never retried. The fix waits for the payroll field via `MutationObserver` before inserting the Company selector bridge.

No DB, RLS, role, payroll calculation, bank, PROD or main behavior changes.
