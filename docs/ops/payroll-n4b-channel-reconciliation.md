# Payroll N4B — channel receipt reconciliation

## Objective

Close the payroll operational cycle after N4A manual dispersion without turning Flux into a bank executor.

N4B records and verifies one selected payment receipt per payroll channel, reconciles the receipt against the channel amount, and permits the payroll request to move from `approved` to `paid` only after every channel is dispersed and reconciled.

## Flow

1. Payroll is already materialized, submitted, approved, and manually dispersed through N4A.
2. Finance opens `nomina_reconciliacion.html`.
3. For each channel Finance selects a PDF receipt and manually captures payment amount, payment date, and bank reference.
4. Browser computes SHA-256 and reserves a `payroll_run_files(kind='comprobante')` row.
5. The PDF uploads to private `payroll-private` storage using a path bound to that reserved row.
6. `payroll-receipt-verify` downloads the object with service credentials and verifies MIME, byte length, SHA-256, `%PDF-` header, and `%%EOF` marker.
7. The Edge marks only the evidence row as server-verified. It does not extract text and does not use OCR.
8. Finance calls `reconcile_payroll_channel`. The receipt amount must equal the channel amount exactly.
9. When every channel is `dispersed + reconciled` with verified evidence, Finance may call `close_payroll_as_paid`.
10. The request moves `approved -> paid`, with `paid_at` and `paid_by`. No bank call occurs.

## Data model

N4B reuses `payroll_run_files` and `payroll_channels`.

New channel snapshot fields:
- `receipt_file_id`
- `receipt_amount`
- `receipt_payment_date`
- `receipt_reference_hint`

`receipt_file_id` points to a server-verified `payroll_run_files` row with `kind='comprobante'`.

Multiple historical receipt rows may exist for a channel if a user reserves/uploads a replacement before reconciliation. Only the receipt selected by the reconciliation snapshot becomes authoritative.

## Storage trust boundary

The N4B storage policy narrows post-materialization two-level paths to a previously reserved receipt row:

`payment_request_id / run_file_id.pdf`

A valid upload requires:
- Finance role;
- active company membership;
- approved materialized payroll request;
- dispersed channel;
- pending reconciliation;
- reserved `payroll_run_files` receipt row.

No DELETE policy is introduced. Evidence remains immutable/auditable.

## Reconciliation contract

A channel can reconcile only when:
- payroll request remains `approved`;
- channel is `dispersed`;
- reconciliation is `pending`;
- receipt evidence is server-verified;
- captured receipt amount equals channel amount exactly;
- payment date is present and not materially future-dated;
- reference is 3–120 characters.

Repeated reconciliation with the exact same snapshot is idempotent. A different snapshot after reconciliation is blocked.

## Final paid close

The N3B post-decision guard remains closed by default.

N4B adds a narrow exception for `approved -> paid` only when the dedicated RPC sets a transaction-local authorization token and all channel evidence gates pass.

Direct status writes cannot set that transaction-local token and therefore remain blocked.

## Privacy

The Finance UI and summary RPC expose aggregate request/channel information only. They do not render employee names, RFC, CURP, NSS, CLABE, employee bank account, raw payroll layout contents, or full bank references. The summary masks the reference to its final four characters.

## Explicit exclusions

- no payroll calculation;
- no OCR or receipt text extraction;
- no automatic bank matching from PDF text;
- no BBVA/TOKA API call;
- no layout generation/upload;
- no employee-level receipt reconciliation;
- no provider receipt email;
- no PROD or `main` changes in N4B certification.
