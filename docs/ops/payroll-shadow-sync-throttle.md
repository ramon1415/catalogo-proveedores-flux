# Payroll shadow UX sync throttle

DEV-only UX fix for the certified Payroll shadow run.

- Replaces a starvation-prone global DOM debounce with a bounded throttle.
- Keeps repeated UI writes idempotent to avoid MutationObserver feedback loops.
- Preserves aggregate-only Finance metadata (`line_count`, expected channel count).
- No parser, Edge, DB, budget, approval, notification, dispersion, payment or PROD behavior changes.
