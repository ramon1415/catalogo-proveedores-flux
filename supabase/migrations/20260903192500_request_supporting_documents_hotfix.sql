begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
begin
  if to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.reimbursement_items') is null
     or to_regprocedure('public.current_profile_id()') is null
     or not exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'create_payment_request'
     ) then
    raise exception 'request_supporting_documents_prerequisites_missing';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'payment-receipts'
  ) then
    raise exception 'payment_receipts_bucket_missing';
  end if;
end
$precheck$;

-- La UI permite XML además de imágenes/PDF; el bucket debe aceptar exactamente
-- los mismos tipos y conservar el límite de 10 MB.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'text/xml',
      'application/xml'
    ]::text[]
where id = 'payment-receipts';

create index if not exists payment_requests_invoice_storage_path_idx
  on public.payment_requests (invoice_storage_path)
  where invoice_storage_path is not null;

create index if not exists reimbursement_items_storage_path_idx
  on public.reimbursement_items (storage_path)
  where storage_path is not null;

-- Los documentos de solicitudes se guardan en payment-receipts/solicitudes.
-- Para altas nuevas se suben primero a una ruta temporal propiedad del perfil;
-- para edición y reembolsos se admite la ruta del request existente.
drop policy if exists "Authenticated can upload request supporting documents" on storage.objects;
create policy "Authenticated can upload request supporting documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-receipts'
  and (
    (
      name ~* '^solicitudes/drafts/[0-9a-f-]{36}/[^/]+\.(jpg|jpeg|png|webp|pdf|xml)$'
      and split_part(name, '/', 3) = public.current_profile_id()::text
    )
    or
    (
      name ~* '^solicitudes/[0-9a-f-]{36}/.+\.(jpg|jpeg|png|webp|pdf|xml)$'
      and exists (
        select 1
        from public.payment_requests request
        where request.id::text = split_part(storage.objects.name, '/', 2)
          and (
            request.requested_by = public.current_profile_id()
            or private.current_profile_has_company_role(
              request.company_id,
              array['finance'::text, 'sysadmin'::text]
            )
          )
      )
    )
  )
);

drop policy if exists "Authenticated can read request supporting documents" on storage.objects;
create policy "Authenticated can read request supporting documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-receipts'
  and name like 'solicitudes/%'
  and (
    (
      name ~* '^solicitudes/drafts/[0-9a-f-]{36}/'
      and split_part(name, '/', 3) = public.current_profile_id()::text
    )
    or exists (
      select 1
      from public.payment_requests request
      where request.invoice_storage_path = storage.objects.name
    )
    or exists (
      select 1
      from public.reimbursement_items item
      where item.storage_path = storage.objects.name
    )
  )
);

drop policy if exists "Authenticated can delete own staged request documents" on storage.objects;
create policy "Authenticated can delete own staged request documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-receipts'
  and name ~* '^solicitudes/drafts/[0-9a-f-]{36}/'
  and split_part(name, '/', 3) = public.current_profile_id()::text
);

-- Crea la solicitud y enlaza el documento dentro de una sola transacción de BD.
-- El archivo ya debe existir y pertenecer a la sesión que llama; si el enlace
-- falla, también se revierte la solicitud y su evento de notificación.
create or replace function public.create_payment_request_with_document(
  p_proveedor_id uuid,
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount_requested numeric,
  p_currency text default 'MXN'::text,
  p_exchange_rate numeric default 1,
  p_description text default null::text,
  p_notes text default null::text,
  p_requested_by uuid default null::uuid,
  p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null::uuid,
  p_approver_assignment_id uuid default null::uuid,
  p_subtotal_amount numeric default null::numeric,
  p_tax_amount numeric default null::numeric,
  p_withholding_amount numeric default null::numeric,
  p_invoice_uuid text default null::text,
  p_beneficiary_profile_id uuid default null::uuid,
  p_request_type text default null::text,
  p_invoice_storage_path text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $function$
declare
  v_profile_id uuid := public.current_profile_id();
  v_result jsonb;
  v_request_id uuid;
  v_storage_path text := nullif(btrim(p_invoice_storage_path), '');
begin
  if v_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  if lower(coalesce(nullif(btrim(p_request_type), ''), 'provider_payment')) = 'reimbursement' then
    raise exception 'request_document_wrapper_not_for_reimbursement';
  end if;

  if v_storage_path is null then
    raise exception 'request_document_required';
  end if;

  if v_storage_path !~* '^solicitudes/drafts/[0-9a-f-]{36}/[^/]+\.(jpg|jpeg|png|webp|pdf|xml)$'
     or split_part(v_storage_path, '/', 3) <> v_profile_id::text then
    raise exception 'request_document_path_invalid';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'payment-receipts'
      and object.name = v_storage_path
      and object.owner = auth.uid()
  ) then
    raise exception 'request_document_not_found_or_not_owned';
  end if;

  v_result := public.create_payment_request(
    p_proveedor_id => p_proveedor_id,
    p_company_id => p_company_id,
    p_cost_center_id => p_cost_center_id,
    p_budget_category_id => p_budget_category_id,
    p_budget_month => p_budget_month,
    p_amount_requested => p_amount_requested,
    p_currency => p_currency,
    p_exchange_rate => p_exchange_rate,
    p_description => p_description,
    p_notes => p_notes,
    p_requested_by => p_requested_by,
    p_is_extraordinary_adjustment => p_is_extraordinary_adjustment,
    p_approver_id => p_approver_id,
    p_approver_assignment_id => p_approver_assignment_id,
    p_subtotal_amount => p_subtotal_amount,
    p_tax_amount => p_tax_amount,
    p_withholding_amount => p_withholding_amount,
    p_invoice_uuid => p_invoice_uuid,
    p_beneficiary_profile_id => p_beneficiary_profile_id,
    p_request_type => p_request_type
  );

  v_request_id := coalesce(
    nullif(v_result ->> 'payment_request_id', '')::uuid,
    nullif(v_result ->> 'id', '')::uuid
  );

  if v_request_id is null then
    raise exception 'request_document_payment_request_id_missing';
  end if;

  update public.payment_requests
     set invoice_storage_path = v_storage_path,
         updated_at = now()
   where id = v_request_id
     and requested_by = v_profile_id;

  if not found then
    raise exception 'request_document_link_failed';
  end if;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('invoice_storage_path', v_storage_path);
end;
$function$;

alter function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text
) owner to postgres;

revoke all on function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text
) from public, anon;

grant execute on function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text
) to authenticated, service_role;

comment on function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text
) is 'Crea una solicitud no-reembolso y enlaza su documento obligatorio de forma transaccional.';

do $postcheck$
declare
  v_mime_types text[];
  v_definition text;
begin
  select allowed_mime_types
    into v_mime_types
  from storage.buckets
  where id = 'payment-receipts';

  if not array['image/jpeg','image/png','image/webp','application/pdf','text/xml','application/xml']::text[] <@ v_mime_types then
    raise exception 'payment_receipts_bucket_mime_contract_invalid';
  end if;

  if not exists (
       select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'Authenticated can upload request supporting documents'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'Authenticated can read request supporting documents'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'Authenticated can delete own staged request documents'
     ) then
    raise exception 'request_supporting_documents_storage_policies_missing';
  end if;

  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_payment_request_with_document'
  limit 1;

  if v_definition is null
     or v_definition not like '%request_document_not_found_or_not_owned%'
     or v_definition not like '%public.create_payment_request(%'
     or v_definition not like '%invoice_storage_path = v_storage_path%' then
    raise exception 'request_document_wrapper_contract_invalid';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text)',
       'execute'
     ) then
    raise exception 'request_document_wrapper_acl_invalid';
  end if;
end
$postcheck$;

notify pgrst, 'reload schema';

commit;
