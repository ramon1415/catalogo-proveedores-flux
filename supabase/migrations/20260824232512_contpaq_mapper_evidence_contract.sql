-- Flux Operadora — separa evidencia reproducible de razón formal del mapeo.
-- Las razones editoriales originales no están versionadas; no se reconstruyen.

ALTER TABLE public.budget_account_mappings
  ADD COLUMN IF NOT EXISTS mapping_evidence text;

COMMENT ON COLUMN public.budget_account_mappings.mapping_evidence IS
  'Evidencia técnica reproducible del método de mapeo; no sustituye la razón formal de Finanzas.';
COMMENT ON COLUMN public.budget_account_mappings.mapping_reason IS
  'Razón formal capturada por un usuario autorizado; puede permanecer nula hasta la revisión financiera.';

ALTER TABLE public.budget_account_mappings
  DROP CONSTRAINT IF EXISTS budget_account_mappings_reason_required_check;
ALTER TABLE public.budget_account_mappings
  DROP CONSTRAINT IF EXISTS budget_account_mappings_evidence_length_check;
ALTER TABLE public.budget_account_mappings
  DROP CONSTRAINT IF EXISTS budget_account_mappings_evidence_required_check;

ALTER TABLE public.budget_account_mappings
  ADD CONSTRAINT budget_account_mappings_evidence_length_check
  CHECK (mapping_evidence IS NULL OR char_length(mapping_evidence) <= 1000) NOT VALID;

ALTER TABLE public.budget_account_mappings
  ADD CONSTRAINT budget_account_mappings_evidence_required_check
  CHECK (
    (mapping_method <> 'judgment' AND NOT needs_review)
    OR coalesce(char_length(btrim(mapping_reason)), 0) >= 8
    OR coalesce(char_length(btrim(mapping_evidence)), 0) >= 8
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.assert_budget_account_mapping_eligible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.contpaq_accounts%ROWTYPE;
  v_actor uuid;
BEGIN
  SELECT *
    INTO v_account
  FROM public.contpaq_accounts
  WHERE company_id = NEW.company_id
    AND code = NEW.contpaq_account_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'contpaq_mapping_account_not_found';
  END IF;

  IF v_account.sincronizado_el IS NULL
     OR v_account.cta_mayor IS NULL
     OR v_account.tipo IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'contpaq_catalog_tree_metadata_incomplete';
  END IF;

  IF NOT v_account.activo THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contpaq_mapping_account_inactive';
  END IF;

  IF v_account.cta_mayor <> 2 OR NOT v_account.is_detail THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contpaq_mapping_account_not_detail';
  END IF;

  IF upper(v_account.tipo) <> 'G' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contpaq_mapping_account_not_expense';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contpaq_accounts child
    WHERE child.company_id = NEW.company_id
      AND child.cta_sup = NEW.contpaq_account_code
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contpaq_mapping_account_has_children';
  END IF;

  IF NEW.mapping_method = 'judgment' OR NEW.needs_review THEN
    IF coalesce(char_length(btrim(NEW.mapping_reason)), 0) < 8
       AND coalesce(char_length(btrim(NEW.mapping_evidence)), 0) < 8 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contpaq_mapping_evidence_required';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.needs_review
     AND NOT NEW.needs_review
     AND coalesce(char_length(btrim(NEW.mapping_reason)), 0) < 8 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contpaq_mapping_review_reason_required';
  END IF;

  v_actor := public.current_profile_id();
  IF v_actor IS NOT NULL THEN
    NEW.updated_by := v_actor;
  END IF;
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_budget_account_mapping_eligible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_budget_account_mapping_eligible() TO authenticated, service_role;

DROP TRIGGER IF EXISTS budget_account_mappings_eligible_guard ON public.budget_account_mappings;
CREATE TRIGGER budget_account_mappings_eligible_guard
BEFORE INSERT OR UPDATE
ON public.budget_account_mappings
FOR EACH ROW
EXECUTE FUNCTION public.assert_budget_account_mapping_eligible();
