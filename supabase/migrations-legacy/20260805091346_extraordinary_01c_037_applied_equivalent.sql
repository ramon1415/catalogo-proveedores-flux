begin;

do $certify$
begin
  if to_regclass('public.extraordinary_payment_policies') is null
     or to_regclass('public.payment_request_extraordinary_events') is null
     or to_regprocedure('public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamp with time zone,text)') is null
     or to_regprocedure('public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)') is null
     or to_regprocedure('public.ratify_extraordinary_authorization(uuid,text,text)') is null
     or to_regprocedure('public.dispute_extraordinary_authorization(uuid,text,text)') is null
     or to_regprocedure('public.extraordinary_authorization_is_ready(uuid)') is null
     or to_regprocedure('public.get_payment_request_execution_context_pre_037(uuid)') is null
     or to_regprocedure('public.get_payment_request_execution_context(uuid)') is null then
    raise exception '037_applied_equivalent: required objects missing';
  end if;
  if (select count(*) from public.extraordinary_payment_policies) <> 0
     or (select count(*) from public.payment_request_extraordinary_authorizations) <> 0
     or (select count(*) from storage.objects where bucket_id='extraordinary-authorizations') <> 0 then
    raise exception '037_applied_equivalent: unexpected business data';
  end if;
  if not exists(select 1 from storage.buckets where id='extraordinary-authorizations' and public=false and file_size_limit=5242880) then
    raise exception '037_applied_equivalent: private bucket invalid';
  end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='approval_batch_items' and column_name in ('finance_release_status','finance_release_reason','finance_released_by','finance_released_at')) <> 4 then
    raise exception '037_applied_equivalent: release columns incomplete';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('aa_validate_secure_extraordinary_layout_line','zz_consume_secure_extraordinary_layout_line','guard_extraordinary_payment_receipt_insert','guard_extraordinary_layout_line_paid','guard_extraordinary_request_paid','invalidate_extraordinary_on_material_change','protect_extraordinary_authorization_state')) <> 7 then
    raise exception '037_applied_equivalent: trigger contract incomplete';
  end if;
  if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.extraordinary_authorization_is_ready(uuid)'::regprocedure) <> '62f3833d88afd3d526d651cd23559fa585ffedf0c83b2f4e41bf43cf624750a1'
     or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.extraordinary_validate_layout_line()'::regprocedure) <> '3c4ef401c18704e1cc6c0eaadb3fa794ab0f7a04092726af6c6dc30a461fa6fe'
     or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.extraordinary_consume_layout_line()'::regprocedure) <> '5bfbab08b6714ec0916360663761b70dd1eecc39f009283fd9e6b57345a395d9'
     or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.extraordinary_invalidate_material_change()'::regprocedure) <> 'b143ee4c78cc26393852158c0784fd4623bb7e15f485979fd47e28168dfcad70' then
    raise exception '037_applied_equivalent: function hash mismatch';
  end if;
  if not has_function_privilege('authenticated','public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)','EXECUTE')
     or has_function_privilege('anon','public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)','EXECUTE')
     or has_function_privilege('authenticated','public.authorize_payment_request_extraordinary(uuid,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_payment_request_execution_context(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.get_payment_request_execution_context_pre_037(uuid)','EXECUTE') then
    raise exception '037_applied_equivalent: grants mismatch';
  end if;
  if (select count(*) from public.notification_events) <> 0
     or (select count(*) from public.notification_delivery_attempts) <> 0 then
    raise exception '037_applied_equivalent: notification delta detected';
  end if;
end
$certify$;

commit;
