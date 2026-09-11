# Convenio receipt capture and company-scoped batch receipts

## Request flow

In Solicitudes → Nueva solicitud → Convenio, the first attachment control accepts PDF, JPG and PNG (10 MB). Images use the existing local PDF preparation and Spanish OCR assets. The prepared document is attached through the existing atomic request/document RPC when the user submits.

CFE extraction requires a unique printed 30-digit coupon, matching service number, valid embedded date, and a matching headline **Total a pagar**. The first 20 digits populate the CIE reference and the remaining 10 populate its concept. Leading zeros and the printed date/check digit are preserved. Fiscal breakdowns and earlier payments are not used as the payable amount. The registered CFE provider is selected only when unambiguous. Other agreements require explicitly labeled banking fields; uncertain documents remain available for manual capture.

A new selection clears prior bank fields. File/type/provider/company changes cancel the previous read; late results cannot populate a different context. Normal budget, approval, company and server validation still apply.

## Existing CIE lines

Layouts → line details → Corregir datos CIE edits reference and concept together. Receipt extraction also checks the existing amount, agreement and service when available. The server permits only finance access in the line's company, included lines in open layouts, and requests without payment receipts or closed status. Uploaded layouts require confirmation of bank rejection. Optimistic concurrency compares both original fields. Changes are audited without changing accounts, amounts, approval state or historical requests. Download the CIE file again after saving.

The migration is registered in production as `20260911033646_cie_receipt_instructions`. Bank processing is a separate validation; generating/importing a layout does not prove payment execution.

## Comprobantes batch

The active company is now required. Both list reads send its ID; results, totals and details are constrained to that company. New uploads use a locked company selector. Changing company recreates the embedded page. Missing/invalid company context, foreign detail responses and stale reads cannot show another company's batches. Existing database company authorization remains in force.

## Verification

- 139 focused tests: bank serializers/routing, receipt extraction, React form/document flow, isolated PostgreSQL correction guards/audit, batch scope and existing step transitions.
- Production TypeScript/Vite build.
- Both supplied PDFs read through the production PDF.js row extractor and matched to the visible receipts; one rendered receipt also read through the bundled Tesseract engine and confidence-aware row reconstruction.
- Customer PDFs, bank instructions and corrected bank exports are excluded from repository fixtures.
