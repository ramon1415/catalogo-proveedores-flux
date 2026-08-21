# Payroll shadow-run final UX polish

DEV-only visual closeout for the certified real Payroll shadow run.

- Aggregate counters retry until the authenticated client is available, using only `server_verification_summary.line_count` and `expected_channels` from the existing Finance-only capture RPC.
- TOKA variance title is explicit and follows the visible aggregate funding variance.
- Materialized captures hide write-looking footer actions and show `Materializada · solo lectura`.
- Budget classification shows Company as inherited from the materialized run instead of a second operative selector.
- No parser, Edge Function, migration, budget write, approval, notification, dispersion, reconciliation, payment or PROD behavior is changed.
