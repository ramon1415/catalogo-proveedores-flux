-- Flux Operadora — contrato versionado del catálogo CONTPAQ y mapper presupuestal.
-- Data-free: no carga ni modifica cuentas o mapeos existentes.

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.budget_categories') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Core Flux tables must exist before the CONTPAQ mapper schema';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.contpaq_accounts (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  name text NOT NULL,
  is_detail boolean NOT NULL DEFAULT false,
  sat_group text,
  cta_sup text,
  cta_mayor smallint,
  tipo text,
  rubro_nif text,
  activo boolean NOT NULL DEFAULT true,
  sincronizado_el timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contpaq_accounts_pkey PRIMARY KEY (company_id, code)
);

ALTER TABLE public.contpaq_accounts ADD COLUMN IF NOT EXISTS cta_sup text;
ALTER TABLE public.contpaq_accounts ADD COLUMN IF NOT EXISTS cta_mayor smallint;
ALTER TABLE public.contpaq_accounts ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.contpaq_accounts ADD COLUMN IF NOT EXISTS rubro_nif text;
ALTER TABLE public.contpaq_accounts ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.contpaq_accounts ADD COLUMN IF NOT EXISTS sincronizado_el timestamptz;
ALTER TABLE public.contpaq_accounts ALTER COLUMN activo SET DEFAULT true;
ALTER TABLE public.contpaq_accounts ALTER COLUMN sincronizado_el SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contpaq_accounts'::regclass
      AND conname = 'contpaq_accounts_code_normalized_check'
  ) THEN
    ALTER TABLE public.contpaq_accounts
      ADD CONSTRAINT contpaq_accounts_code_normalized_check
      CHECK (code ~ '^[0-9A-Za-z]+$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contpaq_accounts'::regclass
      AND conname = 'contpaq_accounts_cta_sup_normalized_check'
  ) THEN
    ALTER TABLE public.contpaq_accounts
      ADD CONSTRAINT contpaq_accounts_cta_sup_normalized_check
      CHECK (cta_sup IS NULL OR cta_sup ~ '^[0-9A-Za-z]+$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contpaq_accounts'::regclass
      AND conname = 'contpaq_accounts_cta_mayor_check'
  ) THEN
    ALTER TABLE public.contpaq_accounts
      ADD CONSTRAINT contpaq_accounts_cta_mayor_check
      CHECK (cta_mayor IS NULL OR cta_mayor BETWEEN 1 AND 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contpaq_accounts'::regclass
      AND conname = 'contpaq_accounts_tipo_check'
  ) THEN
    ALTER TABLE public.contpaq_accounts
      ADD CONSTRAINT contpaq_accounts_tipo_check
      CHECK (tipo IS NULL OR upper(tipo) = ANY (ARRAY['A','B','D','E','F','G','H','K','L']::text[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contpaq_accounts'::regclass
      AND conname = 'contpaq_accounts_detail_consistency_check'
  ) THEN
    ALTER TABLE public.contpaq_accounts
      ADD CONSTRAINT contpaq_accounts_detail_consistency_check
      CHECK (cta_mayor IS NULL OR is_detail = (cta_mayor = 2));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS contpaq_accounts_parent_idx
  ON public.contpaq_accounts(company_id, cta_sup);
CREATE INDEX IF NOT EXISTS contpaq_accounts_mapper_idx
  ON public.contpaq_accounts(company_id, activo, tipo, cta_mayor);
CREATE INDEX IF NOT EXISTS contpaq_accounts_synced_idx
  ON public.contpaq_accounts(company_id, sincronizado_el DESC);

CREATE TABLE IF NOT EXISTS public.budget_account_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  budget_category_id uuid NOT NULL REFERENCES public.budget_categories(id),
  contpaq_account_code text NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  mapping_method text NOT NULL DEFAULT 'manual',
  mapping_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_account_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT budget_account_mappings_company_category_key UNIQUE (company_id, budget_category_id),
  CONSTRAINT budget_account_mappings_company_account_fkey
    FOREIGN KEY (company_id, contpaq_account_code)
    REFERENCES public.contpaq_accounts(company_id, code)
);

ALTER TABLE public.budget_account_mappings ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.budget_account_mappings ADD COLUMN IF NOT EXISTS mapping_method text NOT NULL DEFAULT 'manual';
ALTER TABLE public.budget_account_mappings ADD COLUMN IF NOT EXISTS mapping_reason text;
ALTER TABLE public.budget_account_mappings ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.budget_account_mappings'::regclass
      AND conname = 'budget_account_mappings_mapping_method_check'
  ) THEN
    ALTER TABLE public.budget_account_mappings
      ADD CONSTRAINT budget_account_mappings_mapping_method_check
      CHECK (mapping_method = ANY (ARRAY['exact_name','judgment','manual','imported']::text[]));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS budget_account_mappings_account_idx
  ON public.budget_account_mappings(company_id, contpaq_account_code);
CREATE INDEX IF NOT EXISTS budget_account_mappings_review_idx
  ON public.budget_account_mappings(company_id, needs_review)
  WHERE needs_review;

CREATE OR REPLACE FUNCTION public.contpaq_mapper_company_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_has_role(public.flux_sysadmin_roles())
      OR (
        public.current_user_has_role(
          ARRAY['finance','finanzas','treasury','tesoreria','administracion']::text[]
        )
        AND public.has_active_company_membership(public.current_profile_id(), p_company_id)
      );
$$;

REVOKE ALL ON FUNCTION public.contpaq_mapper_company_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contpaq_mapper_company_access(uuid) TO authenticated, service_role;

ALTER TABLE public.contpaq_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contpaq_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.budget_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_account_mappings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contpaq_accounts_select ON public.contpaq_accounts;
DROP POLICY IF EXISTS contpaq_accounts_write ON public.contpaq_accounts;
DROP POLICY IF EXISTS contpaq_accounts_select_mapper ON public.contpaq_accounts;

REVOKE ALL ON TABLE public.contpaq_accounts FROM PUBLIC;
REVOKE ALL ON TABLE public.contpaq_accounts FROM anon;
REVOKE ALL ON TABLE public.contpaq_accounts FROM authenticated;
GRANT SELECT ON TABLE public.contpaq_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contpaq_accounts TO service_role;

CREATE POLICY contpaq_accounts_select_mapper
  ON public.contpaq_accounts
  FOR SELECT
  TO authenticated
  USING (public.contpaq_mapper_company_access(company_id));

DROP POLICY IF EXISTS budget_account_mappings_select ON public.budget_account_mappings;
DROP POLICY IF EXISTS budget_account_mappings_write ON public.budget_account_mappings;
DROP POLICY IF EXISTS budget_account_mappings_select_mapper ON public.budget_account_mappings;
DROP POLICY IF EXISTS budget_account_mappings_insert_mapper ON public.budget_account_mappings;
DROP POLICY IF EXISTS budget_account_mappings_update_mapper ON public.budget_account_mappings;
DROP POLICY IF EXISTS budget_account_mappings_delete_mapper ON public.budget_account_mappings;

REVOKE ALL ON TABLE public.budget_account_mappings FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_account_mappings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.budget_account_mappings TO authenticated, service_role;

CREATE POLICY budget_account_mappings_select_mapper
  ON public.budget_account_mappings
  FOR SELECT
  TO authenticated
  USING (public.contpaq_mapper_company_access(company_id));

CREATE POLICY budget_account_mappings_insert_mapper
  ON public.budget_account_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.contpaq_mapper_company_access(company_id));

CREATE POLICY budget_account_mappings_update_mapper
  ON public.budget_account_mappings
  FOR UPDATE
  TO authenticated
  USING (public.contpaq_mapper_company_access(company_id))
  WITH CHECK (public.contpaq_mapper_company_access(company_id));

CREATE POLICY budget_account_mappings_delete_mapper
  ON public.budget_account_mappings
  FOR DELETE
  TO authenticated
  USING (public.contpaq_mapper_company_access(company_id));

DROP POLICY IF EXISTS budget_categories_write ON public.budget_categories;
CREATE POLICY budget_categories_write
  ON public.budget_categories
  FOR UPDATE
  TO authenticated
  USING (public.current_user_has_role(public.flux_finance_roles()))
  WITH CHECK (public.current_user_has_role(public.flux_finance_roles()));

CREATE OR REPLACE VIEW public.contpaq_account_mapper_candidates
WITH (security_invoker = true)
AS
SELECT
  a.company_id,
  a.code,
  a.name,
  a.is_detail,
  a.sat_group,
  a.cta_sup,
  a.cta_mayor,
  a.tipo,
  a.rubro_nif,
  a.activo,
  a.sincronizado_el,
  NOT EXISTS (
    SELECT 1
    FROM public.contpaq_accounts child
    WHERE child.company_id = a.company_id
      AND child.cta_sup = a.code
  ) AS es_hoja,
  (
    a.activo
    AND a.sincronizado_el IS NOT NULL
    AND a.cta_mayor = 2
    AND upper(a.tipo) = 'G'
    AND NOT EXISTS (
      SELECT 1
      FROM public.contpaq_accounts child
      WHERE child.company_id = a.company_id
        AND child.cta_sup = a.code
    )
  ) AS elegible_mapper
FROM public.contpaq_accounts a;

REVOKE ALL ON TABLE public.contpaq_account_mapper_candidates FROM PUBLIC;
REVOKE ALL ON TABLE public.contpaq_account_mapper_candidates FROM anon;
GRANT SELECT ON TABLE public.contpaq_account_mapper_candidates TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_budget_account_mapping_eligible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.contpaq_accounts%ROWTYPE;
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

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_budget_account_mapping_eligible() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_budget_account_mapping_eligible() TO authenticated, service_role;

DROP TRIGGER IF EXISTS budget_account_mappings_eligible_guard ON public.budget_account_mappings;
CREATE TRIGGER budget_account_mappings_eligible_guard
BEFORE INSERT OR UPDATE OF company_id, contpaq_account_code
ON public.budget_account_mappings
FOR EACH ROW
EXECUTE FUNCTION public.assert_budget_account_mapping_eligible();

COMMENT ON TABLE public.contpaq_accounts IS
  'Catálogo contable CONTPAQ re-sincronizable. Las cuentas ausentes se inactivan; no se borran.';
COMMENT ON COLUMN public.contpaq_accounts.cta_sup IS
  'Código normalizado de la cuenta padre. Sin FK autorreferencial dura para permitir carga por archivo en cualquier orden.';
COMMENT ON COLUMN public.contpaq_accounts.cta_mayor IS
  'CONTPAQ: 1=renglón, 2=detalle, 3=agrupador, 4=subdetalle.';
COMMENT ON COLUMN public.contpaq_accounts.tipo IS
  'Naturaleza contable CONTPAQ; G identifica gasto para el mapper.';
COMMENT ON COLUMN public.contpaq_accounts.rubro_nif IS
  'Clasificación normativa NIF ligada al token RF correspondiente.';
COMMENT ON COLUMN public.contpaq_accounts.activo IS
  'False cuando la cuenta dejó de aparecer en una sincronización; se conserva por histórico.';
COMMENT ON COLUMN public.contpaq_accounts.sincronizado_el IS
  'Última vez que la cuenta fue observada en un archivo fuente CONTPAQ.';
COMMENT ON TABLE public.budget_account_mappings IS
  'Relación por empresa entre partida presupuestal y cuenta CONTPAQ elegible, con método, razón y bandera de revisión.';
