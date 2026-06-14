-- Flux Operadora - Migracion 001h
-- Tablas: monthly_closures, monthly_closure_exports, monthly_closure_comments

CREATE TABLE public."monthly_closures" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_key text NOT NULL UNIQUE,
  year integer NOT NULL CHECK (year >= 2020),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'review'::text, 'closed'::text, 'cancelled'::text])),
  closed_by uuid,
  closed_at timestamp with time zone,
  sheet_url text,
  slides_url text,
  pdf_url text,
  drive_folder_url text,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  executive_summary text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT monthly_closures_pkey PRIMARY KEY (id)
);

CREATE TABLE public."monthly_closure_exports" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  monthly_closure_id uuid NOT NULL,
  export_type text NOT NULL CHECK (export_type = ANY (ARRAY['sheet'::text, 'slides'::text, 'pdf'::text, 'both'::text])),
  status text NOT NULL DEFAULT 'requested'::text CHECK (status = ANY (ARRAY['requested'::text, 'processing'::text, 'completed'::text, 'failed'::text])),
  requested_by uuid,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  sheet_url text,
  slides_url text,
  pdf_url text,
  error_message text,
  n8n_execution_id text,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT monthly_closure_exports_pkey PRIMARY KEY (id)
);

CREATE TABLE public."monthly_closure_comments" (

  id uuid NOT NULL DEFAULT gen_random_uuid(),
  monthly_closure_id uuid NOT NULL,
  section text NOT NULL CHECK (section = ANY (ARRAY['kpis'::text, 'budget'::text, 'ytd'::text, 'income'::text, 'incidents'::text, 'cash'::text, 'risks'::text, 'executive_summary'::text, 'next_steps'::text, 'other'::text])),
  comment text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT monthly_closure_comments_pkey PRIMARY KEY (id)
);

-- Foreign keys publicas. Se agregan aqui porque para este punto ya existen todas las tablas base.
alter table only public."activity_log" add constraint "activity_log_performed_by_fkey" FOREIGN KEY (performed_by) REFERENCES public."profiles"(id);
alter table only public."approval_rules" add constraint "approval_rules_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."approval_rules" add constraint "approval_rules_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."approval_rules" add constraint "approval_rules_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public."roles"(id);
alter table only public."billing_periods" add constraint "billing_periods_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."budget_import_batches" add constraint "budget_import_batches_budget_version_id_fkey" FOREIGN KEY (budget_version_id) REFERENCES public."budget_versions"(id);
alter table only public."budget_import_batches" add constraint "budget_import_batches_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."budget_import_batches" add constraint "budget_import_batches_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."budget_import_batches" add constraint "budget_import_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."budget_import_staging" add constraint "budget_import_staging_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES public."budget_import_batches"(id) ON DELETE CASCADE;
alter table only public."budget_import_staging" add constraint "budget_import_staging_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES public."budget_categories"(id);
alter table only public."budget_import_staging" add constraint "budget_import_staging_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."budget_import_staging" add constraint "budget_import_staging_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."budget_lines" add constraint "budget_lines_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES public."budget_categories"(id);
alter table only public."budget_lines" add constraint "budget_lines_budget_version_id_fkey" FOREIGN KEY (budget_version_id) REFERENCES public."budget_versions"(id);
alter table only public."budget_lines" add constraint "budget_lines_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."budget_lines" add constraint "budget_lines_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."budget_versions" add constraint "budget_versions_loaded_by_fkey" FOREIGN KEY (loaded_by) REFERENCES public."profiles"(id);
alter table only public."cash_funds" add constraint "cash_funds_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."cash_funds" add constraint "cash_funds_delivered_by_fkey" FOREIGN KEY (delivered_by) REFERENCES public."profiles"(id);
alter table only public."cash_funds" add constraint "cash_funds_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES public."payment_requests"(id);
alter table only public."cash_funds" add constraint "cash_funds_responsible_profile_id_fkey" FOREIGN KEY (responsible_profile_id) REFERENCES public."profiles"(id);
alter table only public."cash_reconciliation_items" add constraint "cash_reconciliation_items_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES public."budget_categories"(id);
alter table only public."cash_reconciliation_items" add constraint "cash_reconciliation_items_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES public."proveedores"(id);
alter table only public."cash_reconciliation_items" add constraint "cash_reconciliation_items_reconciliation_id_fkey" FOREIGN KEY (reconciliation_id) REFERENCES public."cash_reconciliations"(id) ON DELETE CASCADE;
alter table only public."cash_reconciliations" add constraint "cash_reconciliations_cash_fund_id_fkey" FOREIGN KEY (cash_fund_id) REFERENCES public."cash_funds"(id) ON DELETE CASCADE;
alter table only public."cash_reconciliations" add constraint "cash_reconciliations_reviewer_profile_id_fkey" FOREIGN KEY (reviewer_profile_id) REFERENCES public."profiles"(id);
alter table only public."cash_reconciliations" add constraint "cash_reconciliations_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES public."profiles"(id);
alter table only public."celebration_events" add constraint "celebration_events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public."clients"(id);
alter table only public."celebration_events" add constraint "celebration_events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."celebration_events" add constraint "celebration_events_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES public."celebration_leads"(id);
alter table only public."celebration_events" add constraint "celebration_events_planner_id_fkey" FOREIGN KEY (planner_id) REFERENCES public."profiles"(id);
alter table only public."celebration_events" add constraint "celebration_events_primary_contact_id_fkey" FOREIGN KEY (primary_contact_id) REFERENCES public."client_contacts"(id);
alter table only public."celebration_events" add constraint "celebration_events_production_event_fk" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id);
alter table only public."celebration_events" add constraint "celebration_events_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public."profiles"(id);
alter table only public."celebration_leads" add constraint "celebration_leads_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES public."profiles"(id);
alter table only public."celebration_leads" add constraint "celebration_leads_event_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id);
alter table only public."celebration_line_items" add constraint "celebration_line_items_celebration_event_id_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id) ON DELETE CASCADE;
alter table only public."celebration_line_items" add constraint "celebration_line_items_concept_id_fkey" FOREIGN KEY (concept_id) REFERENCES public."celebration_concepts"(id);
alter table only public."celebration_line_items" add constraint "celebration_line_items_tax_scheme_id_fkey" FOREIGN KEY (tax_scheme_id) REFERENCES public."tax_schemes"(id);
alter table only public."celebration_line_items" add constraint "celebration_line_items_venue_booking_id_fkey" FOREIGN KEY (venue_booking_id) REFERENCES public."venue_bookings"(id) ON DELETE SET NULL;
alter table only public."celebration_line_items" add constraint "celebration_line_items_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public."venues"(id);
alter table only public."celebration_line_items" add constraint "celebration_line_items_venue_space_id_fkey" FOREIGN KEY (venue_space_id) REFERENCES public."venue_spaces"(id);
alter table only public."celebration_price_list" add constraint "celebration_price_list_concept_id_fkey" FOREIGN KEY (concept_id) REFERENCES public."celebration_concepts"(id);
alter table only public."celebration_price_list" add constraint "celebration_price_list_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public."venues"(id);
alter table only public."celebration_price_list" add constraint "celebration_price_list_venue_space_id_fkey" FOREIGN KEY (venue_space_id) REFERENCES public."venue_spaces"(id);
alter table only public."client_contacts" add constraint "client_contacts_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public."clients"(id) ON DELETE CASCADE;
alter table only public."company_bank_accounts" add constraint "company_bank_accounts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."company_cost_center_budget_categories" add constraint "company_cost_center_budget_categories_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES public."budget_categories"(id);
alter table only public."company_cost_center_budget_categories" add constraint "company_cost_center_budget_categories_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."company_cost_center_budget_categories" add constraint "company_cost_center_budget_categories_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."company_cost_centers" add constraint "company_cost_centers_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."company_cost_centers" add constraint "company_cost_centers_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."document_links" add constraint "document_links_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public."documents"(id) ON DELETE CASCADE;
alter table only public."documents" add constraint "documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES public."profiles"(id);
alter table only public."incident_charges" add constraint "incident_charges_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES public."budget_categories"(id);
alter table only public."incident_charges" add constraint "incident_charges_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."incident_charges" add constraint "incident_charges_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."incident_charges" add constraint "incident_charges_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES public."invoices"(id);
alter table only public."incident_charges" add constraint "incident_charges_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public."members"(id);
alter table only public."incident_charges" add constraint "incident_charges_referred_by_member_id_fkey" FOREIGN KEY (referred_by_member_id) REFERENCES public."members"(id);
alter table only public."incident_charges" add constraint "incident_charges_registered_by_fkey" FOREIGN KEY (registered_by) REFERENCES public."profiles"(id);
alter table only public."income_payment_allocations" add constraint "income_payment_allocations_celebration_line_item_id_fkey" FOREIGN KEY (celebration_line_item_id) REFERENCES public."celebration_line_items"(id) ON DELETE CASCADE;
alter table only public."income_payment_allocations" add constraint "income_payment_allocations_income_payment_id_fkey" FOREIGN KEY (income_payment_id) REFERENCES public."income_payments"(id) ON DELETE CASCADE;
alter table only public."income_payment_allocations" add constraint "income_payment_allocations_production_item_id_fkey" FOREIGN KEY (production_item_id) REFERENCES public."production_items"(id) ON DELETE CASCADE;
alter table only public."income_payments" add constraint "income_payments_admin_reviewed_by_fkey" FOREIGN KEY (admin_reviewed_by) REFERENCES public."profiles"(id);
alter table only public."income_payments" add constraint "income_payments_celebration_event_id_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id) ON DELETE CASCADE;
alter table only public."income_payments" add constraint "income_payments_company_bank_account_id_fkey" FOREIGN KEY (company_bank_account_id) REFERENCES public."company_bank_accounts"(id);
alter table only public."income_payments" add constraint "income_payments_company_receipt_document_id_fkey" FOREIGN KEY (company_receipt_document_id) REFERENCES public."documents"(id);
alter table only public."income_payments" add constraint "income_payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."income_payments" add constraint "income_payments_payer_client_id_fkey" FOREIGN KEY (payer_client_id) REFERENCES public."clients"(id);
alter table only public."income_payments" add constraint "income_payments_production_event_id_fkey" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id) ON DELETE CASCADE;
alter table only public."income_payments" add constraint "income_payments_tax_scheme_id_fkey" FOREIGN KEY (tax_scheme_id) REFERENCES public."tax_schemes"(id);
alter table only public."income_payments" add constraint "income_payments_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES public."profiles"(id);
alter table only public."invoices" add constraint "invoices_charge_id_fkey" FOREIGN KEY (charge_id) REFERENCES public."maintenance_fee_charges"(id);
alter table only public."invoices" add constraint "invoices_incident_charge_id_fkey" FOREIGN KEY (incident_charge_id) REFERENCES public."incident_charges"(id);
alter table only public."invoices" add constraint "invoices_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public."members"(id);
alter table only public."maintenance_fee_charges" add constraint "maintenance_fee_charges_billing_period_id_fkey" FOREIGN KEY (billing_period_id) REFERENCES public."billing_periods"(id);
alter table only public."maintenance_fee_charges" add constraint "maintenance_fee_charges_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES public."invoices"(id);
alter table only public."maintenance_fee_charges" add constraint "maintenance_fee_charges_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public."members"(id);
alter table only public."maintenance_fee_payments" add constraint "maintenance_fee_payments_billing_period_id_fkey" FOREIGN KEY (billing_period_id) REFERENCES public."billing_periods"(id);
alter table only public."maintenance_fee_payments" add constraint "maintenance_fee_payments_charge_id_fkey" FOREIGN KEY (charge_id) REFERENCES public."maintenance_fee_charges"(id);
alter table only public."maintenance_fee_payments" add constraint "maintenance_fee_payments_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES public."invoices"(id);
alter table only public."maintenance_fee_payments" add constraint "maintenance_fee_payments_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public."members"(id);
alter table only public."maintenance_fee_payments" add constraint "maintenance_fee_payments_registered_by_fkey" FOREIGN KEY (registered_by) REFERENCES public."profiles"(id);
alter table only public."monthly_closure_comments" add constraint "monthly_closure_comments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."monthly_closure_comments" add constraint "monthly_closure_comments_monthly_closure_id_fkey" FOREIGN KEY (monthly_closure_id) REFERENCES public."monthly_closures"(id) ON DELETE CASCADE;
alter table only public."monthly_closure_exports" add constraint "monthly_closure_exports_monthly_closure_id_fkey" FOREIGN KEY (monthly_closure_id) REFERENCES public."monthly_closures"(id) ON DELETE CASCADE;
alter table only public."monthly_closure_exports" add constraint "monthly_closure_exports_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES public."profiles"(id);
alter table only public."monthly_closures" add constraint "monthly_closures_closed_by_fkey" FOREIGN KEY (closed_by) REFERENCES public."profiles"(id);
alter table only public."monthly_closures" add constraint "monthly_closures_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."payment_layout_lines" add constraint "payment_layout_lines_company_bank_account_id_fkey" FOREIGN KEY (company_bank_account_id) REFERENCES public."company_bank_accounts"(id);
alter table only public."payment_layout_lines" add constraint "payment_layout_lines_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."payment_layout_lines" add constraint "payment_layout_lines_layout_id_fkey" FOREIGN KEY (layout_id) REFERENCES public."payment_layouts"(id) ON DELETE CASCADE;
alter table only public."payment_layout_lines" add constraint "payment_layout_lines_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES public."payment_requests"(id);
alter table only public."payment_layout_lines" add constraint "payment_layout_lines_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES public."proveedores"(id);
alter table only public."payment_layouts" add constraint "payment_layouts_generated_by_fkey" FOREIGN KEY (generated_by) REFERENCES public."profiles"(id);
alter table only public."payment_receipts" add constraint "payment_receipts_layout_id_fkey" FOREIGN KEY (layout_id) REFERENCES public."payment_layouts"(id);
alter table only public."payment_receipts" add constraint "payment_receipts_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES public."payment_requests"(id);
alter table only public."payment_receipts" add constraint "payment_receipts_registered_by_fkey" FOREIGN KEY (registered_by) REFERENCES public."profiles"(id);
alter table only public."payment_request_approvals" add constraint "payment_request_approvals_actor_profile_id_fkey" FOREIGN KEY (actor_profile_id) REFERENCES public."profiles"(id);
alter table only public."payment_request_approvals" add constraint "payment_request_approvals_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES public."payment_requests"(id) ON DELETE CASCADE;
alter table only public."payment_request_approvals" add constraint "payment_request_approvals_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public."roles"(id);
alter table only public."payment_request_items" add constraint "payment_request_items_celebration_line_item_id_fkey" FOREIGN KEY (celebration_line_item_id) REFERENCES public."celebration_line_items"(id) ON DELETE CASCADE;
alter table only public."payment_request_items" add constraint "payment_request_items_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES public."payment_requests"(id) ON DELETE CASCADE;
alter table only public."payment_request_items" add constraint "payment_request_items_production_item_id_fkey" FOREIGN KEY (production_item_id) REFERENCES public."production_items"(id) ON DELETE CASCADE;
alter table only public."payment_requests" add constraint "payment_requests_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public."profiles"(id);
alter table only public."payment_requests" add constraint "payment_requests_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES public."budget_categories"(id);
alter table only public."payment_requests" add constraint "payment_requests_celebration_event_id_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id) ON DELETE CASCADE;
alter table only public."payment_requests" add constraint "payment_requests_company_bank_account_id_fkey" FOREIGN KEY (company_bank_account_id) REFERENCES public."company_bank_accounts"(id);
alter table only public."payment_requests" add constraint "payment_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public."companies"(id);
alter table only public."payment_requests" add constraint "payment_requests_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES public."cost_centers"(id);
alter table only public."payment_requests" add constraint "payment_requests_exception_approved_by_fkey" FOREIGN KEY (exception_approved_by) REFERENCES public."profiles"(id);
alter table only public."payment_requests" add constraint "payment_requests_paid_by_fkey" FOREIGN KEY (paid_by) REFERENCES public."profiles"(id);
alter table only public."payment_requests" add constraint "payment_requests_production_event_id_fkey" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id) ON DELETE CASCADE;
alter table only public."payment_requests" add constraint "payment_requests_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES public."proveedores"(id);
alter table only public."payment_requests" add constraint "payment_requests_provider_bank_account_id_fkey" FOREIGN KEY (provider_bank_account_id) REFERENCES public."provider_bank_accounts"(id);
alter table only public."payment_requests" add constraint "payment_requests_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES public."providers"(id);
alter table only public."payment_requests" add constraint "payment_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES public."profiles"(id);
alter table only public."payment_requests" add constraint "payment_requests_scheduled_by_fkey" FOREIGN KEY (scheduled_by) REFERENCES public."profiles"(id);
alter table only public."payment_requests" add constraint "payment_requests_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES public."profiles"(id);
alter table only public."production_events" add constraint "production_events_celebration_event_id_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id);
alter table only public."production_events" add constraint "production_events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public."clients"(id);
alter table only public."production_events" add constraint "production_events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."production_events" add constraint "production_events_producer_id_fkey" FOREIGN KEY (producer_id) REFERENCES public."profiles"(id);
alter table only public."production_items" add constraint "production_items_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public."production_categories"(id);
alter table only public."production_items" add constraint "production_items_production_event_id_fkey" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id) ON DELETE CASCADE;
alter table only public."production_items" add constraint "production_items_production_location_id_fkey" FOREIGN KEY (production_location_id) REFERENCES public."production_locations"(id) ON DELETE SET NULL;
alter table only public."production_items" add constraint "production_items_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES public."providers"(id);
alter table only public."production_locations" add constraint "production_locations_production_event_id_fkey" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id) ON DELETE CASCADE;
alter table only public."production_locations" add constraint "production_locations_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public."venues"(id);
alter table only public."production_locations" add constraint "production_locations_venue_space_id_fkey" FOREIGN KEY (venue_space_id) REFERENCES public."venue_spaces"(id);
alter table only public."profiles" add constraint "profiles_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."proveedor_provider_links" add constraint "proveedor_provider_links_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."proveedor_provider_links" add constraint "proveedor_provider_links_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES public."proveedores"(id);
alter table only public."proveedor_provider_links" add constraint "proveedor_provider_links_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES public."providers"(id);
alter table only public."provider_bank_accounts" add constraint "provider_bank_accounts_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES public."providers"(id) ON DELETE CASCADE;
alter table only public."provider_bank_accounts" add constraint "provider_bank_accounts_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES public."profiles"(id);
alter table only public."providers" add constraint "providers_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES public."profiles"(id);
alter table only public."sales_invoices" add constraint "sales_invoices_celebration_event_id_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id) ON DELETE CASCADE;
alter table only public."sales_invoices" add constraint "sales_invoices_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public."clients"(id);
alter table only public."sales_invoices" add constraint "sales_invoices_production_event_id_fkey" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id) ON DELETE CASCADE;
alter table only public."sales_invoices" add constraint "sales_invoices_tax_scheme_id_fkey" FOREIGN KEY (tax_scheme_id) REFERENCES public."tax_schemes"(id);
alter table only public."tickets" add constraint "tickets_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES public."proveedores"(id) ON DELETE SET NULL;
alter table only public."user_roles" add constraint "user_roles_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public."profiles"(id) ON DELETE CASCADE;
alter table only public."user_roles" add constraint "user_roles_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public."roles"(id) ON DELETE CASCADE;
alter table only public."venue_bookings" add constraint "venue_bookings_celebration_event_id_fkey" FOREIGN KEY (celebration_event_id) REFERENCES public."celebration_events"(id) ON DELETE CASCADE;
alter table only public."venue_bookings" add constraint "venue_bookings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."profiles"(id);
alter table only public."venue_bookings" add constraint "venue_bookings_production_event_id_fkey" FOREIGN KEY (production_event_id) REFERENCES public."production_events"(id) ON DELETE CASCADE;
alter table only public."venue_bookings" add constraint "venue_bookings_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public."venues"(id);
alter table only public."venue_bookings" add constraint "venue_bookings_venue_space_id_fkey" FOREIGN KEY (venue_space_id) REFERENCES public."venue_spaces"(id);
alter table only public."venue_connections" add constraint "venue_connections_connected_venue_id_fkey" FOREIGN KEY (connected_venue_id) REFERENCES public."venues"(id) ON DELETE CASCADE;
alter table only public."venue_connections" add constraint "venue_connections_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public."venues"(id) ON DELETE CASCADE;
alter table only public."venue_spaces" add constraint "venue_spaces_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public."venues"(id) ON DELETE CASCADE;
