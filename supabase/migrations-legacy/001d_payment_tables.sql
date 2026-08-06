-- Flux Operadora - Migracion 001d
-- Tablas: approval_rules, payment_requests, payment_request_items, payment_request_approvals, payment_receipts

CREATE TABLE public."approval_rules" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL,
  company_id uuid,
  cost_center_id uuid,
  amount_min numeric NOT NULL DEFAULT 0,
  amount_max numeric,
  approval_level integer NOT NULL DEFAULT 1,
  can_approve boolean NOT NULL DEFAULT true,
  can_reject boolean NOT NULL DEFAULT true,
  can_request_changes boolean NOT NULL DEFAULT true,
  can_approve_exception boolean NOT NULL DEFAULT false,
  can_request_budget_adjustment boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT approval_rules_pkey PRIMARY KEY (id)
);

CREATE TABLE public."payment_requests" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid,
  provider_bank_account_id uuid,
  celebration_event_id uuid,
  production_event_id uuid,
  cost_center_id uuid,
  request_type public."payment_request_type" NOT NULL DEFAULT 'provider_payment'::payment_request_type,
  requested_by uuid,
  approved_by uuid,
  validated_by uuid,
  paid_by uuid,
  amount_requested numeric NOT NULL CHECK (amount_requested > 0::numeric),
  currency text NOT NULL DEFAULT 'MXN'::text,
  exchange_rate numeric,
  requires_invoice boolean NOT NULL DEFAULT false,
  invoice_received boolean NOT NULL DEFAULT false,
  company_bank_account_id uuid,
  status public."payment_request_status" NOT NULL DEFAULT 'draft'::payment_request_status,
  due_date date,
  scheduled_payment_date date,
  paid_at timestamp with time zone,
  concept text NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  company_id uuid,
  proveedor_id uuid,
  budget_category_id uuid,
  budget_month date CHECK (budget_month IS NULL OR date_trunc('month'::text, budget_month::timestamp with time zone)::date = budget_month),
  budget_decision text NOT NULL DEFAULT 'not_checked'::text CHECK (budget_decision = ANY (ARRAY['not_checked'::text, 'aprobable'::text, 'bloqueado'::text])),
  budget_block_reason text,
  budget_available_before numeric,
  budget_available_after numeric,
  budget_shortfall numeric,
  budget_checked_at timestamp with time zone,
  is_extraordinary_adjustment boolean NOT NULL DEFAULT false,
  request_number text,
  description text,
  submitted_at timestamp with time zone,
  budget_result jsonb,
  exception_status text CHECK (exception_status IS NULL OR (exception_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'changes_requested'::text]))),
  exception_action text,
  exception_reason text,
  exception_approved_by uuid,
  exception_approved_at timestamp with time zone,
  requires_budget_adjustment boolean NOT NULL DEFAULT false,
  operational_comments text,
  payment_reference text,
  payment_concept text,
  scheduled_by uuid,
  scheduled_at timestamp with time zone,
  approved_at timestamp with time zone,
  invoice_storage_path text,
  CONSTRAINT payment_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE public."payment_request_items" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL,
  production_item_id uuid,
  celebration_line_item_id uuid,
  amount_requested numeric NOT NULL CHECK (amount_requested > 0::numeric),
  amount_paid numeric,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_request_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public."payment_request_approvals" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL,
  actor_profile_id uuid NOT NULL,
  role_id uuid,
  action text NOT NULL CHECK (action = ANY (ARRAY['approved'::text, 'rejected'::text, 'changes_requested'::text, 'exception_approved'::text, 'exception_rejected'::text, 'amount_change_requested'::text, 'category_change_requested'::text, 'budget_adjustment_requested'::text])),
  from_status text,
  to_status text,
  comments text,
  approval_level integer NOT NULL DEFAULT 1,
  budget_decision_snapshot text,
  budget_block_reason_snapshot text,
  budget_result_snapshot jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_request_approvals_pkey PRIMARY KEY (id)
);

CREATE TABLE public."payment_receipts" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL,
  layout_id uuid,
  payment_date date NOT NULL,
  amount numeric NOT NULL,
  bank_reference text,
  storage_path text,
  registered_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipts_pkey PRIMARY KEY (id)
);
