# Payroll receipt image OCR - production change

## Scope

- Read image-only and large-image receipt PDF pages with Tesseract.js 6.0.1 and the Spanish 1.0.0 model, after PDF.js rendering.
- Keep the original PDF, 10 MB upload limit and explicit **Subir y conciliar** action. This change does not introduce standalone JPG/PNG uploads or automatic reconciliation.
- Recognize BBVA **Comprobante de Grupos** totals under **Totales por divisa en cuentas origen**. Do not add employee amounts or substitute the channel's expected amount.
- Read the labelled scheduled payment date when no payment/application/operation date is present. Prefer the labelled group folio over the authorization string when available.
- Distinguish an unreadable/missing amount from a genuine amount mismatch. Keep the inline reason and manual completion flow.
- Preserve the previously deployed rule: payment date must not precede request creation; later dates have no today-based cap.

## Privacy and resource handling

- Worker, WASM core and Spanish language model are generated from pinned lockfile dependencies and served from Flux's own origin. No receipt pixels are sent to an OCR service.
- OCR is lazy and opted in only for payroll receipts. Other PDF readers retain their text-only behavior.
- All pages are inspected, up to 20; render dimensions are bounded; the form times out after 90 seconds and offers explicit correction.
- Replacing/removing a file, switching requests and unmounting cancel obsolete work. Workers/canvases are released after recognition or cancellation.
- Low-confidence OCR words remain marked as unreadable. Ambiguous totals, currencies and references are not replaced with guessed defaults.
- No SQL migration, Edge Function deployment, permission change, actual receipt upload, reconciliation, payroll closure or email delivery is part of this release.

## Verification

- `npm --prefix app run build`: PASS (TypeScript + Vite).
- `node --test scripts/qa/payroll-receipt-autofill.test.mjs`: 23 PASS.
- `npm run test:payroll`: 40 PASS, including existing server contract and payroll lifecycle tests in the isolated test database.
- Both private client PDF originals were visually checked and passed the complete `extractPdfLines` -> `parseReceiptFields` path using the repository's PDF.js and actual Tesseract WASM, with a local Canvas/worker-path adapter for Node. Amount, date, currency and group folio matched the visible originals. Both OCR workers terminated. No private files or customer identifiers are included here.
- Browser-local QA navigation was unavailable (`ERR_BLOCKED_BY_CLIENT`). No browser end-to-end upload/reconciliation is claimed. The actual OCR pipeline was tested locally and form behavior is covered separately by component tests.

## After deployment

Verify the production deployment commit, payroll bundle and same-origin worker/core/model URLs. Finance should refresh Flux, reselect the pending PDF in its matching channel, review the extracted fields, then explicitly upload/reconcile. Leave any already reconciled channel untouched.
