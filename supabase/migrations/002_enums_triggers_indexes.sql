-- Flux Operadora - Migracion 002
-- Indices y triggers generados desde exports reales de Supabase dev.

-- Funciones de soporte requeridas por triggers updated_at.
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Indices no asociados directamente a constraints.
CREATE INDEX IF NOT EXISTS idx_approval_rules_active ON public.approval_rules USING btree (active);
CREATE INDEX IF NOT EXISTS idx_approval_rules_level ON public.approval_rules USING btree (approval_level);
CREATE INDEX IF NOT EXISTS idx_approval_rules_role ON public.approval_rules USING btree (role_id);
CREATE INDEX IF NOT EXISTS idx_approval_rules_scope ON public.approval_rules USING btree (company_id, cost_center_id, active);
CREATE INDEX IF NOT EXISTS idx_billing_periods_cutoff_date ON public.billing_periods USING btree (cutoff_date);
CREATE INDEX IF NOT EXISTS idx_billing_periods_status ON public.billing_periods USING btree (status);
CREATE INDEX IF NOT EXISTS idx_billing_periods_year ON public.billing_periods USING btree (year);
CREATE INDEX IF NOT EXISTS budget_import_batches_status_idx ON public.budget_import_batches USING btree (status);
CREATE INDEX IF NOT EXISTS budget_import_staging_batch_idx ON public.budget_import_staging USING btree (batch_id);
CREATE INDEX IF NOT EXISTS budget_import_staging_category_idx ON public.budget_import_staging USING btree (budget_category_id);
CREATE INDEX IF NOT EXISTS budget_import_staging_lookup_idx ON public.budget_import_staging USING btree (company_name, cost_center_name, final_code, budget_month);
CREATE INDEX IF NOT EXISTS budget_import_staging_validation_idx ON public.budget_import_staging USING btree (batch_id, validation_status);
CREATE INDEX IF NOT EXISTS budget_lines_budget_version_id_idx ON public.budget_lines USING btree (budget_version_id);
CREATE INDEX IF NOT EXISTS budget_lines_lookup_idx ON public.budget_lines USING btree (company_id, cost_center_id, budget_category_id, budget_month);
CREATE UNIQUE INDEX IF NOT EXISTS budget_versions_one_active_per_year_idx ON public.budget_versions USING btree (year) WHERE (active = true);
CREATE INDEX IF NOT EXISTS idx_cash_funds_due_date ON public.cash_funds USING btree (due_date);
CREATE INDEX IF NOT EXISTS idx_cash_funds_payment_request ON public.cash_funds USING btree (payment_request_id);
CREATE INDEX IF NOT EXISTS idx_cash_funds_responsible_status ON public.cash_funds USING btree (responsible_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_items_budget_category ON public.cash_reconciliation_items USING btree (budget_category_id);
CREATE INDEX IF NOT EXISTS idx_cash_items_proveedor ON public.cash_reconciliation_items USING btree (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_cash_items_reconciliation ON public.cash_reconciliation_items USING btree (reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_cash_reconciliations_fund_status ON public.cash_reconciliations USING btree (cash_fund_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_reconciliations_submitted_by ON public.cash_reconciliations USING btree (submitted_by);
CREATE INDEX IF NOT EXISTS idx_celebration_events_client ON public.celebration_events USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_celebration_events_seller ON public.celebration_events USING btree (seller_id);
CREATE INDEX IF NOT EXISTS idx_celebration_leads_created_at ON public.celebration_leads USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_celebration_leads_event_id ON public.celebration_leads USING btree (celebration_event_id);
CREATE INDEX IF NOT EXISTS idx_celebration_leads_source ON public.celebration_leads USING btree (source);
CREATE INDEX IF NOT EXISTS idx_celebration_leads_status ON public.celebration_leads USING btree (status);
CREATE INDEX IF NOT EXISTS idx_celebration_leads_utm_campaign ON public.celebration_leads USING btree (utm_campaign);
CREATE INDEX IF NOT EXISTS celebration_line_items_event_concept_idx ON public.celebration_line_items USING btree (celebration_event_id, concept_id);
CREATE INDEX IF NOT EXISTS celebration_line_items_venue_booking_id_idx ON public.celebration_line_items USING btree (venue_booking_id);
CREATE INDEX IF NOT EXISTS idx_celebration_line_items_event ON public.celebration_line_items USING btree (celebration_event_id);
CREATE INDEX IF NOT EXISTS company_bank_accounts_company_id_idx ON public.company_bank_accounts USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_company_bank_accounts_company_active ON public.company_bank_accounts USING btree (company_id, active);
CREATE INDEX IF NOT EXISTS cccbc_budget_category_id_idx ON public.company_cost_center_budget_categories USING btree (budget_category_id);
CREATE INDEX IF NOT EXISTS cccbc_company_id_idx ON public.company_cost_center_budget_categories USING btree (company_id);
CREATE INDEX IF NOT EXISTS cccbc_cost_center_id_idx ON public.company_cost_center_budget_categories USING btree (cost_center_id);
CREATE INDEX IF NOT EXISTS company_cost_centers_company_id_idx ON public.company_cost_centers USING btree (company_id);
CREATE INDEX IF NOT EXISTS company_cost_centers_cost_center_id_idx ON public.company_cost_centers USING btree (cost_center_id);
CREATE INDEX IF NOT EXISTS idx_document_links_entity ON public.document_links USING btree (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON public.documents USING btree (file_type);
CREATE INDEX IF NOT EXISTS idx_incident_charges_budget_category_id ON public.incident_charges USING btree (budget_category_id);
CREATE INDEX IF NOT EXISTS idx_incident_charges_company_id ON public.incident_charges USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_incident_charges_cost_center_id ON public.incident_charges USING btree (cost_center_id);
CREATE INDEX IF NOT EXISTS idx_incident_charges_external_name ON public.incident_charges USING btree (external_name);
CREATE INDEX IF NOT EXISTS idx_incident_charges_incident_date ON public.incident_charges USING btree (incident_date);
CREATE INDEX IF NOT EXISTS idx_incident_charges_member_id ON public.incident_charges USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_incident_charges_referred_by_member_id ON public.incident_charges USING btree (referred_by_member_id);
CREATE INDEX IF NOT EXISTS idx_incident_charges_status ON public.incident_charges USING btree (status);
CREATE INDEX IF NOT EXISTS idx_income_allocations_income ON public.income_payment_allocations USING btree (income_payment_id);
CREATE INDEX IF NOT EXISTS idx_income_payments_celebration ON public.income_payments USING btree (celebration_event_id);
CREATE INDEX IF NOT EXISTS idx_income_payments_production ON public.income_payments USING btree (production_event_id);
CREATE INDEX IF NOT EXISTS idx_invoices_charge_id ON public.invoices USING btree (charge_id);
CREATE INDEX IF NOT EXISTS idx_invoices_fiscal_uuid ON public.invoices USING btree (fiscal_uuid);
CREATE INDEX IF NOT EXISTS idx_invoices_incident_charge_id ON public.invoices USING btree (incident_charge_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON public.invoices USING btree (invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON public.invoices USING btree (issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_member_id ON public.invoices USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices USING btree (status);
CREATE INDEX IF NOT EXISTS idx_maintenance_fee_charges_billing_period_id ON public.maintenance_fee_charges USING btree (billing_period_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_fee_charges_member_id ON public.maintenance_fee_charges USING btree (member_id);

-- Triggers definidos por usuario.
CREATE TRIGGER trg_billing_periods_updated_at BEFORE UPDATE ON public.billing_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cash_funds_updated_at BEFORE UPDATE ON public.cash_funds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cash_reconciliation_items_updated_at BEFORE UPDATE ON public.cash_reconciliation_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cash_reconciliations_updated_at BEFORE UPDATE ON public.cash_reconciliations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_celebration_events_updated_at BEFORE UPDATE ON public.celebration_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_celebration_leads_updated_at BEFORE UPDATE ON public.celebration_leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_celebration_line_items_updated_at BEFORE UPDATE ON public.celebration_line_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_celebration_price_list_updated_at BEFORE UPDATE ON public.celebration_price_list FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_client_contacts_updated_at BEFORE UPDATE ON public.client_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_company_bank_accounts_updated_at BEFORE UPDATE ON public.company_bank_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_cost_centers_updated_at BEFORE UPDATE ON public.cost_centers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_incident_charges_updated_at BEFORE UPDATE ON public.incident_charges FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_income_payment_allocations_updated_at BEFORE UPDATE ON public.income_payment_allocations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_income_payments_updated_at BEFORE UPDATE ON public.income_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_maintenance_fee_charges_updated_at BEFORE UPDATE ON public.maintenance_fee_charges FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_members_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_monthly_closure_comments_updated_at BEFORE UPDATE ON public.monthly_closure_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_monthly_closure_exports_updated_at BEFORE UPDATE ON public.monthly_closure_exports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_monthly_closures_updated_at BEFORE UPDATE ON public.monthly_closures FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_payment_request_items_updated_at BEFORE UPDATE ON public.payment_request_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_payment_requests_updated_at BEFORE UPDATE ON public.payment_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_production_events_updated_at BEFORE UPDATE ON public.production_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_production_items_updated_at BEFORE UPDATE ON public.production_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER proveedores_updated_at BEFORE UPDATE ON public.proveedores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_provider_bank_accounts_updated_at BEFORE UPDATE ON public.provider_bank_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_providers_updated_at BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_sales_invoices_updated_at BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_venue_bookings_updated_at BEFORE UPDATE ON public.venue_bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_venue_spaces_updated_at BEFORE UPDATE ON public.venue_spaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();
