create or replace view public.budget_availability as
 SELECT bl.company_id,
    bl.cost_center_id,
    bl.budget_category_id,
    bl.budget_month,
    bl.amount AS budgeted,
    COALESCE(sum(pr.amount_requested * COALESCE(pr.exchange_rate, 1::numeric)) FILTER (WHERE (pr.status::text = ANY (ARRAY['submitted'::text, 'pending_approval'::text, 'approved'::text, 'finance_validation'::text, 'scheduled'::text, 'paid'::text])) AND pr.budget_decision = 'aprobable'::text), 0::numeric) AS committed,
    COALESCE(sum(pr.amount_requested * COALESCE(pr.exchange_rate, 1::numeric)) FILTER (WHERE pr.status::text = 'paid'::text AND pr.budget_decision = 'aprobable'::text), 0::numeric) AS executed,
    bl.amount - COALESCE(sum(pr.amount_requested * COALESCE(pr.exchange_rate, 1::numeric)) FILTER (WHERE (pr.status::text = ANY (ARRAY['submitted'::text, 'pending_approval'::text, 'approved'::text, 'finance_validation'::text, 'scheduled'::text, 'paid'::text])) AND pr.budget_decision = 'aprobable'::text), 0::numeric) AS available
   FROM budget_lines bl
     JOIN budget_versions bv ON bv.id = bl.budget_version_id AND bv.active = true
     LEFT JOIN payment_requests pr ON pr.company_id = bl.company_id AND pr.cost_center_id = bl.cost_center_id AND pr.budget_category_id = bl.budget_category_id AND pr.budget_month = bl.budget_month AND (pr.status::text <> ALL (ARRAY['rejected'::text, 'cancelled'::text]))
  GROUP BY bl.company_id, bl.cost_center_id, bl.budget_category_id, bl.budget_month, bl.amount;;

create or replace view public.budget_exceptions as
 SELECT id,
    provider_id,
    provider_bank_account_id,
    celebration_event_id,
    production_event_id,
    cost_center_id,
    request_type,
    requested_by,
    approved_by,
    validated_by,
    paid_by,
    amount_requested,
    currency,
    exchange_rate,
    requires_invoice,
    invoice_received,
    company_bank_account_id,
    status,
    due_date,
    scheduled_payment_date,
    paid_at,
    concept,
    notes,
    created_at,
    updated_at,
    company_id,
    proveedor_id,
    budget_category_id,
    budget_month,
    budget_decision,
    budget_block_reason,
    budget_available_before,
    budget_available_after,
    budget_shortfall,
    budget_checked_at,
    is_extraordinary_adjustment,
    request_number,
    description,
    submitted_at,
    budget_result
   FROM payment_requests pr
  WHERE budget_decision = 'bloqueado'::text OR is_extraordinary_adjustment = true;;

create or replace view public.celebration_events_with_dates as
 SELECT id,
    event_name,
    client_id,
    seller_id,
    event_date,
    status,
    has_production,
    production_event_id,
    total_sold_snapshot,
    currency,
    notes,
    created_by,
    created_at,
    updated_at,
    lead_id,
    planner_id,
    primary_contact_id
   FROM celebration_events ce
  WHERE event_date IS NOT NULL;;
