-- Ejecutar solo en Supabase DEV: scsirgbuqjcwoaxfacth.
begin transaction read only;

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('transaction_read_only') as transaction_read_only,
  now() as checked_at;

with required_relations(name) as (
  values
    ('approval_batches'),
    ('approval_batch_items'),
    ('approval_batch_company_settings'),
    ('payment_requests'),
    ('payment_request_extraordinary_authorizations'),
    ('payment_layouts'),
    ('payment_layout_lines'),
    ('payment_receipts'),
    ('cash_funds'),
    ('companies'),
    ('company_bank_accounts'),
    ('profiles'),
    ('proveedores'),
    ('cost_centers'),
    ('budget_categories'),
    ('notification_events')
)
select
  'required_relations' as check_name,
  case when bool_and(to_regclass('public.' || name) is not null) then 'PASS' else 'FAIL' end as check_status,
  coalesce(string_agg(name, ', ') filter (where to_regclass('public.' || name) is null), 'none') as missing
from required_relations;

with required_columns(table_name, column_name) as (
  values
    ('payment_requests', 'approval_material_updated_at'),
    ('payment_requests', 'company_id'),
    ('payment_requests', 'requested_by'),
    ('payment_requests', 'proveedor_id'),
    ('payment_requests', 'cost_center_id'),
    ('payment_requests', 'budget_category_id'),
    ('payment_requests', 'budget_month'),
    ('payment_requests', 'amount_requested'),
    ('payment_requests', 'currency'),
    ('payment_requests', 'exchange_rate'),
    ('payment_requests', 'is_extraordinary_adjustment'),
    ('payment_requests', 'request_type'),
    ('payment_requests', 'payment_method'),
    ('payment_requests', 'company_bank_account_id'),
    ('payment_requests', 'scheduled_payment_date'),
    ('payment_requests', 'payment_reference'),
    ('payment_requests', 'payment_concept'),
    ('payment_requests', 'budget_decision'),
    ('payment_requests', 'concept'),
    ('payment_requests', 'description'),
    ('payment_requests', 'due_date'),
    ('payment_requests', 'scheduled_by'),
    ('payment_requests', 'scheduled_at'),
    ('payment_requests', 'created_at'),
    ('payment_requests', 'status'),
    ('proveedores', 'alias'),
    ('proveedores', 'nombre_completo'),
    ('proveedores', 'beneficiary_name'),
    ('proveedores', 'destination_type'),
    ('proveedores', 'clabe'),
    ('proveedores', 'cuenta_bancaria'),
    ('proveedores', 'convenio_number'),
    ('proveedores', 'activo'),
    ('company_bank_accounts', 'company_id'),
    ('company_bank_accounts', 'account_number'),
    ('company_bank_accounts', 'active')
), checked as (
  select
    r.table_name,
    r.column_name,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = r.table_name
        and c.column_name = r.column_name
    ) as present
  from required_columns r
)
select
  'required_columns' as check_name,
  case when bool_and(present) then 'PASS' else 'FAIL' end as check_status,
  coalesce(string_agg(table_name || '.' || column_name, ', ') filter (where not present), 'none') as missing
from checked;

with required_functions(signature) as (
  values
    ('public.verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean)'),
    ('public.approval_batch_require_actor()'),
    ('public.approval_batch_require_finance()'),
    ('public.approval_batch_request_open_elsewhere(uuid,uuid)'),
    ('public.approval_batch_request_has_current_direction_approval(uuid)'),
    ('public.approval_batch_request_has_any_execution_record(uuid)'),
    ('public.approval_batch_request_has_active_extraordinary(uuid)')
)
select
  'required_functions' as check_name,
  case when bool_and(to_regprocedure(signature) is not null) then 'PASS' else 'FAIL' end as check_status,
  coalesce(string_agg(signature, ', ') filter (where to_regprocedure(signature) is null), 'none') as missing
from required_functions;

select
  'single_pending_review' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as check_status,
  count(*) as conflicting_requests
from (
  select abi.payment_request_id
  from public.approval_batch_items abi
  where abi.removed_at is null
    and abi.director_status = 'pending'
  group by abi.payment_request_id
  having count(*) > 1
) conflicts;

select
  count(*) as approval_batches_before,
  (select count(*) from public.approval_batch_items) as approval_batch_items_before,
  (select count(*) from public.payment_requests) as payment_requests_before,
  (select count(*) from public.payment_layouts) as payment_layouts_before,
  (select count(*) from public.payment_layout_lines) as payment_layout_lines_before;

select
  company_id,
  regular_payments_require_closed_batch,
  enforcement_started_at,
  updated_at
from public.approval_batch_company_settings
order by company_id;

rollback;
