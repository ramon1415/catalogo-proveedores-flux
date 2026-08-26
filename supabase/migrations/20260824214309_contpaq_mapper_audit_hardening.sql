-- Flux Operadora — hardening de auditoría del mapper CONTPAQ.
-- Evita que el cliente pueda atribuir un cambio a otro perfil.

ALTER TABLE public.budget_account_mappings
  DROP CONSTRAINT IF EXISTS budget_account_mappings_reason_length_check;
ALTER TABLE public.budget_account_mappings
  ADD CONSTRAINT budget_account_mappings_reason_length_check
  CHECK (mapping_reason IS NULL OR char_length(mapping_reason) <= 1000);

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

  v_actor := public.current_profile_id();
  IF v_actor IS NOT NULL THEN
    NEW.updated_by := v_actor;
  END IF;
  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_budget_account_mapping_eligible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_budget_account_mapping_eligible() TO authenticated, service_role;
