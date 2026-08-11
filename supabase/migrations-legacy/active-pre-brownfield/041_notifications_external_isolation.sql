-- Flux Operadora - Migration 041
-- N1-A candidate: same-ledger isolation for future external provider notifications.
-- Reconciled against dev 2deae2cddf8ebb22fffd76e7a648483e2b3cc609 after Migration 031.
-- DRAFT ONLY. Hardened by NOTIFICATIONS-N1-A-R1; still unapplied and creates no external events.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_conflicts text[] := array[]::text[];
  v_existing_columns text[] := array[]::text[];
begin
  if to_regclass('public.notification_events') is null then
    v_missing := array_append(v_missing, 'public.notification_events');
  end if;
  if to_regclass('public.notification_delivery_attempts') is null then
    v_missing := array_append(v_missing, 'public.notification_delivery_attempts');
  end if;
  if to_regclass('public.payment_intake') is null then
    v_missing := array_append(v_missing, 'public.payment_intake');
  end if;
  if to_regclass('public.payment_intake_events') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_events');
  end if;
  if to_regprocedure('public.claim_notification_events_for_dispatcher(integer,text)') is null then
    v_missing := array_append(v_missing, 'public.claim_notification_events_for_dispatcher(integer,text)');
  end if;
  if to_regprocedure('public.claim_pending_notification_events(integer,text)') is null then
    v_missing := array_append(v_missing, 'public.claim_pending_notification_events(integer,text)');
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    v_missing := array_append(v_missing, 'public.set_updated_at()');
  end if;
  if to_regprocedure('public.protect_payment_intake_events_immutable()') is null then
    v_missing := array_append(v_missing, 'public.protect_payment_intake_events_immutable()');
  end if;
  if to_regprocedure('public.normalize_provider_match_text(text)') is null then
    v_missing := array_append(v_missing, 'public.normalize_provider_match_text(text)');
  end if;
  if to_regprocedure('public.normalize_provider_match_digits(text)') is null then
    v_missing := array_append(v_missing, 'public.normalize_provider_match_digits(text)');
  end if;
  if to_regprocedure(
    'public.provider_intake_match_fingerprint(integer,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text)'
  ) is null then
    v_missing := array_append(v_missing, 'public.provider_intake_match_fingerprint signature');
  end if;
  if to_regprocedure('public.find_provider_intake_candidates(uuid,text,integer)') is null then
    v_missing := array_append(v_missing, 'public.find_provider_intake_candidates signature');
  end if;
  if to_regprocedure('public.get_provider_intake_match_comparison(uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'public.get_provider_intake_match_comparison signature');
  end if;
  if to_regprocedure(
    'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'
  ) is null then
    v_missing := array_append(v_missing, 'public.set_provider_intake_match signature');
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    v_missing := array_append(v_missing, 'extensions.digest(bytea,text)');
  end if;
  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']::text[]) role_name
    where not exists (select 1 from pg_roles where rolname = role_name)
  ) then
    v_missing := array_append(v_missing, 'Supabase database roles');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '041_precheck: missing required objects: %', array_to_string(v_missing, ', ');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'matched_proveedor_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'created_payment_request_id'
  ) then
    raise exception '041_precheck: Matching 031 payment_intake columns are missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(oid) like '%provider_matched%'
      and pg_get_constraintdef(oid) like '%internal_note%'
      and pg_get_constraintdef(oid) like '%correction_requested%'
      and pg_get_constraintdef(oid) like '%rejected%'
  ) then
    raise exception '041_precheck: Matching 031 intake event contract is unavailable';
  end if;

  if position(
       'provider_matched'
       in pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       )
     ) = 0
     or position(
       '''contract_version'', 3'
       in pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       )
     ) = 0
     or position(
       'created_payment_request_id is not null'
       in lower(pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       ))
     ) = 0 then
    raise exception '041_precheck: Matching 031 set contract differs';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'find_provider_intake_candidates',
        'get_provider_intake_match_comparison',
        'set_provider_intake_match'
      )
      and (
        not p.prosecdef
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '041_precheck: Matching 031 public RPC grants differ';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_provider_match_text',
        'normalize_provider_match_digits',
        'provider_intake_match_fingerprint'
      )
      and (
        p.prosecdef
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '041_precheck: Matching 031 helper grants differ';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('notification_events', 'notification_delivery_attempts')
      and p.permissive = 'PERMISSIVE'
      and p.cmd in ('SELECT', 'ALL')
      and (
        'public'::name = any (p.roles)
        or exists (
          select 1
          from unnest(p.roles) policy_role
          where policy_role <> 'public'::name
            and pg_has_role('anon', policy_role::text, 'MEMBER')
        )
      )
  ) then
    raise exception '041_precheck: anon/public notification SELECT policy exists';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('notification_events', 'notification_delivery_attempts')
      and p.permissive = 'PERMISSIVE'
      and p.cmd in ('SELECT', 'ALL')
      and (
        'public'::name = any (p.roles)
        or exists (
          select 1
          from unnest(p.roles) policy_role
          where policy_role <> 'public'::name
            and pg_has_role('authenticated', policy_role::text, 'MEMBER')
        )
      )
      and (
        (p.tablename = 'notification_events'
         and p.policyname <> 'notification_events_select_self_or_admin')
        or
        (p.tablename = 'notification_delivery_attempts'
         and p.policyname <> 'notification_delivery_attempts_select_self_or_admin')
      )
  ) then
    raise exception '041_precheck: additional authenticated permissive notification policy exists';
  end if;

  if to_regclass('public.notification_external_rollouts') is not null then
    v_conflicts := array_append(v_conflicts, 'public.notification_external_rollouts');
  end if;

  select coalesce(array_agg(c.table_name || '.' || c.column_name order by c.table_name, c.column_name), array[]::text[])
    into v_existing_columns
  from information_schema.columns c
  where c.table_schema = 'public'
    and (
      (c.table_name = 'notification_events' and c.column_name in (
        'audience', 'event_version', 'rollout_id', 'external_subject_type',
        'external_subject_id', 'terminal_reason'
      ))
      or (c.table_name = 'notification_delivery_attempts' and c.column_name in (
        'provider_idempotency_key', 'safe_error_code',
        'provider_request_started_at', 'provider_request_completed_at'
      ))
      or (c.table_name = 'payment_intake' and c.column_name in (
        'expected_file_count', 'submission_completed_at'
      ))
      or (c.table_name = 'payment_intake_events' and c.column_name in (
        'external_message', 'external_field_codes', 'external_contract_version'
      ))
    );

  v_conflicts := v_conflicts || v_existing_columns;

  if cardinality(v_conflicts) > 0 then
    raise exception '041_precheck: incompatible candidate objects already exist: %',
      array_to_string(v_conflicts, ', ');
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'notification_external_event_type_allowed',
        'notification_external_event_mode_allowed',
        'notification_external_field_codes_valid',
        'notification_external_rollout_event_types_valid',
        'notification_external_hashes_valid',
        'notification_external_message_valid',
        'notification_external_json_keys_match',
        'notification_external_payload_valid',
        'notification_external_idempotency_valid',
        'protect_payment_intake_submission_completed',
        'protect_external_notification_contract',
        'protect_notification_delivery_attempt_contract',
        'claim_external_notification_events_for_dispatcher',
        'recover_stale_external_notification_events'
      )
  ) then
    raise exception '041_precheck: one or more N1-A functions already exist';
  end if;

  if exists (
    select 1
    from (
      select notification_event_id, attempt_number
      from public.notification_delivery_attempts
      group by notification_event_id, attempt_number
      having count(*) > 1
    ) duplicate_attempt
  ) then
    raise exception '041_precheck: duplicate delivery attempt numbers exist';
  end if;

  if exists (
    select 1
    from public.notification_events
    where event_type in (
      'provider_intake.received',
      'provider_intake.correction_requested',
      'provider_intake.rejected'
    )
  ) then
    raise exception '041_precheck: external provider event names already exist; classification is ambiguous';
  end if;
end
$$;

create function public.notification_external_event_type_allowed(p_event_type text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select p_event_type = any (array[
    'provider_intake.received',
    'provider_intake.correction_requested',
    'provider_intake.rejected'
  ]::text[])
$$;

create function public.notification_external_event_mode_allowed(
  p_event_type text,
  p_mode text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    public.notification_external_event_type_allowed(p_event_type)
    and p_mode in ('test_only', 'pilot')
    and (
      p_event_type <> 'provider_intake.correction_requested'
      or p_mode = 'test_only'
    )
$$;

create function public.notification_external_field_codes_valid(p_field_codes text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    p_field_codes is not null
    and cardinality(p_field_codes) between 1 and 16
    and array_position(p_field_codes, null) is null
    and not exists (
      select 1
      from unnest(p_field_codes) code
      where code <> all (array[
        'provider_name',
        'provider_rfc',
        'provider_email',
        'provider_phone',
        'concept',
        'description',
        'amount_requested',
        'currency',
        'requested_payment_date',
        'invoice_folio',
        'invoice_uuid',
        'invoice_date',
        'invoice_pdf',
        'invoice_xml',
        'bank_document',
        'beneficiary_name'
      ]::text[])
    )
    and cardinality(p_field_codes) = (
      select count(distinct code)::integer
      from unnest(p_field_codes) code
    )
$$;

create function public.notification_external_message_valid(p_message text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    p_message is not null
    and p_message = btrim(p_message)
    and char_length(p_message) between 10 and 1000
    and p_message !~ '[[:cntrl:]]'
    and p_message !~ '<[^>]*>'
    and p_message !~* '(https?://|www\.|mailto:)'
    and p_message !~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    and p_message !~* '(^|[^[:alpha:]])(aprobador|aprobadores|presupuesto|cuenta|cuentas|clabe|regla[[:space:]]+interna|tercero|terceros|matching|match[_ -]?score|match[_ -]?confidence|reason[_ -]?code|previous[_ -]?proveedor[_ -]?id|new[_ -]?proveedor[_ -]?id)([^[:alpha:]]|$)'
    and regexp_replace(p_message, '[-[:space:]]', '', 'g') !~ '[0-9]{10,}'
    and p_message !~* '(^|[^[:alnum:]&Ñ])([A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3})([^[:alnum:]]|$)'
$$;

create function public.notification_external_json_keys_match(
  p_payload jsonb,
  p_allowed_keys text[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    jsonb_typeof(p_payload) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(p_payload) payload_key
      where payload_key <> all (p_allowed_keys)
    )
    and (
      select count(*)::integer
      from jsonb_object_keys(p_payload)
    ) = cardinality(p_allowed_keys)
$$;

create function public.notification_external_payload_valid(
  p_event_type text,
  p_event_version smallint,
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
declare
  v_common_keys constant text[] := array[
    'event_version',
    'template_version',
    'locale',
    'public_folio',
    'occurred_on'
  ]::text[];
  v_allowed_keys text[];
  v_field_codes text[];
begin
  if not public.notification_external_event_type_allowed(p_event_type)
     or p_event_version is distinct from 1
     or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  v_allowed_keys := case p_event_type
    when 'provider_intake.received' then v_common_keys
    when 'provider_intake.correction_requested' then
      v_common_keys || array['external_message', 'field_codes']::text[]
    when 'provider_intake.rejected' then
      v_common_keys || array['external_message']::text[]
    else array[]::text[]
  end;

  if not public.notification_external_json_keys_match(p_payload, v_allowed_keys) then
    return false;
  end if;

  if jsonb_typeof(p_payload -> 'event_version') <> 'number'
     or (p_payload ->> 'event_version') !~ '^[0-9]+$'
     or (p_payload ->> 'event_version')::integer <> p_event_version
     or jsonb_typeof(p_payload -> 'template_version') <> 'number'
     or (p_payload ->> 'template_version') !~ '^[0-9]+$'
     or (p_payload ->> 'template_version')::integer <> 1
     or jsonb_typeof(p_payload -> 'locale') <> 'string'
     or p_payload ->> 'locale' <> 'es-MX'
     or jsonb_typeof(p_payload -> 'public_folio') <> 'string'
     or (p_payload ->> 'public_folio') !~ '^INT-[0-9]{4}-[0-9]{6}$'
     or jsonb_typeof(p_payload -> 'occurred_on') <> 'string'
     or (p_payload ->> 'occurred_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;

  if ((p_payload ->> 'occurred_on')::date)::text <> p_payload ->> 'occurred_on' then
    return false;
  end if;

  if p_event_type = 'provider_intake.received' then
    return true;
  end if;

  if jsonb_typeof(p_payload -> 'external_message') <> 'string'
     or not public.notification_external_message_valid(p_payload ->> 'external_message') then
    return false;
  end if;

  if p_event_type = 'provider_intake.rejected' then
    return true;
  end if;

  if jsonb_typeof(p_payload -> 'field_codes') <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(p_payload -> 'field_codes') item
       where jsonb_typeof(item) <> 'string'
     ) then
    return false;
  end if;

  select array_agg(value order by value)
    into v_field_codes
  from jsonb_array_elements_text(p_payload -> 'field_codes') value;

  return public.notification_external_field_codes_valid(v_field_codes);
exception
  when others then
    return false;
end
$$;

create function public.notification_external_idempotency_valid(
  p_event_type text,
  p_payment_intake_id uuid,
  p_event_version smallint,
  p_idempotency_key text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    public.notification_external_event_type_allowed(p_event_type)
    and p_payment_intake_id is not null
    and p_event_version = 1
    and p_idempotency_key = format(
      'external:%s:%s:v%s',
      p_event_type,
      p_payment_intake_id,
      p_event_version
    )
$$;

create function public.notification_external_rollout_event_types_valid(p_event_types text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    p_event_types is not null
    and array_position(p_event_types, null) is null
    and p_event_types <@ array[
      'provider_intake.received',
      'provider_intake.correction_requested',
      'provider_intake.rejected'
    ]::text[]
    and cardinality(p_event_types) = (
      select count(distinct event_type)::integer
      from unnest(p_event_types) event_type
    )
$$;

create function public.notification_external_hashes_valid(p_hashes text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select
    p_hashes is not null
    and array_position(p_hashes, null) is null
    and not exists (
      select 1
      from unnest(p_hashes) recipient_hash
      where recipient_hash !~ '^[0-9a-f]{64}$'
    )
    and cardinality(p_hashes) = (
      select count(distinct recipient_hash)::integer
      from unnest(p_hashes) recipient_hash
    )
$$;

create table public.notification_external_rollouts (
  id text primary key,
  mode text not null default 'disabled',
  cutoff_at timestamptz,
  enabled_event_types text[] not null default array[]::text[],
  recipient_allowlist_hashes text[] not null default array[]::text[],
  batch_size smallint not null default 1,
  daily_cap integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_external_rollouts_id_check check (
    id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
  ),
  constraint notification_external_rollouts_mode_check check (
    mode in ('disabled', 'test_only', 'pilot', 'paused')
  ),
  constraint notification_external_rollouts_event_types_check check (
    public.notification_external_rollout_event_types_valid(enabled_event_types)
  ),
  constraint notification_external_rollouts_correction_pilot_check check (
    mode <> 'pilot'
    or not ('provider_intake.correction_requested' = any (enabled_event_types))
  ),
  constraint notification_external_rollouts_allowlist_check check (
    public.notification_external_hashes_valid(recipient_allowlist_hashes)
  ),
  constraint notification_external_rollouts_batch_check check (batch_size = 1),
  constraint notification_external_rollouts_daily_cap_check check (daily_cap >= 0),
  constraint notification_external_rollouts_activation_check check (
    mode in ('disabled', 'paused')
    or (
      mode in ('test_only', 'pilot')
      and cutoff_at is not null
      and cardinality(enabled_event_types) > 0
      and cardinality(recipient_allowlist_hashes) > 0
      and daily_cap > 0
    )
  )
);

create trigger set_notification_external_rollouts_updated_at
before update on public.notification_external_rollouts
for each row execute function public.set_updated_at();

alter table public.notification_external_rollouts enable row level security;

revoke all on table public.notification_external_rollouts
  from public, anon, authenticated;
grant all privileges on table public.notification_external_rollouts
  to service_role;
grant all privileges on table public.notification_external_rollouts
  to postgres with grant option;

insert into public.notification_external_rollouts (
  id,
  mode,
  cutoff_at,
  enabled_event_types,
  recipient_allowlist_hashes,
  batch_size,
  daily_cap
) values (
  'provider-intake-v1',
  'disabled',
  null,
  array[]::text[],
  array[]::text[],
  1,
  0
);

alter table public.notification_events
  add column audience text not null default 'internal',
  add column event_version smallint not null default 1,
  add column rollout_id text,
  add column external_subject_type text,
  add column external_subject_id uuid,
  add column terminal_reason text;

alter table public.notification_events
  drop constraint notification_events_recipient_type_check,
  add constraint notification_events_recipient_type_check check (
    recipient_type = any (array[
      'usuario_solicitante',
      'administrador_sistema',
      'external_provider'
    ]::text[])
  ),
  drop constraint notification_events_status_check,
  add constraint notification_events_status_check check (
    status = any (array[
      'pending',
      'processing',
      'sent',
      'failed',
      'dead_letter',
      'cancelled',
      'no_recipient'
    ]::text[])
  ),
  add constraint notification_events_audience_check check (
    audience in ('internal', 'external')
  ),
  add constraint notification_events_event_version_check check (
    event_version > 0
  ),
  add constraint notification_events_rollout_id_fkey
    foreign key (rollout_id)
    references public.notification_external_rollouts(id)
    on delete restrict,
  add constraint notification_events_external_subject_id_fkey
    foreign key (external_subject_id)
    references public.payment_intake(id)
    on delete restrict,
  add constraint notification_events_lane_contract_check check (
    (
      audience = 'internal'
      and rollout_id is null
      and external_subject_type is null
      and external_subject_id is null
      and terminal_reason is null
      and status <> 'no_recipient'
    )
    or (
      audience = 'external'
      and rollout_id is not null
      and external_subject_type = 'payment_intake'
      and external_subject_id is not null
      and channel = 'email'
      and recipient_type = 'external_provider'
      and recipient_profile_id is null
      and recipient_role is null
      and source_table = 'payment_intake_events'
      and source_id is not null
      and public.notification_external_event_type_allowed(event_type)
      and event_version = 1
      and max_attempts = 3
      and subject is null
      and public.notification_external_idempotency_valid(
        event_type,
        external_subject_id,
        event_version,
        idempotency_key
      )
      and public.notification_external_payload_valid(
        event_type,
        event_version,
        payload
      )
      and (
        (
          status = 'no_recipient'
          and terminal_reason = 'no_recipient'
          and recipient_email is null
          and next_attempt_at is null
          and attempt_count = 0
          and locked_at is null
          and locked_by is null
        )
        or (
          status <> 'no_recipient'
          and terminal_reason is null
          and recipient_email = lower(btrim(recipient_email))
          and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      )
    )
  );

create unique index notification_events_external_subject_version_uidx
  on public.notification_events(
    audience,
    event_type,
    external_subject_type,
    external_subject_id,
    event_version
  )
  where audience = 'external';

create index notification_events_external_claim_idx
  on public.notification_events(
    rollout_id,
    status,
    next_attempt_at,
    created_at
  )
  where audience = 'external';

alter table public.notification_delivery_attempts
  add column provider_idempotency_key text,
  add column safe_error_code text,
  add column provider_request_started_at timestamptz,
  add column provider_request_completed_at timestamptz,
  add constraint notification_delivery_attempts_provider_key_check check (
    provider_idempotency_key is null
    or (
      nullif(btrim(provider_idempotency_key), '') is not null
      and char_length(provider_idempotency_key) <= 255
    )
  ),
  add constraint notification_delivery_attempts_safe_error_code_check check (
    safe_error_code is null
    or safe_error_code ~ '^[a-z0-9_]{3,80}$'
  ),
  add constraint notification_delivery_attempts_provider_timing_check check (
    provider_request_completed_at is null
    or (
      provider_request_started_at is not null
      and provider_request_completed_at >= provider_request_started_at
    )
  );

create unique index notification_delivery_attempts_event_number_uidx
  on public.notification_delivery_attempts(notification_event_id, attempt_number);

alter table public.payment_intake
  add column expected_file_count smallint,
  add column submission_completed_at timestamptz,
  add constraint payment_intake_expected_file_count_check check (
    expected_file_count is null
    or expected_file_count between 0 and 3
  ),
  add constraint payment_intake_submission_completion_check check (
    submission_completed_at is null
    or expected_file_count is not null
  );

alter table public.payment_intake_events
  add column external_message text,
  add column external_field_codes text[],
  add column external_contract_version smallint,
  drop constraint payment_intake_events_event_type_check,
  add constraint payment_intake_events_event_type_check check (
    event_type in (
      'received',
      'submission_completed',
      'status_changed',
      'file_uploaded',
      'file_reviewed',
      'provider_matched',
      'correction_requested',
      'rejected',
      'converted',
      'internal_note'
    )
  ),
  add constraint payment_intake_events_provider_matched_internal_check check (
    event_type <> 'provider_matched'
    or (
      external_message is null
      and external_field_codes is null
      and external_contract_version is null
    )
  ),
  add constraint payment_intake_events_external_contract_check check (
    (
      external_message is null
      and external_field_codes is null
      and external_contract_version is null
    )
    or (
      event_type in ('correction_requested', 'rejected')
      and external_contract_version = 1
      and public.notification_external_message_valid(external_message)
      and (
        notes is null
        or lower(btrim(notes)) is distinct from lower(btrim(external_message))
      )
      and (
        (
          event_type = 'correction_requested'
          and public.notification_external_field_codes_valid(external_field_codes)
        )
        or (
          event_type = 'rejected'
          and (
            external_field_codes is null
            or cardinality(external_field_codes) = 0
          )
        )
      )
    )
  );

create unique index payment_intake_events_submission_completed_uidx
  on public.payment_intake_events(payment_intake_id)
  where event_type = 'submission_completed';

create function public.protect_payment_intake_submission_completed()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_actual_file_count integer;
begin
  if new.event_type <> 'submission_completed' then
    return new;
  end if;

  select *
    into v_intake
  from public.payment_intake
  where id = new.payment_intake_id;

  if not found
     or v_intake.status <> 'received'
     or v_intake.expected_file_count is null
     or v_intake.submission_completed_at is null
     or v_intake.submission_completed_at > new.created_at
     or new.actor_type <> 'system'
     or new.actor_profile_id is not null
     or new.from_status is distinct from 'received'
     or new.to_status is distinct from 'received'
     or new.notes is not null
     or new.external_message is not null
     or new.external_field_codes is not null
     or new.external_contract_version is not null
     or new.metadata is distinct from jsonb_build_object(
       'contract_version', 1,
       'expected_file_count', v_intake.expected_file_count
     ) then
    raise exception 'submission_completed_contract_invalid';
  end if;

  select count(*)::integer
    into v_actual_file_count
  from public.payment_intake_files
  where payment_intake_id = new.payment_intake_id;

  if v_actual_file_count <> v_intake.expected_file_count then
    raise exception 'submission_completed_file_count_mismatch';
  end if;

  if exists (
    select 1
    from public.payment_intake_events previous_event
    where previous_event.payment_intake_id = new.payment_intake_id
      and previous_event.metadata ->> 'issue_code' in (
        'storage_upload_failed',
        'storage_cleanup_failed',
        'file_metadata_failed',
        'storage_unavailable'
      )
  ) then
    raise exception 'submission_completed_upload_issue_present';
  end if;

  return new;
end
$$;

create trigger protect_payment_intake_submission_completed_trigger
before insert or update on public.payment_intake_events
for each row execute function public.protect_payment_intake_submission_completed();

create function public.protect_external_notification_contract()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_source record;
  v_expected_source_event_type text;
  v_payload_field_codes text[];
begin
  if tg_op = 'UPDATE' and new.audience is distinct from old.audience then
    raise exception 'notification_audience_immutable';
  end if;

  if tg_op = 'INSERT' and new.audience = 'external' then
    if new.max_attempts is distinct from 3
       or new.attempt_count is distinct from 0
       or new.locked_at is not null
       or new.locked_by is not null
       or new.processed_at is not null
       or new.last_attempt_at is not null
       or new.status not in ('pending', 'no_recipient')
       or exists (
         select 1
         from public.notification_delivery_attempts attempt
         where attempt.notification_event_id = new.id
       ) then
      raise exception 'external_notification_initial_attempt_state_invalid';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.audience = 'external' then
    if old.status = 'no_recipient' then
      raise exception 'no_recipient_terminal';
    end if;

    if new.event_type is distinct from old.event_type
       or new.source_table is distinct from old.source_table
       or new.source_id is distinct from old.source_id
       or new.source_folio is distinct from old.source_folio
       or new.recipient_type is distinct from old.recipient_type
       or new.recipient_profile_id is distinct from old.recipient_profile_id
       or new.recipient_email is distinct from old.recipient_email
       or new.recipient_role is distinct from old.recipient_role
       or new.channel is distinct from old.channel
       or new.subject is distinct from old.subject
       or new.payload is distinct from old.payload
       or new.idempotency_key is distinct from old.idempotency_key
       or new.event_version is distinct from old.event_version
       or new.max_attempts is distinct from old.max_attempts
       or new.rollout_id is distinct from old.rollout_id
       or new.external_subject_type is distinct from old.external_subject_type
       or new.external_subject_id is distinct from old.external_subject_id
       or new.terminal_reason is distinct from old.terminal_reason
       or new.created_at is distinct from old.created_at then
      raise exception 'external_notification_identity_immutable';
    end if;
  end if;

  if new.audience <> 'external' then
    return new;
  end if;

  select
    pie.event_type,
    pie.external_message,
    pie.external_field_codes,
    pie.external_contract_version,
    pie.created_at,
    pi.id as payment_intake_id,
    pi.public_folio,
    pi.provider_email,
    pi.expected_file_count,
    pi.submission_completed_at
    into v_source
  from public.payment_intake_events pie
  join public.payment_intake pi on pi.id = pie.payment_intake_id
  where pie.id = new.source_id;

  if not found or v_source.payment_intake_id is distinct from new.external_subject_id then
    raise exception 'external_notification_source_mismatch';
  end if;

  v_expected_source_event_type := case new.event_type
    when 'provider_intake.received' then 'submission_completed'
    when 'provider_intake.correction_requested' then 'correction_requested'
    when 'provider_intake.rejected' then 'rejected'
    else null
  end;

  if v_source.event_type is distinct from v_expected_source_event_type then
    raise exception 'external_notification_source_event_invalid';
  end if;

  if new.source_folio is distinct from v_source.public_folio
     or new.payload ->> 'public_folio' is distinct from v_source.public_folio
     or new.payload ->> 'occurred_on' is distinct from
       to_char(v_source.created_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') then
    raise exception 'external_notification_public_reference_invalid';
  end if;

  if new.status <> 'no_recipient'
     and new.recipient_email is distinct from lower(btrim(v_source.provider_email)) then
    raise exception 'external_notification_recipient_mismatch';
  end if;

  if new.event_type = 'provider_intake.received' then
    if v_source.submission_completed_at is null
       or v_source.expected_file_count is null
       or v_source.external_message is not null
       or v_source.external_field_codes is not null
       or v_source.external_contract_version is not null then
      raise exception 'external_received_requires_submission_completed';
    end if;
  elsif new.event_type = 'provider_intake.correction_requested' then
    select array_agg(value order by value)
      into v_payload_field_codes
    from jsonb_array_elements_text(new.payload -> 'field_codes') value;

    if v_source.external_contract_version is distinct from 1
       or new.payload ->> 'external_message' is distinct from v_source.external_message
       or v_payload_field_codes is distinct from (
         select array_agg(code order by code)
         from unnest(v_source.external_field_codes) code
       ) then
      raise exception 'external_correction_contract_mismatch';
    end if;
  elsif new.event_type = 'provider_intake.rejected' then
    if v_source.external_contract_version is distinct from 1
       or new.payload ->> 'external_message' is distinct from v_source.external_message
       or cardinality(coalesce(v_source.external_field_codes, array[]::text[])) <> 0 then
      raise exception 'external_rejection_contract_mismatch';
    end if;
  end if;

  if new.status = 'no_recipient'
     and exists (
       select 1
       from public.notification_delivery_attempts attempt
       where attempt.notification_event_id = new.id
     ) then
    raise exception 'no_recipient_attempts_forbidden';
  end if;

  return new;
end
$$;

create trigger protect_external_notification_contract_trigger
before insert or update on public.notification_events
for each row execute function public.protect_external_notification_contract();

create function public.protect_notification_delivery_attempt_contract()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_event record;
begin
  select audience, status, idempotency_key
    into v_event
  from public.notification_events
  where id = new.notification_event_id;

  if not found then
    raise exception 'notification_event_not_found';
  end if;

  if v_event.status = 'no_recipient' then
    raise exception 'no_recipient_attempts_forbidden';
  end if;

  if v_event.audience = 'external'
     and new.provider_idempotency_key is distinct from v_event.idempotency_key then
    raise exception 'external_attempt_idempotency_mismatch';
  end if;

  return new;
end
$$;

create trigger protect_notification_delivery_attempt_contract_trigger
before insert or update on public.notification_delivery_attempts
for each row execute function public.protect_notification_delivery_attempt_contract();

-- Preserve the legacy admin/manual claim while isolating it to the internal lane.
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
     where e.audience = 'internal'
       and e.status in ('pending', 'failed')
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

create or replace function public.claim_notification_events_for_dispatcher(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher'
)
returns table (
  id uuid,
  event_type text,
  source_table text,
  source_id uuid,
  source_folio text,
  recipient_type text,
  recipient_profile_id uuid,
  recipient_email text,
  channel text,
  priority text,
  subject text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_worker_id text := left(coalesce(nullif(trim(p_worker_id), ''), 'edge-notification-dispatcher'), 120);
begin
  return query
  with candidate as (
    select e.id
    from public.notification_events e
    where e.audience = 'internal'
      and e.status in ('pending', 'failed')
      and coalesce(e.next_attempt_at, now()) <= now()
      and e.attempt_count < e.max_attempts
      and nullif(trim(coalesce(e.recipient_email, '')), '') is not null
      and coalesce(e.channel, 'email') = 'email'
    order by
      case e.priority
        when 'critical' then 1
        when 'high' then 2
        when 'normal' then 3
        when 'low' then 4
        else 5
      end,
      e.created_at,
      e.id
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.notification_events e
       set status = 'processing',
           locked_at = now(),
           locked_by = v_worker_id,
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
$$;

create function public.claim_external_notification_events_for_dispatcher(
  p_limit integer default 1,
  p_worker_id text default 'external-notification-dispatcher'
)
returns table (
  id uuid,
  event_type text,
  source_table text,
  source_id uuid,
  source_folio text,
  recipient_type text,
  recipient_profile_id uuid,
  recipient_email text,
  channel text,
  priority text,
  subject text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 1);
  v_worker_id text := left(
    coalesce(nullif(btrim(p_worker_id), ''), 'external-notification-dispatcher'),
    120
  );
  v_rollout record;
  v_daily_count integer;
begin
  select r.*
    into v_rollout
  from public.notification_external_rollouts r
  where r.mode in ('test_only', 'pilot')
    and r.cutoff_at is not null
    and cardinality(r.enabled_event_types) > 0
    and cardinality(r.recipient_allowlist_hashes) > 0
    and r.batch_size = 1
    and r.daily_cap > 0
    and exists (
      select 1
      from public.notification_events e
      join public.payment_intake_events pie on pie.id = e.source_id
      where e.rollout_id = r.id
        and e.audience = 'external'
        and e.status = 'pending'
        and e.event_type in (
          'provider_intake.received',
          'provider_intake.correction_requested',
          'provider_intake.rejected'
        )
        and public.notification_external_event_mode_allowed(e.event_type, r.mode)
        and e.event_type = any (r.enabled_event_types)
        and e.created_at >= r.cutoff_at
        and pie.created_at >= r.cutoff_at
        and coalesce(e.next_attempt_at, now()) <= now()
        and e.attempt_count < e.max_attempts
        and e.max_attempts = 3
        and e.recipient_email = lower(btrim(e.recipient_email))
        and e.recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and encode(
          extensions.digest(
            convert_to(lower(btrim(e.recipient_email)), 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = any (r.recipient_allowlist_hashes)
    )
  order by r.id
  for update of r skip locked
  limit 1;

  if not found then
    return;
  end if;

  select count(*)::integer
    into v_daily_count
  from public.notification_events daily_event
  where daily_event.audience = 'external'
    and daily_event.rollout_id = v_rollout.id
    and daily_event.status in ('processing', 'sent')
    and coalesce(
      daily_event.processed_at,
      daily_event.last_attempt_at,
      daily_event.created_at
    ) >= (
      date_trunc(
        'day',
        now() at time zone 'America/Mexico_City'
      ) at time zone 'America/Mexico_City'
    );

  if v_daily_count >= v_rollout.daily_cap then
    return;
  end if;

  return query
  with candidate as (
    select e.id
    from public.notification_events e
    join public.payment_intake_events pie on pie.id = e.source_id
    where e.rollout_id = v_rollout.id
      and e.audience = 'external'
      and e.status = 'pending'
      and e.event_type in (
        'provider_intake.received',
        'provider_intake.correction_requested',
        'provider_intake.rejected'
      )
      and public.notification_external_event_mode_allowed(
        e.event_type,
        v_rollout.mode
      )
      and e.event_type = any (v_rollout.enabled_event_types)
      and e.created_at >= v_rollout.cutoff_at
      and pie.created_at >= v_rollout.cutoff_at
      and coalesce(e.next_attempt_at, now()) <= now()
      and e.attempt_count < e.max_attempts
      and e.max_attempts = 3
      and e.recipient_email = lower(btrim(e.recipient_email))
      and e.recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and encode(
        extensions.digest(
          convert_to(lower(btrim(e.recipient_email)), 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = any (v_rollout.recipient_allowlist_hashes)
    order by e.created_at, e.id
    for update of e skip locked
    limit v_limit
  ),
  claimed as (
    update public.notification_events e
       set status = 'processing',
           locked_at = now(),
           locked_by = v_worker_id,
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
  order by claimed.id;
end;
$$;

create function public.recover_stale_external_notification_events(
  p_limit integer default 1,
  p_lease_minutes integer default 10,
  p_worker_id text default 'external-notification-recovery'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 1);
  v_lease_minutes integer := least(greatest(coalesce(p_lease_minutes, 10), 10), 60);
  v_worker_id text := left(
    coalesce(nullif(btrim(p_worker_id), ''), 'external-notification-recovery'),
    120
  );
  v_recovered integer;
begin
  with candidate as (
    select e.id
    from public.notification_events e
    join public.notification_external_rollouts r on r.id = e.rollout_id
    where e.audience = 'external'
      and e.status = 'processing'
      and e.event_type in (
        'provider_intake.received',
        'provider_intake.correction_requested',
        'provider_intake.rejected'
      )
      and e.locked_at is not null
      and e.locked_at <= now() - make_interval(mins => v_lease_minutes)
      and e.attempt_count < e.max_attempts
      and e.max_attempts = 3
      and r.mode in ('test_only', 'pilot')
      and r.cutoff_at is not null
      and e.created_at >= r.cutoff_at
      and e.event_type = any (r.enabled_event_types)
      and public.notification_external_event_mode_allowed(e.event_type, r.mode)
      and not exists (
        select 1
        from public.notification_delivery_attempts attempt
        where attempt.notification_event_id = e.id
          and (
            attempt.provider_request_started_at is not null
            or attempt.provider_request_completed_at is not null
            or attempt.provider_message_id is not null
            or attempt.status = 'sent'
          )
      )
    order by e.locked_at, e.id
    for update of e skip locked
    limit v_limit
  ),
  recovered as (
    update public.notification_events e
       set status = 'pending',
           locked_at = null,
           locked_by = null,
           next_attempt_at = now(),
           last_error = 'external_processing_lease_expired',
           updated_at = now()
      from candidate c
     where e.id = c.id
     returning e.id
  )
  select count(*)::integer into v_recovered
  from recovered;

  perform v_worker_id;

  return v_recovered;
end
$$;

drop policy if exists notification_events_select_self_or_admin
  on public.notification_events;
create policy notification_events_select_self_or_admin
  on public.notification_events
  as permissive
  for select
  to authenticated
  using (
    audience = 'internal'
    and (
      recipient_profile_id = public.notification_current_profile_id()
      or public.notification_current_user_has_role(array['admin'::text, 'sysadmin'::text])
    )
  );

drop policy if exists notification_delivery_attempts_select_self_or_admin
  on public.notification_delivery_attempts;
create policy notification_delivery_attempts_select_self_or_admin
  on public.notification_delivery_attempts
  as permissive
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.notification_events e
      where e.id = notification_delivery_attempts.notification_event_id
        and e.audience = 'internal'
        and (
          e.recipient_profile_id = public.notification_current_profile_id()
          or public.notification_current_user_has_role(array['admin'::text, 'sysadmin'::text])
        )
    )
  );

revoke all on function public.notification_external_event_type_allowed(text)
  from public, anon, authenticated;
revoke all on function public.notification_external_event_mode_allowed(text, text)
  from public, anon, authenticated;
revoke all on function public.notification_external_field_codes_valid(text[])
  from public, anon, authenticated;
revoke all on function public.notification_external_rollout_event_types_valid(text[])
  from public, anon, authenticated;
revoke all on function public.notification_external_hashes_valid(text[])
  from public, anon, authenticated;
revoke all on function public.notification_external_message_valid(text)
  from public, anon, authenticated;
revoke all on function public.notification_external_json_keys_match(jsonb, text[])
  from public, anon, authenticated;
revoke all on function public.notification_external_payload_valid(text, smallint, jsonb)
  from public, anon, authenticated;
revoke all on function public.notification_external_idempotency_valid(text, uuid, smallint, text)
  from public, anon, authenticated;
revoke all on function public.protect_payment_intake_submission_completed()
  from public, anon, authenticated;
revoke all on function public.protect_external_notification_contract()
  from public, anon, authenticated;
revoke all on function public.protect_notification_delivery_attempt_contract()
  from public, anon, authenticated;
revoke all on function public.claim_notification_events_for_dispatcher(integer, text)
  from public, anon, authenticated;
revoke all on function public.claim_external_notification_events_for_dispatcher(integer, text)
  from public, anon, authenticated;
revoke all on function public.recover_stale_external_notification_events(integer, integer, text)
  from public, anon, authenticated;

grant execute on function public.notification_external_event_type_allowed(text)
  to service_role, postgres;
grant execute on function public.notification_external_event_mode_allowed(text, text)
  to service_role, postgres;
grant execute on function public.notification_external_field_codes_valid(text[])
  to service_role, postgres;
grant execute on function public.notification_external_rollout_event_types_valid(text[])
  to service_role, postgres;
grant execute on function public.notification_external_hashes_valid(text[])
  to service_role, postgres;
grant execute on function public.notification_external_message_valid(text)
  to service_role, postgres;
grant execute on function public.notification_external_json_keys_match(jsonb, text[])
  to service_role, postgres;
grant execute on function public.notification_external_payload_valid(text, smallint, jsonb)
  to service_role, postgres;
grant execute on function public.notification_external_idempotency_valid(text, uuid, smallint, text)
  to service_role, postgres;
grant execute on function public.protect_payment_intake_submission_completed()
  to service_role, postgres;
grant execute on function public.protect_external_notification_contract()
  to service_role, postgres;
grant execute on function public.protect_notification_delivery_attempt_contract()
  to service_role, postgres;
grant execute on function public.claim_notification_events_for_dispatcher(integer, text)
  to service_role, postgres;
grant execute on function public.claim_external_notification_events_for_dispatcher(integer, text)
  to service_role, postgres;
grant execute on function public.recover_stale_external_notification_events(integer, integer, text)
  to service_role, postgres;

comment on table public.notification_external_rollouts is
  'N1-A fail-closed rollout contract. No external producer or consumer is activated by migration 041.';
comment on column public.notification_events.audience is
  'Lane discriminator. Existing and default rows are internal; external rows satisfy the N1-A contract.';
comment on column public.payment_intake.expected_file_count is
  'Known by the public submission handler before intake creation; populated only by a future authorized producer.';
comment on column public.payment_intake.submission_completed_at is
  'Future atomic submission completion marker. Migration 041 performs no historical backfill; current upload issues are terminal for the intake until a separately authorized correction flow exists.';
comment on column public.payment_intake_events.external_message is
  'Sanitized plain-text provider copy, distinct from internal notes.';
comment on column public.payment_intake_events.external_field_codes is
  'Canonical correction field codes; provider_rfc is the sole canonical RFC code.';

commit;
