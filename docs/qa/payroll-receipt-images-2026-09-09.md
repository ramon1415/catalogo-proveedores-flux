# Payroll receipt JPG and PNG selection - production change

## Scope and compatibility

- The payroll channel receipt input accepts PDF, JPG/JPEG and PNG, up to 10 MB.
- Images are converted locally into a single-page PDF before the existing OCR, upload, hash verification and reconciliation flow. The stored/downloaded receipt and closing email attachment remain PDF; this is not native image storage.
- JPEG image bytes are embedded unchanged. PNG pixels are embedded without resampling. The page preserves the complete image, aspect ratio and JPEG EXIF orientation; no cropping or JPEG re-encoding is performed. Existing PDF inputs are not rewritten.
- Image dimensions are inspected before decoding: at most 20 megapixels and 12,000 pixels per side. Animated PNGs, malformed files, extension/signature mismatches and converted PDFs over 10 MB produce explicit error messages.
- Use the existing same-origin, pinned PDF-lib 1.17.1 asset. No new dependency, third-party OCR endpoint or storage permission is required.
- Conversion shares the existing 90-second reading deadline and cancellation scope. Failed conversion cannot retain a previous receipt. If conversion succeeds but OCR fails, manual review uses the converted PDF.
- Keep exact amount and currency checks, the request-creation date minimum with no today-based upper cap, inline rejection reasons, and the explicit **Subir y conciliar** action.
- No database migration, Edge Function deployment, actual receipt upload, payment, reconciliation, payroll closure, email delivery or changes to existing receipts are part of this release.

## Verification

- `npm run test:payroll`: 48 PASS, 0 FAIL.
- `npm --prefix app run build`: PASS (TypeScript + Vite).
- `node scripts/qa/build-payroll-prod-release.mjs`: PASS; production schema baseline remains unchanged.
- `node scripts/build-vercel-static.mjs`: PASS.
- Tests cover image signatures, size/dimension limits, malformed/truncated/animated images, all eight JPEG EXIF orientations, cancellation, stale file isolation, explicit upload behavior and amount/date/currency rejection.
- Synthetic fixtures prove that JPEG DCT bytes and decoded PNG RGB pixels are preserved in the generated PDF. No private customer fixture is committed.
- The actual existing server verifier accepts generated PDFs with matching size, MIME type and SHA-256 using mocked authentication/storage/confirmation. The actual closing-notification handler preserves those PDF bytes in its attachments using mocked delivery. No external verification or email request is performed by those tests.
- Both private bank receipts passed the complete image-to-PDF -> PDF.js -> actual Tesseract WASM -> field parser pipeline as JPG and as PNG (four successful cases). Extracted amount, currency, payment date and group folio match the source documents. A local Canvas and worker-path adapter is used for Node execution.
- Converted PDFs were rendered and visually checked for complete, readable, uncropped content. Private source images, converted PDFs and rendered checks remain outside the repository and deployment.
- UI behavior is covered by component tests. No browser end-to-end financial upload or reconciliation in production is claimed.

## Deployment verification

Check the deployed commit and compare the production entry/payroll bundles, PDF-lib asset and same-origin OCR worker/core/model hashes against the tested static build. Finance should refresh Flux, select a pending receipt in PDF/JPG/PNG, review the extracted fields and explicitly upload/reconcile. Already reconciled channels must remain untouched.
