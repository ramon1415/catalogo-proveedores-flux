# Payroll N2B staged capture contract

Status: DEV-only implementation candidate. Approval, materialization, bank execution, reconciliation, provisioning, and PROD remain out of scope.

## Design decision

N2B persists a temporary `payroll_capture_session`; it does not create a `payment_request`. This keeps the N1 invariant `amount_requested = SUM(payroll_channels.amount)` unchanged and avoids fake zero-value channels, a fictitious provider, an approver, creation notifications, and premature approval eligibility.

The session reserves an opaque future materialization UUID. A later authorized N3 transaction may consume the validated staging state to create the payment request and channels atomically. N2B contains no materialization RPC.

## Capability matrix

| Input | Capability | N2B behavior |
| --- | --- | --- |
| Cover sheet XLSX | `unsupported_pending_source_contract` | Secure private upload; no extraction; `FORMAT_NOT_CERTIFIED` |
| BBVA same-bank TXT | `pending_format_certification` | Secure private upload; no offset parsing; `FORMAT_NOT_CERTIFIED` |
| SPEI TXT | `supported_certified` | Exact N2A byte parser in the Finance browser; count and aggregate total only; persisted as `client_parsed_unverified` |
| TOKA transfer XLSM | Historical generator evidence | Not accepted as an operational input and never uploaded |
| TOKA/vales XML | `pending_employee_breakdown_validation` | Conditional private upload; no employee breakdown |

`MISSING_USER_FILE`, `FORMAT_NOT_CERTIFIED`, `PARSER_ERROR`, and `TOTAL_MISMATCH` remain separate conditions. Unknown totals remain null; no zero amount is invented.

## Storage and PII

The existing private `payroll-private` bucket is reused. Staged object paths are opaque:

```text
{company_uuid}/{reserved_materialization_uuid}/{file_uuid}.{extension}
```

An upload requires a prior Finance-only reservation. Storage supports only INSERT and authenticated SELECT for a matching active session; the browser uses `upsert: false`. A restrictive policy denies UPDATE/move/rename for every staged three-segment path while preserving the pre-existing materialized two-segment contract. N2B creates no staged DELETE policy, public URL, or long-lived signed URL.

Tables are forced-RLS and have no direct `anon` or `authenticated` grants. Mutations run only through checked `SECURITY DEFINER` RPCs. Persisted parser output is restricted to adapter/version, record count, aggregate amount, capability and issue codes. The database labels SPEI as `browser_client_attested`: N2B does not claim a server-side digest or parser proof, and N3 must rehash and reparse the stored bytes before materialization. Original filenames, employee rows, names, RFC, CURP, NSS, account/CLABE, references and raw parser payloads are not stored. Audit entries contain changed field names only.

When a capture expires, its objects are no longer selectable through the authenticated Storage policy. Bytes remain under service-role retention until a separately authorized cleanup lifecycle exists; N2B deliberately adds no DELETE policy or scheduler.

## UI and lifecycle gates

The Finance-only `Nómina` request type switches the existing modal into payroll capture mode. It captures company, run subtype, dates, a filtered/masked active MXN bank source account, concept, notes, declared expected channels and functional file slots. The total is derived from certified channels when possible and cannot be entered manually.

The approval control is always disabled with `Validación completa — flujo de aprobación pendiente de habilitar`. Existing `payroll_uses_separate_flow` approval exclusion and payroll layout exclusion remain unchanged. N2B creates no approval batch, Director notification, PAGOSBBV/PAGOSINT/CIE layout, bank file, receipt match, or budget provision.

## Synthetic UAT result

The controlled DEV scenario `NÓMINA TEST N2B - NO PAGAR` was executed against the Vercel Preview and DEV only. It used one generated 128-byte SPEI record, an existing QA-labelled company, and an existing masked DEV source account. No real employee or customer file was used.

- a temporary capture session and private synthetic SPEI object;
- local certified SPEI parser PASS: 1 record and MXN 1,250.00;
- cover sheet still required/pending;
- same-bank and TOKA not required;
- approval blocked;
- persisted SPEI authority remains `browser_client_attested` / `client_parsed_unverified`;
- zero new payment requests, channels, approval events, layouts or notifications.

Post-UAT DEV counts were: one capture session, one capture file, one private object, zero payroll payment requests/channels/run files/run lines, zero payroll approval items, and zero payroll layout lines. The global request, approval, layout, and notification counts remained at their pre-UAT values.

Desktop visual UAT confirmed visible concept/notes, masked source account, parser status, count/total, distinct missing-cover state, and a disabled approval control. The browser-control viewport override did not change the live Chromium viewport, so no mobile screenshot is claimed; responsive CSS and DOM contracts remain covered statically.

DEV had no active Finance profile available for the interactive check. One existing authenticated DEV profile received a narrowly scoped temporary Finance role grant for the UAT and the exact grant was removed immediately afterward; its original role set was revalidated. No Director role was changed.

No real employee data, customer XLSM, bank action, PROD write or N3 behavior is permitted.

## Next gate

N3 must remain separately authorized. Before materialization it needs a certified cover-sheet physical contract, full person reconciliation, all channel totals proven, and a new atomic promotion contract. Same-bank remains blocked until a physical payroll output is certified; TOKA employee breakdown remains conditional on a reliable XML/cover source.
