-- Flux Operadora - Migracion 001c
-- Tablas: budget_versions, budget_lines, budget_import_batches, budget_import_staging

CREATE TABLE public."budget_versions" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version_type text NOT NULL CHECK (version_type = ANY (ARRAY['original'::text, 'forecast'::text])),
  year integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  loaded_by uuid,
  activated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_versions_pkey PRIMARY KEY (id)
);

CREATE TABLE public."budget_lines" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  budget_version_id uuid NOT NULL,
  company_id uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  budget_category_id uuid NOT NULL,
  budget_month date NOT NULL CHECK (date_trunc('month'::text, budget_month::timestamp with time zone)::date = budget_month),
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_lines_pkey PRIMARY KEY (id)
);

CREATE TABLE public."budget_import_batches" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_file_name text NOT NULL,
  source_sheet_name text NOT NULL,
  import_year integer NOT NULL CHECK (import_year >= 2000 AND import_year <= 2100),
  company_name text NOT NULL,
  cost_center_name text NOT NULL,
  company_id uuid,
  cost_center_id uuid,
  budget_version_id uuid,
  blank_cell_rule text NOT NULL DEFAULT 'pending'::text CHECK (blank_cell_rule = ANY (ARRAY['pending'::text, 'treat_as_zero'::text, 'treat_as_unbudgeted'::text])),
  status text NOT NULL DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'staged'::text, 'validating'::text, 'validated'::text, 'approved'::text, 'promoted'::text, 'cancelled'::text, 'error'::text])),
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_import_batches_pkey PRIMARY KEY (id)
);

CREATE TABLE public."budget_import_staging" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  source_sheet_name text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  source_column text NOT NULL,
  source_cell text NOT NULL,
  company_name text NOT NULL,
  cost_center_name text NOT NULL,
  section_name text,
  source_code text,
  generated_code text,
  final_code text,
  concept_name text,
  budget_month date CHECK (budget_month IS NULL OR date_trunc('month'::text, budget_month::timestamp with time zone)::date = budget_month),
  amount numeric,
  raw_value text,
  formula text,
  is_blank boolean NOT NULL DEFAULT false,
  is_total boolean NOT NULL DEFAULT false,
  is_section_header boolean NOT NULL DEFAULT false,
  has_error boolean NOT NULL DEFAULT false,
  error_text text,
  company_id uuid,
  cost_center_id uuid,
  budget_category_id uuid,
  validation_status text NOT NULL DEFAULT 'pending'::text CHECK (validation_status = ANY (ARRAY['pending'::text, 'valid'::text, 'warning'::text, 'error'::text, 'ignored'::text, 'approved'::text])),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_import_staging_pkey PRIMARY KEY (id)
);
