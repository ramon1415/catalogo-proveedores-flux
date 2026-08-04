-- Flux Operadora - Migracion 001b
-- Tablas: profiles, roles, user_roles, companies, cost_centers, company_cost_centers, budget_categories, company_cost_center_budget_categories, proveedores, providers, proveedor_provider_links, provider_bank_accounts, company_bank_accounts, tax_schemes, documents, document_links, activity_log

CREATE TABLE public."profiles" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

CREATE TABLE public."roles" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);

CREATE TABLE public."user_roles" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_pkey PRIMARY KEY (id)
);

CREATE TABLE public."companies" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  rfc text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT companies_pkey PRIMARY KEY (id)
);

CREATE TABLE public."cost_centers" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  area text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cost_centers_pkey PRIMARY KEY (id)
);

CREATE TABLE public."company_cost_centers" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT company_cost_centers_pkey PRIMARY KEY (id)
);

CREATE TABLE public."budget_categories" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  category text,
  budget_type text CHECK (budget_type = ANY (ARRAY['fixed'::text, 'variable'::text, 'project'::text, 'extraordinary'::text])),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public."company_cost_center_budget_categories" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  budget_category_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT company_cost_center_budget_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public."proveedores" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  alias text NOT NULL UNIQUE,
  nombre_completo text,
  metodo_pago public."metodo_pago_enum",
  tipo_cuenta text CHECK (tipo_cuenta = ANY (ARRAY['CLABE'::text, 'Cuenta'::text])),
  clabe text,
  cuenta_bancaria text,
  banco text,
  es_personal_eventual boolean DEFAULT false,
  csf_url text,
  acta_constitutiva_url text,
  identificacion_url text,
  comprobante_domicilio_url text,
  estado_cuenta_url text,
  creado_por text,
  creado_el timestamp with time zone,
  airtable_alias text UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  rfc text,
  email text,
  telefono text,
  tipo_proveedor text,
  notas text,
  activo boolean DEFAULT true,
  destination_type text CHECK (destination_type IS NULL OR (destination_type = ANY (ARRAY['clabe'::text, 'cuenta'::text, 'convenio'::text]))),
  convenio_number text,
  beneficiary_name text,
  CONSTRAINT proveedores_pkey PRIMARY KEY (id)
);

CREATE TABLE public."providers" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_type public."provider_type" NOT NULL DEFAULT 'company'::provider_type,
  display_name text NOT NULL,
  legal_name text,
  rfc text,
  email text,
  phone text,
  tax_status text,
  is_validated boolean NOT NULL DEFAULT false,
  validated_by uuid,
  validated_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT providers_pkey PRIMARY KEY (id)
);

CREATE TABLE public."proveedor_provider_links" (

  proveedor_id uuid NOT NULL UNIQUE,
  provider_id uuid NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'manual'::text CHECK (source = ANY (ARRAY['manual'::text, 'rfc_match'::text, 'name_match'::text, 'import'::text, 'system'::text])),
  confidence numeric CHECK (confidence IS NULL OR confidence >= 0::numeric AND confidence <= 100::numeric),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT proveedor_provider_links_pkey PRIMARY KEY (proveedor_id, provider_id)
);

CREATE TABLE public."provider_bank_accounts" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  bank_name text,
  account_holder text,
  currency text NOT NULL DEFAULT 'MXN'::text,
  account_number text,
  clabe text,
  swift text,
  routing_number text,
  is_primary boolean NOT NULL DEFAULT false,
  is_validated boolean NOT NULL DEFAULT false,
  validated_by uuid,
  validated_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT provider_bank_accounts_pkey PRIMARY KEY (id)
);

CREATE TABLE public."company_bank_accounts" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bank_name text,
  currency text NOT NULL DEFAULT 'MXN'::text,
  account_type public."company_account_type" NOT NULL DEFAULT 'bank'::company_account_type,
  last4 text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  company_id uuid,
  account_number text,
  clabe text,
  CONSTRAINT company_bank_accounts_pkey PRIMARY KEY (id)
);

CREATE TABLE public."tax_schemes" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  tax_rate numeric NOT NULL DEFAULT 0,
  currency text,
  applies_invoice boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  CONSTRAINT tax_schemes_pkey PRIMARY KEY (id)
);

CREATE TABLE public."documents" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_type public."document_file_type" NOT NULL DEFAULT 'other'::document_file_type,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT documents_pkey PRIMARY KEY (id)
);

CREATE TABLE public."document_links" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT document_links_pkey PRIMARY KEY (id)
);

CREATE TABLE public."activity_log" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  performed_by uuid,
  performed_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT activity_log_pkey PRIMARY KEY (id)
);
