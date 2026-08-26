-- Flux Operadora — distingue nivel CONTPAQ de elegibilidad como hoja.
-- En el catálogo real existen cuentas cta_mayor=2 que agrupan descendientes;
-- por eso cta_mayor=2 no implica is_detail=true. La relación válida es solo:
-- toda cuenta marcada is_detail debe ser cta_mayor=2.

ALTER TABLE public.contpaq_accounts
  DROP CONSTRAINT IF EXISTS contpaq_accounts_detail_consistency_check;
ALTER TABLE public.contpaq_accounts
  DROP CONSTRAINT IF EXISTS contpaq_accounts_detail_implies_cta_mayor_check;

ALTER TABLE public.contpaq_accounts
  ADD CONSTRAINT contpaq_accounts_detail_implies_cta_mayor_check
  CHECK (NOT is_detail OR cta_mayor = 2) NOT VALID;

COMMENT ON COLUMN public.contpaq_accounts.is_detail IS
  'True solo para cuentas terminales elegibles como detalle. cta_mayor=2 puede incluir agrupadores con descendientes; la condición de hoja se evalúa con cta_sup.';
