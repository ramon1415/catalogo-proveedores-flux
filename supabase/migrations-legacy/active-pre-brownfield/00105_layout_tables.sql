-- Flux Operadora - Migracion 001e
-- Tablas: payment_layouts, payment_layout_lines

CREATE TABLE public."payment_layouts" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  layout_number text UNIQUE,
  name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'generated'::text, 'uploaded'::text, 'confirmed'::text, 'cancelled'::text])),
  generated_by uuid,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  storage_path text,
  file_name text,
  company_count integer NOT NULL DEFAULT 0,
  payment_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_layouts_pkey PRIMARY KEY (id)
);

CREATE TABLE public."payment_layout_lines" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  layout_id uuid NOT NULL,
  payment_request_id uuid NOT NULL,
  company_id uuid NOT NULL,
  proveedor_id uuid,
  company_bank_account_id uuid,
  source_account_number text,
  company_name text NOT NULL,
  destination_type text NOT NULL CHECK (destination_type = ANY (ARRAY['clabe'::text, 'cuenta'::text, 'convenio'::text])),
  destination_value text NOT NULL,
  beneficiary_name text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  payment_reference text,
  payment_concept text,
  request_number text,
  status text NOT NULL DEFAULT 'included'::text CHECK (status = ANY (ARRAY['included'::text, 'paid'::text, 'bank_rejected'::text])),
  bank_rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_layout_lines_pkey PRIMARY KEY (id)
);
