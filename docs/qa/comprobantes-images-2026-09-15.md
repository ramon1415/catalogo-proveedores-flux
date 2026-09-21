# Comprobantes batch: JPG, JPEG and PNG

## Result

The existing Comprobantes upload accepts PDF, JPG/JPEG and PNG. A complete image
represents one bank payment; a PDF may still contain multiple payments, one per
page. Images have a 10 MB input/output limit (or the server's lower limit),
20 megapixels and 12,000 pixels per side. The native PDF limit remains defined by
the server. Unsupported formats, disguised extensions, MIME mismatches and
animated/malformed images fail before a batch is created.

The flow reuses payroll's local image-to-PDF conversion, PDF.js and pinned
Tesseract Spanish OCR. Original JPEG bytes and PNG pixels are preserved; EXIF
orientation and the full image are retained. The source stored in the authorized
private bucket is a PDF. Existing PDFs are not rewritten. Deterministic metadata
is opt-in for batch conversion so repeated images keep the same SHA-256 and can
reopen their existing batch, including an interrupted extraction.

Image OCR must produce a complete, single BBVA payment. Unreadable critical
fields, incomplete amounts/accounts, missing banking identity and multiple
payments are rejected with an actionable message. No digits or account numbers
are guessed. The user can cancel reading, and a 90-second deadline prevents an
indefinite wait. Cancellation or a company change cannot turn a late OCR result
into a new batch. Once storage begins, cancellation is disabled and the existing
resume/idempotency contract applies.

After ingestion, the already deployed automatic matching and explicit Finance
confirmation remain the same. No database changes, permission changes or new
payment commands are required. This change does not mark requests paid merely
by choosing or processing an image.

## Verification

- 101 tests pass on the production base: image ingestion, exact extracted facts,
  file/hash/MIME consistency, deterministic duplication, resumed extraction,
  native multipage PDFs, malformed/oversized files, critical OCR uncertainty,
  multiple payments, timeout/cancellation, company unmount, double click,
  reconciliation, payroll image regression and PWA contracts.
- React TypeScript/build and the Vercel static artifact pass.
- Two synthetic bank-style cases, JPG and PNG, pass the actual image-to-PDF,
  PDF.js, Tesseract WASM, BBVA parser and conservative image guard pipeline.
  Both yield MXN 1,831.27, the full beneficiary, source/destination accounts,
  2026-09-15 and folio 990150926824739562801, with no request number in the image.
- A deliberately interfering watermark produces an unreadable date token and
  is rejected instead of using the creation date as a substitute.
- The converted PDF was rendered and visually inspected: complete, legible and
  uncropped. Synthetic source images and rendered QA outputs stay outside the
  repository and deployment.
- The upload dialog has a bounded viewport height, an independently scrolling
  body and a persistent action footer. The file selector exposes images without
  forcing a phone camera. No authenticated browser payment or physical-device
  upload is claimed by the automated checks.

## DEV compatibility

DEV previously lacked PROD's pinned local OCR assets. Its accompanying change
adds the same three locked OCR packages, asset preparation and opt-in reader,
without enabling image capture in other DEV modules. The existing payroll
reader callers retain their default behavior. PROD already has these assets;
its release only changes Comprobantes and adds the deterministic option to the
shared payroll conversion helper.

## Release and rollback

Promote the tested changes to DEV before the scoped main release. Verify CI and
Vercel for each merge. Reverting the frontend change restores PDF-only selection;
already uploaded image-derived PDF evidence remains readable by the old flow.
