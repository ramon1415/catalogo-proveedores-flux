-- Flux Operadora - Migracion 001g
-- Tablas: members, billing_periods, maintenance_fee_charges, maintenance_fee_payments, incident_charges, invoices, clients, client_contacts, venues, venue_spaces, venue_connections, venue_bookings, celebration_events, celebration_concepts, celebration_price_list, celebration_line_items, celebration_leads, production_events, production_categories, production_items, production_locations, income_payments, income_payment_allocations, sales_invoices, tickets

CREATE TABLE public."members" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  rfc text,
  lineage text CHECK (lineage IS NULL OR (lineage = ANY (ARRAY['SNR'::text, 'SNM'::text, 'PSN'::text, 'CSN'::text, 'FSN'::text]))),
  fee_factor numeric NOT NULL DEFAULT 1 CHECK (fee_factor > 0::numeric),
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT members_pkey PRIMARY KEY (id)
);

CREATE TABLE public."billing_periods" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  name text NOT NULL,
  cutoff_date date NOT NULL,
  total_budget numeric CHECK (total_budget IS NULL OR total_budget >= 0::numeric),
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'closed'::text, 'cancelled'::text])),
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT billing_periods_pkey PRIMARY KEY (id)
);

CREATE TABLE public."maintenance_fee_charges" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  billing_period_id uuid NOT NULL,
  expected_amount numeric NOT NULL CHECK (expected_amount >= 0::numeric),
  paid_amount numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0::numeric),
  pending_amount numeric GENERATED ALWAYS AS (expected_amount - paid_amount) STORED,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text])),
  invoice_id uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_fee_charges_pkey PRIMARY KEY (id)
);

CREATE TABLE public."maintenance_fee_payments" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL,
  member_id uuid NOT NULL,
  billing_period_id uuid NOT NULL,
  amount_paid numeric NOT NULL CHECK (amount_paid > 0::numeric),
  payment_date date NOT NULL,
  bank_reference text,
  payment_method text CHECK (payment_method IS NULL OR (payment_method = ANY (ARRAY['transfer'::text, 'cash'::text, 'check'::text, 'card'::text, 'other'::text]))),
  invoice_id uuid,
  registered_by uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  receipt_storage_path text,
  CONSTRAINT maintenance_fee_payments_pkey PRIMARY KEY (id)
);

CREATE TABLE public."incident_charges" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_id uuid,
  external_name text,
  external_rfc text,
  referred_by_member_id uuid,
  company_id uuid,
  cost_center_id uuid,
  budget_category_id uuid,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  incident_date date NOT NULL,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'invoiced'::text, 'paid'::text, 'cancelled'::text])),
  invoice_id uuid,
  registered_by uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT incident_charges_pkey PRIMARY KEY (id)
);

CREATE TABLE public."invoices" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_type text NOT NULL CHECK (invoice_type = ANY (ARRAY['maintenance_fee'::text, 'incident'::text])),
  member_id uuid,
  external_name text,
  receiver_rfc text,
  charge_id uuid,
  incident_charge_id uuid,
  fiscal_uuid text,
  series_folio text,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  issue_date date NOT NULL,
  payment_date date,
  status text NOT NULL DEFAULT 'issued'::text CHECK (status = ANY (ARRAY['issued'::text, 'paid'::text, 'cancelled'::text])),
  storage_path_xml text,
  storage_path_pdf text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id)
);

CREATE TABLE public."clients" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_type public."client_type" NOT NULL DEFAULT 'person'::client_type,
  display_name text NOT NULL,
  legal_name text,
  rfc text,
  email text,
  phone text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clients_pkey PRIMARY KEY (id)
);

CREATE TABLE public."client_contacts" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  full_name text NOT NULL,
  role_label text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT client_contacts_pkey PRIMARY KEY (id)
);

CREATE TABLE public."venues" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  venue_type public."venue_type" NOT NULL DEFAULT 'owned'::venue_type,
  address text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT venues_pkey PRIMARY KEY (id)
);

CREATE TABLE public."venue_spaces" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT venue_spaces_pkey PRIMARY KEY (id)
);

CREATE TABLE public."venue_connections" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  connected_venue_id uuid NOT NULL,
  connection_type public."venue_connection_type" NOT NULL DEFAULT 'nearby'::venue_connection_type,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT venue_connections_pkey PRIMARY KEY (id)
);

CREATE TABLE public."venue_bookings" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  venue_space_id uuid NOT NULL,
  source_type public."booking_source_type" NOT NULL,
  celebration_event_id uuid,
  production_event_id uuid,
  booking_type public."booking_type" NOT NULL,
  event_usage_type public."event_usage_type",
  booking_status public."booking_status" NOT NULL DEFAULT 'interested_date'::booking_status,
  privacy_required boolean NOT NULL DEFAULT false,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT venue_bookings_pkey PRIMARY KEY (id)
);

CREATE TABLE public."celebration_events" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  client_id uuid,
  seller_id uuid,
  event_date date,
  status public."celebration_status" NOT NULL DEFAULT 'quoted'::celebration_status,
  has_production boolean NOT NULL DEFAULT false,
  production_event_id uuid,
  total_sold_snapshot numeric,
  currency text NOT NULL DEFAULT 'MXN'::text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  lead_id uuid,
  planner_id uuid,
  primary_contact_id uuid,
  CONSTRAINT celebration_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public."celebration_concepts" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  concept_type public."celebration_concept_type" NOT NULL DEFAULT 'other'::celebration_concept_type,
  is_refundable_default boolean NOT NULL DEFAULT false,
  is_revenue_default boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  notes text,
  CONSTRAINT celebration_concepts_pkey PRIMARY KEY (id)
);

CREATE TABLE public."celebration_price_list" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid,
  venue_space_id uuid,
  concept_id uuid NOT NULL,
  base_price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN'::text,
  active boolean NOT NULL DEFAULT true,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT celebration_price_list_pkey PRIMARY KEY (id)
);

CREATE TABLE public."celebration_line_items" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  celebration_event_id uuid NOT NULL,
  concept_id uuid NOT NULL,
  venue_id uuid,
  venue_space_id uuid,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price_base numeric NOT NULL DEFAULT 0,
  unit_price_final numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  discount_percent numeric NOT NULL DEFAULT 0,
  manual_override boolean NOT NULL DEFAULT false,
  override_reason text,
  tax_scheme_id uuid,
  is_refundable boolean NOT NULL DEFAULT false,
  is_revenue boolean NOT NULL DEFAULT true,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  venue_booking_id uuid,
  CONSTRAINT celebration_line_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public."celebration_leads" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  celebration_event_id uuid,
  lead_name text NOT NULL,
  company_name text,
  email text,
  phone text,
  event_type text,
  event_date date,
  guest_count integer,
  estimated_budget numeric,
  status public."celebration_lead_status" NOT NULL DEFAULT 'new'::celebration_lead_status,
  source text,
  source_detail text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_page text,
  referrer text,
  form_name text,
  raw_payload jsonb,
  assigned_to uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT celebration_leads_pkey PRIMARY KEY (id)
);

CREATE TABLE public."production_events" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  client_id uuid,
  celebration_event_id uuid,
  producer_id uuid,
  event_date date,
  status public."production_status" NOT NULL DEFAULT 'prospect'::production_status,
  venue_notes text,
  budget_estimate numeric,
  currency text NOT NULL DEFAULT 'MXN'::text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public."production_categories" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  notes text,
  CONSTRAINT production_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public."production_items" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  production_event_id uuid NOT NULL,
  category_id uuid,
  provider_id uuid,
  description text NOT NULL,
  client_price numeric NOT NULL DEFAULT 0,
  provider_cost numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN'::text,
  profit_model public."profit_model" NOT NULL DEFAULT 'price_minus_cost'::profit_model,
  payment_flow public."payment_flow" NOT NULL DEFAULT 'company_pays_provider'::payment_flow,
  commission_amount numeric NOT NULL DEFAULT 0,
  commission_percent numeric NOT NULL DEFAULT 0,
  included_in_margin boolean NOT NULL DEFAULT true,
  excluded_from_price_cost boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now,
  production_location_id uuid,
  name text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_type text NOT NULL DEFAULT 'unit'::text,
  exclusion_reason text,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT production_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public."production_locations" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  production_event_id uuid NOT NULL,
  name text NOT NULL,
  venue_id uuid,
  venue_space_id uuid,
  address text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_locations_pkey PRIMARY KEY (id)
);

CREATE TABLE public."income_payments" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  celebration_event_id uuid,
  production_event_id uuid,
  payer_client_id uuid,
  payer_name text NOT NULL,
  payer_type public."payer_type" NOT NULL DEFAULT 'client'::payer_type,
  payment_type public."income_payment_type" NOT NULL DEFAULT 'abono'::income_payment_type,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  currency text NOT NULL DEFAULT 'MXN'::text,
  exchange_rate numeric,
  payment_method public."income_payment_method" NOT NULL DEFAULT 'transfer_mxn'::income_payment_method,
  company_bank_account_id uuid,
  tax_scheme_id uuid,
  is_refundable boolean NOT NULL DEFAULT false,
  is_revenue boolean NOT NULL DEFAULT true,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  admin_status text NOT NULL DEFAULT 'pending_review'::text CHECK (admin_status = ANY (ARRAY['pending_review'::text, 'validated'::text, 'rejected'::text])),
  admin_reviewed_by uuid,
  admin_reviewed_at timestamp with time zone,
  admin_notes text,
  validated_by uuid,
  validated_at timestamp with time zone,
  returned_at timestamp with time zone,
  company_receipt_document_id uuid,
  CONSTRAINT income_payments_pkey PRIMARY KEY (id)
);

CREATE TABLE public."income_payment_allocations" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  income_payment_id uuid NOT NULL,
  celebration_line_item_id uuid,
  production_item_id uuid,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT income_payment_allocations_pkey PRIMARY KEY (id)
);

CREATE TABLE public."sales_invoices" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  celebration_event_id uuid,
  production_event_id uuid,
  client_id uuid,
  invoice_number text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN'::text,
  tax_scheme_id uuid,
  status public."sales_invoice_status" NOT NULL DEFAULT 'draft'::sales_invoice_status,
  issued_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_invoices_pkey PRIMARY KEY (id)
);

CREATE TABLE public."tickets" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  numero_ticket integer UNIQUE,
  airtable_id text UNIQUE,
  titulo text,
  enviado_por text,
  enviado_por_origen text,
  timestamp_solicitud timestamp with time zone,
  venue text,
  negocio text,
  vertical public."vertical_enum",
  autorizador text,
  correo_autorizador text,
  slack_autorizador text,
  link_form_autorizacion text,
  autorizacion public."autorizacion_enum",
  timestamp_autorizacion timestamp with time zone,
  comentarios_autorizacion text,
  fecha_estimada_pago date,
  proveedor_id uuid,
  proveedor_alias text,
  nombre_completo_proveedor text,
  metodo_pago public."metodo_pago_enum",
  cuenta_bancaria_snapshot text,
  clabe_snapshot text,
  banco_snapshot text,
  descripcion text,
  moneda public."moneda_enum" DEFAULT 'MXN'::moneda_enum,
  tiene_factura boolean DEFAULT false,
  monto numeric,
  monto_sin_impuestos numeric,
  tipo_impuesto text,
  impuestos numeric,
  monto_final numeric,
  monto_en_mxn numeric,
  clasificador_admon text,
  calculo text,
  vobo_admon boolean,
  comentarios_vobo text,
  asignado_a text,
  notas text,
  estado public."estado_ticket_enum" DEFAULT 'Abierto'::estado_ticket_enum,
  fecha_pago date,
  timestamp_pago timestamp with time zone,
  liga_factura text,
  categorizacion_ai text,
  certeza_ai numeric,
  pase_a_sheets boolean DEFAULT false,
  cotizacion_url text,
  factura_pdf_url text,
  factura_xml_url text,
  comprobante_pago_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tickets_pkey PRIMARY KEY (id)
);
