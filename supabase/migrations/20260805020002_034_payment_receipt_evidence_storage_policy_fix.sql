begin;

do $precheck$
begin
  if to_regclass('public.payment_operation_evidence') is null then
    raise exception '034_precheck: payment_operation_evidence is missing';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'payment_receipt_evidence_finance_select'
  ) or not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'payment_receipt_evidence_finance_insert'
  ) then
    raise exception '034_precheck: expected 033 storage policies are missing';
  end if;
end
$precheck$;

create or replace function public.payment_receipt_evidence_storage_path_allowed(
  p_storage_path text,
  p_for_upload boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_operation_evidence evidence
    where evidence.storage_bucket = 'payment-batch-documents'
      and evidence.storage_path = p_storage_path
      and public.current_profile_id() is not null
      and public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.has_active_company_membership(
          public.current_profile_id(),
          evidence.company_id
        )
      )
      and (
        not p_for_upload
        or (
          evidence.status = 'pending_upload'
          and evidence.created_by = public.current_profile_id()
        )
      )
  );
$$;

revoke all on function public.payment_receipt_evidence_storage_path_allowed(text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.payment_receipt_evidence_storage_path_allowed(text,boolean)
  to authenticated, service_role;

drop policy payment_receipt_evidence_finance_select on storage.objects;
create policy payment_receipt_evidence_finance_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-batch-documents'
  and public.payment_receipt_evidence_storage_path_allowed(name, false)
);

drop policy payment_receipt_evidence_finance_insert on storage.objects;
create policy payment_receipt_evidence_finance_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-batch-documents'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
  and metadata ->> 'mimetype' = 'application/pdf'
  and public.payment_receipt_evidence_storage_path_allowed(name, true)
);

do $postcheck$
declare
  v_select_qual text;
  v_insert_check text;
begin
  select qual into v_select_qual
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'payment_receipt_evidence_finance_select';

  select with_check into v_insert_check
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'payment_receipt_evidence_finance_insert';

  if v_select_qual not like '%payment_receipt_evidence_storage_path_allowed%'
     or v_insert_check not like '%payment_receipt_evidence_storage_path_allowed%' then
    raise exception '034_postcheck: storage policies do not use the guarded helper';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.payment_operation_evidence',
    'SELECT'
  ) then
    raise exception '034_postcheck: authenticated received forbidden table SELECT';
  end if;
end
$postcheck$;

comment on function public.payment_receipt_evidence_storage_path_allowed(text,boolean) is
  'RLS-safe evidence path authorization for private Storage policies. Keeps payment_operation_evidence unavailable for direct authenticated SELECT.';

commit;
