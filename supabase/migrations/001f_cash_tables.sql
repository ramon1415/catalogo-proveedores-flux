-- Flux Operadora - Migracion 001f
-- Tablas: cash_funds, cash_reconciliations, cash_reconciliation_items

CREATE TABLE public."cash_funds" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  payment_request_id uuid NOT NULL UNIQUE,
  responsible_profile_id uuid NOT NULL,
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0::numeric),
  verified_amount numeric NOT NULL DEFAULT 0 CHECK (verified_amount >= 0::numeric),
  pending_amount numeric DEFAULT (assigned_amount - verified_amount),
  assignment_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'pending_receipt'::text, 'blocked'::text, 'verified'::text, 'closed'::text, 'cancelled'::text, 'receipt_review'::text])),
  delivery_method text NOT NULL CHECK (delivery_method = ANY (ARRAY['cash'::text, 'check'::text])),
  delivered_by uuid,
  delivered_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cash_funds_pkey PRIMARY KEY (id)
);

CREATE TABLE public."cash_reconciliations" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cash_fund_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  total_tickets numeric NOT NULL DEFAULT 0 CHECK (total_tickets >= 0::numeric),
  returned_amount numeric NOT NULL DEFAULT 0 CHECK (returned_amount >= 0::numeric),
  difference_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'correction_requested'::text])),
  reviewer_profile_id uuid,
  reviewer_comment text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cash_reconciliations_pkey PRIMARY KEY (id)
);

CREATE TABLE public."cash_reconciliation_items" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL,
  budget_category_id uuid,
  proveedor_id uuid,
  concept text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  ticket_date date NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'valid'::text CHECK (status = ANY (ARRAY['valid'::text, 'rejected'::text])),
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cash_reconciliation_items_pkey PRIMARY KEY (id)
);
