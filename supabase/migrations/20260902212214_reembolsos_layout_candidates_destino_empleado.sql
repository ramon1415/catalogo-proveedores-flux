-- El wrapper conserva intacta la función base pre_037 y sustituye el destino
-- por la cuenta bancaria del empleado cuando la solicitud es un reembolso.
create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null::uuid,
  p_company_bank_account_id uuid default null::uuid
)
 returns table(classification text, classification_reason text, payment_request_id uuid, request_number text, request_status text, company_id uuid, company_name text, proveedor_id uuid, provider_name text, company_bank_account_id uuid, source_account_number text, destination_type text, destination_value text, beneficiary_name text, amount numeric, currency text, payment_reference text, payment_concept text, scheduled_payment_date date, missing_fields text[], finance_approval_current boolean, direction_approval_current boolean, direction_decided_at timestamp with time zone, enforcement_required boolean, source_item_id uuid, source_batch_id uuid, source_batch_label text, source_batch_status text, director_status text, reject_reason text, rejected_by uuid, rejected_by_name text, rejected_at timestamp with time zone, rebatch_status text, latest_correction_note text, extraordinary_authorization_id uuid, extraordinary_category text, extraordinary_reason text, extraordinary_authorized_by uuid, extraordinary_authorized_by_name text, extraordinary_authorized_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'invalid_data'
      else candidate.classification
    end,
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'extraordinary_not_ready_secure_contract'
      else candidate.classification_reason
    end,
    candidate.payment_request_id,
    candidate.request_number,
    candidate.request_status,
    candidate.company_id,
    candidate.company_name,
    candidate.proveedor_id,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.provider_name)
      else candidate.provider_name
    end,
    candidate.company_bank_account_id,
    candidate.source_account_number,
    case
      when reimb.beneficiary_profile_id is not null then
        case
          when regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g') <> '' then 'clabe'
          when regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g') <> '' then 'cuenta'
          else candidate.destination_type
        end
      else candidate.destination_type
    end,
    case
      when reimb.beneficiary_profile_id is not null then
        coalesce(
          nullif(regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g'), ''),
          nullif(regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g'), ''),
          candidate.destination_value
        )
      else candidate.destination_value
    end,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.beneficiary_name)
      else candidate.beneficiary_name
    end,
    candidate.amount,
    candidate.currency,
    candidate.payment_reference,
    candidate.payment_concept,
    candidate.scheduled_payment_date,
    candidate.missing_fields,
    candidate.finance_approval_current,
    candidate.direction_approval_current,
    candidate.direction_decided_at,
    candidate.enforcement_required,
    candidate.source_item_id,
    candidate.source_batch_id,
    candidate.source_batch_label,
    candidate.source_batch_status,
    candidate.director_status,
    candidate.reject_reason,
    candidate.rejected_by,
    candidate.rejected_by_name,
    candidate.rejected_at,
    candidate.rebatch_status,
    candidate.latest_correction_note,
    candidate.extraordinary_authorization_id,
    candidate.extraordinary_category,
    candidate.extraordinary_reason,
    candidate.extraordinary_authorized_by,
    candidate.extraordinary_authorized_by_name,
    candidate.extraordinary_authorized_at
  from public.approval_batch_payment_layout_candidates_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) candidate
  left join public.payment_requests reimb
    on reimb.id = candidate.payment_request_id
   and reimb.request_type::text = 'reimbursement'
  left join public.employee_bank_accounts beneficiary_bank
    on beneficiary_bank.profile_id = reimb.beneficiary_profile_id
  left join public.profiles beneficiary_profile
    on beneficiary_profile.id = reimb.beneficiary_profile_id
  where not exists (
    select 1
    from public.payment_requests request
    where request.id = candidate.payment_request_id
      and request.request_type::text = 'nomina'
  );
$function$;
