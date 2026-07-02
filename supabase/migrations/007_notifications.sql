-- Flux Operadora - Migracion 007
-- Notifications ledger DDL versionado desde Supabase DEV.
-- Fuente: Deploy Supabase DEV Manual #8, run 28571934235, artifact 8031309875.
-- Resultado fuente: NOTIFICATIONS_LEDGER_EXPORT_READY_FOR_007_SOURCE.
-- No copia datos operativos y no activa n8n ni envios reales por si misma.

create table if not exists public."notification_events" (
  "id" uuid not null default gen_random_uuid(),
  "event_type" text not null,
  "source_table" text,
  "source_id" uuid,
  "source_folio" text,
  "recipient_type" text not null,
  "recipient_profile_id" uuid,
  "recipient_email" text,
  "recipient_role" text,
  "channel" text not null default 'email'::text,
  "priority" text not null default 'normal'::text,
  "subject" text,
  "payload" jsonb not null default '{}'::jsonb,
  "idempotency_key" text not null,
  "status" text not null default 'pending'::text,
  "attempt_count" integer not null default 0,
  "max_attempts" integer not null default 5,
  "locked_at" timestamp with time zone,
  "locked_by" text,
  "processed_at" timestamp with time zone,
  "last_error" text,
  "last_attempt_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "notification_events_pkey" primary key ("id"),
  constraint "notification_events_idempotency_key_key" unique ("idempotency_key"),
  constraint "notification_events_recipient_profile_id_fkey" foreign key ("recipient_profile_id") references public."profiles"("id"),
  constraint "notification_events_attempt_count_check" check ("attempt_count" >= 0),
  constraint "notification_events_channel_check" check ("channel" = 'email'::text),
  constraint "notification_events_max_attempts_check" check ("max_attempts" > 0),
  constraint "notification_events_priority_check" check ("priority" = any (array['low'::text, 'normal'::text, 'high'::text, 'critical'::text])),
  constraint "notification_events_recipient_type_check" check ("recipient_type" = any (array['usuario_solicitante'::text, 'administrador_sistema'::text])),
  constraint "notification_events_status_check" check ("status" = any (array['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'dead_letter'::text, 'cancelled'::text]))
);

create table if not exists public."notification_delivery_attempts" (
  "id" uuid not null default gen_random_uuid(),
  "notification_event_id" uuid not null,
  "attempt_number" integer not null,
  "status" text not null,
  "provider_message_id" text,
  "error_message" text,
  "n8n_execution_id" text,
  "worker_id" text,
  "created_at" timestamp with time zone not null default now(),
  constraint "notification_delivery_attempts_pkey" primary key ("id"),
  constraint "notification_delivery_attempts_notification_event_id_fkey" foreign key ("notification_event_id") references public."notification_events"("id") on delete cascade,
  constraint "notification_delivery_attempts_attempt_number_check" check ("attempt_number" > 0),
  constraint "notification_delivery_attempts_status_check" check ("status" = any (array['processing'::text, 'sent'::text, 'failed'::text, 'dead_letter'::text]))
);

-- Constraints for environments where the tables already exist ad hoc.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_pkey') then
    alter table public."notification_events" add constraint "notification_events_pkey" primary key ("id");
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_idempotency_key_key') then
    alter table public."notification_events" add constraint "notification_events_idempotency_key_key" unique ("idempotency_key");
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_recipient_profile_id_fkey') then
    alter table public."notification_events" add constraint "notification_events_recipient_profile_id_fkey" foreign key ("recipient_profile_id") references public."profiles"("id");
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_attempt_count_check') then
    alter table public."notification_events" add constraint "notification_events_attempt_count_check" check ("attempt_count" >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_channel_check') then
    alter table public."notification_events" add constraint "notification_events_channel_check" check ("channel" = 'email'::text);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_max_attempts_check') then
    alter table public."notification_events" add constraint "notification_events_max_attempts_check" check ("max_attempts" > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_priority_check') then
    alter table public."notification_events" add constraint "notification_events_priority_check" check ("priority" = any (array['low'::text, 'normal'::text, 'high'::text, 'critical'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_recipient_type_check') then
    alter table public."notification_events" add constraint "notification_events_recipient_type_check" check ("recipient_type" = any (array['usuario_solicitante'::text, 'administrador_sistema'::text]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_events'::regclass and conname = 'notification_events_status_check') then
    alter table public."notification_events" add constraint "notification_events_status_check" check ("status" = any (array['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'dead_letter'::text, 'cancelled'::text]));
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_delivery_attempts'::regclass and conname = 'notification_delivery_attempts_pkey') then
    alter table public."notification_delivery_attempts" add constraint "notification_delivery_attempts_pkey" primary key ("id");
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_delivery_attempts'::regclass and conname = 'notification_delivery_attempts_notification_event_id_fkey') then
    alter table public."notification_delivery_attempts" add constraint "notification_delivery_attempts_notification_event_id_fkey" foreign key ("notification_event_id") references public."notification_events"("id") on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_delivery_attempts'::regclass and conname = 'notification_delivery_attempts_attempt_number_check') then
    alter table public."notification_delivery_attempts" add constraint "notification_delivery_attempts_attempt_number_check" check ("attempt_number" > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_delivery_attempts'::regclass and conname = 'notification_delivery_attempts_status_check') then
    alter table public."notification_delivery_attempts" add constraint "notification_delivery_attempts_status_check" check ("status" = any (array['processing'::text, 'sent'::text, 'failed'::text, 'dead_letter'::text]));
  end if;
end
$$;

create index if not exists "notification_events_created_at_idx" on public."notification_events" using btree ("created_at");
create index if not exists "notification_events_event_type_idx" on public."notification_events" using btree ("event_type");
create index if not exists "notification_events_recipient_profile_idx" on public."notification_events" using btree ("recipient_profile_id");
create index if not exists "notification_events_source_idx" on public."notification_events" using btree ("source_table", "source_id");
create index if not exists "notification_events_status_next_attempt_idx" on public."notification_events" using btree ("status", "next_attempt_at");
create index if not exists "notification_delivery_attempts_created_at_idx" on public."notification_delivery_attempts" using btree ("created_at");
create index if not exists "notification_delivery_attempts_event_idx" on public."notification_delivery_attempts" using btree ("notification_event_id");
CREATE OR REPLACE FUNCTION public.notification_current_profile_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
   select p.id
   from public.profiles p
   where p.auth_user_id = auth.uid()
      or (
        nullif(trim(coalesce(p.email, '')), '') is not null
        and lower(trim(p.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
   order by case when p.auth_user_id = auth.uid() then 0 else 1 end
   limit 1
 $function$;

CREATE OR REPLACE FUNCTION public.notification_current_user_has_role(p_roles text[])
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
   select exists (
     select 1
     from public.user_roles ur
     join public.roles r on r.id = ur.role_id
     where ur.profile_id = public.notification_current_profile_id()
       and lower(trim(r.name)) = any (
         select lower(trim(role_name))
         from unnest(p_roles) as role_name(role_name)
       )
   )
 $function$;

CREATE OR REPLACE FUNCTION public.set_updated_at_notification_events()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
 AS $function$
 begin
   new.updated_at = now();
   return new;
 end;
 $function$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_event_internal(p_event_type text, p_source_table text, p_source_id uuid, p_source_folio text, p_recipient_type text, p_recipient_profile_id uuid DEFAULT NULL::uuid, p_recipient_role text DEFAULT NULL::text, p_subject text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text, p_priority text DEFAULT 'normal'::text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 declare
   v_event_ids uuid[] := array[]::uuid[];
   v_inserted_id uuid;
   v_existing_id uuid;
   v_profile_id uuid;
   v_email text;
   v_status text;
   v_last_error text;
   v_missing_recipient boolean := false;
   v_missing_email boolean := false;
   v_deduplicated boolean := false;
   v_key text;
   v_admin record;
   v_admin_count integer := 0;
   v_priority text;
 begin
   v_priority := case lower(trim(coalesce(p_priority, 'normal')))
     when 'low' then 'low'
     when 'baja' then 'low'
     when 'normal' then 'normal'
     when 'media' then 'normal'
     when 'medium' then 'normal'
     when 'high' then 'high'
     when 'alta' then 'high'
     when 'critical' then 'critical'
     when 'critica' then 'critical'
     else 'normal'
   end;
 
   if nullif(trim(coalesce(p_event_type, '')), '') is null then
     raise exception 'event_type_required';
   end if;
 
   if p_event_type not in (
     'payment_request.created',
     'payment_request.approved',
     'payment_request.rejected',
     'payment_request.changes_requested',
     'payment_request.exception_approved',
     'payment_request.exception_rejected'
   ) then
     raise exception 'invalid_phase2_event_type';
   end if;
 
   if p_source_table <> 'payment_requests' then
     raise exception 'invalid_phase2_source_table';
   end if;
 
   if p_source_id is null then
     raise exception 'source_id_required';
   end if;
 
   if not exists (
     select 1
     from public.payment_requests pr
     where pr.id = p_source_id
   ) then
     raise exception 'source_payment_request_not_found';
   end if;
 
   if p_recipient_type not in ('usuario_solicitante', 'administrador_sistema') then
     raise exception 'invalid_recipient_type';
   end if;
 
   if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
     raise exception 'idempotency_key_required';
   end if;
 
   if exists (
     select 1
     from jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) as k(key_name)
     where lower(k.key_name) = any (array[
       ('bank' || '_account'),
       ('acc' || 'ount'),
       ('account' || '_number'),
       ('cue' || 'nta'),
       ('cla' || 'be'),
       ('raw' || '_payload'),
       ('tok' || 'en'),
       ('se' || 'cret'),
       ('pass' || 'word'),
       ('private' || '_key'),
       ('api' || '_key')
     ])
   ) then
     raise exception 'payload_contains_sensitive_key';
   end if;
 
   if p_recipient_type = 'usuario_solicitante' then
     if p_recipient_profile_id is null then
       v_status := 'dead_letter';
       v_last_error := 'missing_recipient_profile_id';
       v_missing_recipient := true;
     else
       select p.id, nullif(trim(coalesce(p.email, '')), '')
       into v_profile_id, v_email
       from public.profiles p
       where p.id = p_recipient_profile_id;
 
       if v_profile_id is null then
         v_status := 'dead_letter';
         v_last_error := 'recipient_profile_not_found';
         v_missing_recipient := true;
       elsif v_email is null then
         v_status := 'dead_letter';
         v_last_error := 'recipient_email_missing';
         v_missing_email := true;
       else
         v_status := 'pending';
       end if;
     end if;
 
     insert into public.notification_events (
       event_type,
       source_table,
       source_id,
       source_folio,
       recipient_type,
       recipient_profile_id,
       recipient_email,
       recipient_role,
       channel,
       priority,
       subject,
       payload,
       idempotency_key,
       status,
       last_error,
       next_attempt_at
     )
     values (
       p_event_type,
       p_source_table,
       p_source_id,
       p_source_folio,
       p_recipient_type,
       v_profile_id,
       v_email,
       p_recipient_role,
       'email',
       v_priority,
       p_subject,
       coalesce(p_payload, '{}'::jsonb),
       p_idempotency_key,
       v_status,
       v_last_error,
       case when v_status = 'pending' then now() else null end
     )
     on conflict (idempotency_key) do nothing
     returning id into v_inserted_id;
 
     if v_inserted_id is null then
       select id
       into v_existing_id
       from public.notification_events
       where idempotency_key = p_idempotency_key;
 
       v_event_ids := array_append(v_event_ids, v_existing_id);
       v_deduplicated := true;
     else
       v_event_ids := array_append(v_event_ids, v_inserted_id);
     end if;
 
     return jsonb_build_object(
       'event_ids', to_jsonb(v_event_ids),
       'status', v_status,
       'deduplicated', v_deduplicated,
       'missing_recipient', v_missing_recipient,
       'missing_email', v_missing_email
     );
   end if;
 
   for v_admin in
     select distinct
       p.id as profile_id,
       nullif(trim(coalesce(p.email, '')), '') as email
     from public.profiles p
     join public.user_roles ur on ur.profile_id = p.id
     join public.roles r on r.id = ur.role_id
     where lower(trim(r.name)) in ('admin', 'sysadmin')
       and nullif(trim(coalesce(p.email, '')), '') is not null
   loop
     v_admin_count := v_admin_count + 1;
     v_key := p_idempotency_key || ':admin:' || v_admin.profile_id::text;
 
     insert into public.notification_events (
       event_type,
       source_table,
       source_id,
       source_folio,
       recipient_type,
       recipient_profile_id,
       recipient_email,
       recipient_role,
       channel,
       priority,
       subject,
       payload,
       idempotency_key,
       status,
       next_attempt_at
     )
     values (
       p_event_type,
       p_source_table,
       p_source_id,
       p_source_folio,
       p_recipient_type,
       v_admin.profile_id,
       v_admin.email,
       coalesce(p_recipient_role, 'admin'),
       'email',
       v_priority,
       p_subject,
       coalesce(p_payload, '{}'::jsonb),
       v_key,
       'pending',
       now()
     )
     on conflict (idempotency_key) do nothing
     returning id into v_inserted_id;
 
     if v_inserted_id is null then
       select id
       into v_existing_id
       from public.notification_events
       where idempotency_key = v_key;
 
       v_event_ids := array_append(v_event_ids, v_existing_id);
       v_deduplicated := true;
     else
       v_event_ids := array_append(v_event_ids, v_inserted_id);
     end if;
   end loop;
 
   if v_admin_count = 0 then
     v_missing_recipient := true;
     v_key := p_idempotency_key || ':admin:none';
 
     insert into public.notification_events (
       event_type,
       source_table,
       source_id,
       source_folio,
       recipient_type,
       recipient_role,
       channel,
       priority,
       subject,
       payload,
       idempotency_key,
       status,
       last_error,
       next_attempt_at
     )
     values (
       p_event_type,
       p_source_table,
       p_source_id,
       p_source_folio,
       p_recipient_type,
       coalesce(p_recipient_role, 'admin'),
       'email',
       v_priority,
       p_subject,
       coalesce(p_payload, '{}'::jsonb),
       v_key,
       'dead_letter',
       'admin_recipient_missing',
       null
     )
     on conflict (idempotency_key) do nothing
     returning id into v_inserted_id;
 
     if v_inserted_id is null then
       select id
       into v_existing_id
       from public.notification_events
       where idempotency_key = v_key;
 
       v_event_ids := array_append(v_event_ids, v_existing_id);
       v_deduplicated := true;
     else
       v_event_ids := array_append(v_event_ids, v_inserted_id);
     end if;
   end if;
 
   return jsonb_build_object(
     'event_ids', to_jsonb(v_event_ids),
     'status', case when v_missing_recipient then 'dead_letter' else 'pending' end,
     'deduplicated', v_deduplicated,
     'missing_recipient', v_missing_recipient,
     'missing_email', false
   );
 end;
 $function$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_event(p_event_type text, p_source_table text, p_source_id uuid, p_source_folio text, p_recipient_type text, p_recipient_profile_id uuid DEFAULT NULL::uuid, p_recipient_role text DEFAULT NULL::text, p_subject text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text, p_priority text DEFAULT 'normal'::text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 declare
   v_event_ids uuid[] := array[]::uuid[];
   v_inserted_id uuid;
   v_existing_id uuid;
   v_profile_id uuid;
   v_email text;
   v_status text;
   v_last_error text;
   v_missing_recipient boolean := false;
   v_missing_email boolean := false;
   v_deduplicated boolean := false;
   v_key text;
   v_admin record;
   v_admin_count integer := 0;
 begin
   if not public.notification_current_user_has_role(array['admin', 'sysadmin']) then
     raise exception 'not_allowed_to_enqueue_notifications';
   end if;
 
   if nullif(trim(coalesce(p_event_type, '')), '') is null then
     raise exception 'event_type_required';
   end if;
 
   if p_recipient_type not in ('usuario_solicitante', 'administrador_sistema') then
     raise exception 'invalid_recipient_type';
   end if;
 
   if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
     raise exception 'idempotency_key_required';
   end if;
 
   if coalesce(p_payload, '{}'::jsonb) ?| array[
     'bank_account',
     'account',
     'account_number',
     'cuenta',
     'clabe',
     'raw_payload',
     'token',
     'secret',
     'password',
     'private_key'
   ] then
     raise exception 'payload_contains_sensitive_key';
   end if;
 
   if p_recipient_type = 'usuario_solicitante' then
     if p_recipient_profile_id is null then
       v_status := 'dead_letter';
       v_last_error := 'missing_recipient_profile_id';
       v_missing_recipient := true;
     else
       select p.id, nullif(trim(coalesce(p.email, '')), '')
       into v_profile_id, v_email
       from public.profiles p
       where p.id = p_recipient_profile_id;
 
       if v_profile_id is null then
         v_status := 'dead_letter';
         v_last_error := 'recipient_profile_not_found';
         v_missing_recipient := true;
       elsif v_email is null then
         v_status := 'dead_letter';
         v_last_error := 'recipient_email_missing';
         v_missing_email := true;
       else
         v_status := 'pending';
       end if;
     end if;
 
     insert into public.notification_events (
       event_type,
       source_table,
       source_id,
       source_folio,
       recipient_type,
       recipient_profile_id,
       recipient_email,
       recipient_role,
       channel,
       priority,
       subject,
       payload,
       idempotency_key,
       status,
       last_error,
       next_attempt_at
     )
     values (
       p_event_type,
       p_source_table,
       p_source_id,
       p_source_folio,
       p_recipient_type,
       v_profile_id,
       v_email,
       p_recipient_role,
       'email',
       coalesce(nullif(trim(p_priority), ''), 'normal'),
       p_subject,
       coalesce(p_payload, '{}'::jsonb),
       p_idempotency_key,
       v_status,
       v_last_error,
       case when v_status = 'pending' then now() else null end
     )
     on conflict (idempotency_key) do nothing
     returning id into v_inserted_id;
 
     if v_inserted_id is null then
       select id into v_existing_id
       from public.notification_events
       where idempotency_key = p_idempotency_key;
       v_event_ids := array_append(v_event_ids, v_existing_id);
       v_deduplicated := true;
     else
       v_event_ids := array_append(v_event_ids, v_inserted_id);
     end if;
 
     return jsonb_build_object(
       'event_ids', to_jsonb(v_event_ids),
       'status', v_status,
       'deduplicated', v_deduplicated,
       'missing_recipient', v_missing_recipient,
       'missing_email', v_missing_email
     );
   end if;
 
   for v_admin in
     select distinct
       p.id as profile_id,
       nullif(trim(coalesce(p.email, '')), '') as email
     from public.profiles p
     join public.user_roles ur on ur.profile_id = p.id
     join public.roles r on r.id = ur.role_id
     where lower(trim(r.name)) in ('admin', 'sysadmin')
       and nullif(trim(coalesce(p.email, '')), '') is not null
   loop
     v_admin_count := v_admin_count + 1;
     v_key := p_idempotency_key || ':admin:' || v_admin.profile_id::text;
 
     insert into public.notification_events (
       event_type,
       source_table,
       source_id,
       source_folio,
       recipient_type,
       recipient_profile_id,
       recipient_email,
       recipient_role,
       channel,
       priority,
       subject,
       payload,
       idempotency_key,
       status,
       next_attempt_at
     )
     values (
       p_event_type,
       p_source_table,
       p_source_id,
       p_source_folio,
       p_recipient_type,
       v_admin.profile_id,
       v_admin.email,
       coalesce(p_recipient_role, 'admin'),
       'email',
       coalesce(nullif(trim(p_priority), ''), 'normal'),
       p_subject,
       coalesce(p_payload, '{}'::jsonb),
       v_key,
       'pending',
       now()
     )
     on conflict (idempotency_key) do nothing
     returning id into v_inserted_id;
 
     if v_inserted_id is null then
       select id into v_existing_id
       from public.notification_events
       where idempotency_key = v_key;
       v_event_ids := array_append(v_event_ids, v_existing_id);
       v_deduplicated := true;
     else
       v_event_ids := array_append(v_event_ids, v_inserted_id);
     end if;
   end loop;
 
   if v_admin_count = 0 then
     v_missing_recipient := true;
     v_key := p_idempotency_key || ':admin:none';
 
     insert into public.notification_events (
       event_type,
       source_table,
       source_id,
       source_folio,
       recipient_type,
       recipient_role,
       channel,
       priority,
       subject,
       payload,
       idempotency_key,
       status,
       last_error,
       next_attempt_at
     )
     values (
       p_event_type,
       p_source_table,
       p_source_id,
       p_source_folio,
       p_recipient_type,
       coalesce(p_recipient_role, 'admin'),
       'email',
       coalesce(nullif(trim(p_priority), ''), 'normal'),
       p_subject,
       coalesce(p_payload, '{}'::jsonb),
       v_key,
       'dead_letter',
       'admin_recipient_missing',
       null
     )
     on conflict (idempotency_key) do nothing
     returning id into v_inserted_id;
 
     if v_inserted_id is null then
       select id into v_existing_id
       from public.notification_events
       where idempotency_key = v_key;
       v_event_ids := array_append(v_event_ids, v_existing_id);
       v_deduplicated := true;
     else
       v_event_ids := array_append(v_event_ids, v_inserted_id);
     end if;
   end if;
 
   return jsonb_build_object(
     'event_ids', to_jsonb(v_event_ids),
     'status', case when v_missing_recipient then 'dead_letter' else 'pending' end,
     'deduplicated', v_deduplicated,
     'missing_recipient', v_missing_recipient,
     'missing_email', false
   );
 end;
 $function$;

CREATE OR REPLACE FUNCTION public.claim_pending_notification_events(p_limit integer DEFAULT 25, p_worker_id text DEFAULT 'manual-dev'::text)
  RETURNS TABLE(id uuid, event_type text, source_table text, source_id uuid, source_folio text, recipient_type text, recipient_profile_id uuid, recipient_email text, channel text, priority text, subject text, payload jsonb, attempt_count integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 begin
   if not public.notification_current_user_has_role(array['admin', 'sysadmin']) then
     raise exception 'not_allowed_to_claim_notifications';
   end if;
 
   return query
   with candidate as (
     select e.id
     from public.notification_events e
     where e.status in ('pending', 'failed')
       and coalesce(e.next_attempt_at, now()) <= now()
       and e.attempt_count < e.max_attempts
       and nullif(trim(coalesce(e.recipient_email, '')), '') is not null
     order by
       case e.priority
         when 'critical' then 1
         when 'high' then 2
         when 'normal' then 3
         when 'low' then 4
         else 5
       end,
       e.created_at
     for update skip locked
     limit greatest(coalesce(p_limit, 25), 1)
   ),
   claimed as (
     update public.notification_events e
     set
       status = 'processing',
       locked_at = now(),
       locked_by = coalesce(nullif(trim(p_worker_id), ''), 'manual-dev'),
       last_attempt_at = now(),
       updated_at = now()
     from candidate c
     where e.id = c.id
     returning
       e.id,
       e.event_type,
       e.source_table,
       e.source_id,
       e.source_folio,
       e.recipient_type,
       e.recipient_profile_id,
       e.recipient_email,
       e.channel,
       e.priority,
       e.subject,
       e.payload,
       e.attempt_count
   )
   select
     claimed.id,
     claimed.event_type,
     claimed.source_table,
     claimed.source_id,
     claimed.source_folio,
     claimed.recipient_type,
     claimed.recipient_profile_id,
     claimed.recipient_email,
     claimed.channel,
     claimed.priority,
     claimed.subject,
     claimed.payload,
     claimed.attempt_count
   from claimed
   order by
     case claimed.priority
       when 'critical' then 1
       when 'high' then 2
       when 'normal' then 3
       when 'low' then 4
       else 5
     end,
     claimed.id;
 end;
 $function$;

CREATE OR REPLACE FUNCTION public.mark_notification_processed(p_event_id uuid, p_worker_id text DEFAULT NULL::text, p_provider_message_id text DEFAULT NULL::text, p_n8n_execution_id text DEFAULT NULL::text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 declare
   v_event public.notification_events%rowtype;
   v_attempt_number integer;
 begin
   if not public.notification_current_user_has_role(array['admin', 'sysadmin']) then
     raise exception 'not_allowed_to_mark_notifications';
   end if;
 
   select *
   into v_event
   from public.notification_events
   where id = p_event_id
   for update;
 
   if not found then
     raise exception 'notification_event_not_found';
   end if;
 
   if v_event.status <> 'processing' then
     raise exception 'notification_event_not_processable:%', v_event.status;
   end if;
 
   v_attempt_number := greatest(v_event.attempt_count + 1, 1);
 
   insert into public.notification_delivery_attempts (
     notification_event_id,
     attempt_number,
     status,
     provider_message_id,
     n8n_execution_id,
     worker_id
   )
   values (
     p_event_id,
     v_attempt_number,
     'sent',
     p_provider_message_id,
     p_n8n_execution_id,
     coalesce(p_worker_id, v_event.locked_by)
   );
 
   update public.notification_events
   set
     status = 'sent',
     processed_at = now(),
     last_attempt_at = now(),
     locked_at = null,
     locked_by = null,
     last_error = null,
     next_attempt_at = null
   where id = p_event_id;
 
   return jsonb_build_object(
     'event_id', p_event_id,
     'status', 'sent',
     'attempt_number', v_attempt_number
   );
 end;
 $function$;

CREATE OR REPLACE FUNCTION public.mark_notification_failed(p_event_id uuid, p_error_message text, p_worker_id text DEFAULT NULL::text, p_n8n_execution_id text DEFAULT NULL::text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 declare
   v_event public.notification_events%rowtype;
   v_attempt_number integer;
   v_new_status text;
   v_next_attempt_at timestamptz;
 begin
   if not public.notification_current_user_has_role(array['admin', 'sysadmin']) then
     raise exception 'not_allowed_to_mark_notifications';
   end if;
 
   select *
   into v_event
   from public.notification_events
   where id = p_event_id
   for update;
 
   if not found then
     raise exception 'notification_event_not_found';
   end if;
 
   if v_event.status <> 'processing' then
     raise exception 'notification_event_not_failable:%', v_event.status;
   end if;
 
   v_attempt_number := v_event.attempt_count + 1;
 
   if v_attempt_number >= v_event.max_attempts then
     v_new_status := 'dead_letter';
     v_next_attempt_at := null;
   else
     v_new_status := 'failed';
     v_next_attempt_at := now() + (interval '5 minutes' * greatest(v_attempt_number, 1));
   end if;
 
   insert into public.notification_delivery_attempts (
     notification_event_id,
     attempt_number,
     status,
     error_message,
     n8n_execution_id,
     worker_id
   )
   values (
     p_event_id,
     v_attempt_number,
     v_new_status,
     left(coalesce(p_error_message, 'notification_failed'), 1000),
     p_n8n_execution_id,
     coalesce(p_worker_id, v_event.locked_by)
   );
 
   update public.notification_events
   set
     status = v_new_status,
     attempt_count = v_attempt_number,
     last_error = left(coalesce(p_error_message, 'notification_failed'), 1000),
     last_attempt_at = now(),
     next_attempt_at = v_next_attempt_at,
     locked_at = null,
     locked_by = null
   where id = p_event_id;
 
   return jsonb_build_object(
     'event_id', p_event_id,
     'status', v_new_status,
     'attempt_number', v_attempt_number,
     'will_retry', v_new_status = 'failed'
   );
 end;
 $function$;

drop trigger if exists "set_updated_at_notification_events" on public."notification_events";
create trigger "set_updated_at_notification_events"
  before update on public."notification_events"
  for each row
  execute function public."set_updated_at_notification_events"();

alter table public."notification_events" enable row level security;
alter table public."notification_delivery_attempts" enable row level security;

drop policy if exists "notification_events_select_self_or_admin" on public."notification_events";
create policy "notification_events_select_self_or_admin"
  on public."notification_events"
  as permissive
  for select
  to authenticated
  using (
    ("recipient_profile_id" = public."notification_current_profile_id"())
    or public."notification_current_user_has_role"(array['admin'::text, 'sysadmin'::text])
  );

drop policy if exists "notification_delivery_attempts_select_self_or_admin" on public."notification_delivery_attempts";
create policy "notification_delivery_attempts_select_self_or_admin"
  on public."notification_delivery_attempts"
  as permissive
  for select
  to authenticated
  using (
    exists (
      select 1
      from public."notification_events" e
      where e."id" = "notification_delivery_attempts"."notification_event_id"
        and (
          e."recipient_profile_id" = public."notification_current_profile_id"()
          or public."notification_current_user_has_role"(array['admin'::text, 'sysadmin'::text])
        )
    )
  );

grant select on table public."notification_events" to authenticated;
grant select on table public."notification_delivery_attempts" to authenticated;

grant all privileges on table public."notification_events" to service_role;
grant all privileges on table public."notification_delivery_attempts" to service_role;
grant all privileges on table public."notification_events" to postgres with grant option;
grant all privileges on table public."notification_delivery_attempts" to postgres with grant option;

grant execute on function public."claim_pending_notification_events"(integer, text) to authenticated;
grant execute on function public."claim_pending_notification_events"(integer, text) to service_role;
grant execute on function public."claim_pending_notification_events"(integer, text) to postgres with grant option;

grant execute on function public."enqueue_notification_event"(text, text, uuid, text, text, uuid, text, text, jsonb, text, text) to authenticated;
grant execute on function public."enqueue_notification_event"(text, text, uuid, text, text, uuid, text, text, jsonb, text, text) to service_role;
grant execute on function public."enqueue_notification_event"(text, text, uuid, text, text, uuid, text, text, jsonb, text, text) to postgres with grant option;

grant execute on function public."enqueue_notification_event_internal"(text, text, uuid, text, text, uuid, text, text, jsonb, text, text) to service_role;
grant execute on function public."enqueue_notification_event_internal"(text, text, uuid, text, text, uuid, text, text, jsonb, text, text) to postgres with grant option;

grant execute on function public."mark_notification_failed"(uuid, text, text, text) to authenticated;
grant execute on function public."mark_notification_failed"(uuid, text, text, text) to service_role;
grant execute on function public."mark_notification_failed"(uuid, text, text, text) to postgres with grant option;

grant execute on function public."mark_notification_processed"(uuid, text, text, text) to authenticated;
grant execute on function public."mark_notification_processed"(uuid, text, text, text) to service_role;
grant execute on function public."mark_notification_processed"(uuid, text, text, text) to postgres with grant option;

grant execute on function public."notification_current_profile_id"() to authenticated;
grant execute on function public."notification_current_profile_id"() to service_role;
grant execute on function public."notification_current_profile_id"() to postgres with grant option;

grant execute on function public."notification_current_user_has_role"(text[]) to authenticated;
grant execute on function public."notification_current_user_has_role"(text[]) to service_role;
grant execute on function public."notification_current_user_has_role"(text[]) to postgres with grant option;

grant execute on function public."set_updated_at_notification_events"() to public;
grant execute on function public."set_updated_at_notification_events"() to anon;
grant execute on function public."set_updated_at_notification_events"() to authenticated;
grant execute on function public."set_updated_at_notification_events"() to service_role;
grant execute on function public."set_updated_at_notification_events"() to postgres with grant option;
