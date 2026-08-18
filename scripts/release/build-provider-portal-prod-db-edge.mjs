import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SOURCE_DEV_SHA = "c91faf703a79c02d6e9ef21a7b07ea9a0af76a91";
const SOURCE_MAIN_SHA = "70fd10bacea6a9f7b32a36b67906c598f96f39e0";
const PROD_PROJECT = "ucantptjhwttexzmslvm";
const PROD_MIGRATION_HEAD = "20260817230000";

const names = [
  "provider_portal_prod_runtime_control",
  "provider_portal_prod_core_workflow",
  "provider_portal_prod_draft_conversion",
  "provider_portal_prod_provider_aware_links",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function show(ref, file) {
  return run("git", ["show", `${ref}:${file}`]);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.replace(/\r\n/g, "\n").replace(/\s*$/, "\n"), "utf8");
}

function extractLastFunction(source, name) {
  const startPattern = new RegExp(
    `^create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${name}\\s*\\(`,
    "gim",
  );
  const starts = [...source.matchAll(startPattern)];
  if (!starts.length) throw new Error(`missing source function: ${name}`);
  const start = starts.at(-1).index;
  const tail = source.slice(start);
  const asMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);
  if (!asMatch) throw new Error(`missing dollar quote for function: ${name}`);
  const delimiter = asMatch[1];
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const end = source.indexOf(`${delimiter};`, bodyStart);
  if (end < 0) throw new Error(`unterminated source function: ${name}`);
  return source.slice(start, end + delimiter.length + 1).trim();
}

function injectAfterBegin(sql, statement) {
  const asMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(sql);
  if (!asMatch) throw new Error("cannot locate function body");
  const bodyOffset = asMatch.index + asMatch[0].length;
  const beginMatch = /\bbegin\b/i.exec(sql.slice(bodyOffset));
  if (!beginMatch) throw new Error("cannot locate plpgsql begin");
  const insertAt = bodyOffset + beginMatch.index + beginMatch[0].length;
  return `${sql.slice(0, insertAt)}\n  ${statement}\n${sql.slice(insertAt)}`;
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`patch anchor missing: ${label}`);
  return source.replace(before, after);
}

function migrationFile(name) {
  const matches = fs.readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(`_${name}.sql`));
  if (matches.length !== 1) {
    throw new Error(`expected one migration for ${name}; found ${matches.length}`);
  }
  const version = matches[0].slice(0, 14);
  if (!/^\d{14}$/.test(version) || version <= PROD_MIGRATION_HEAD) {
    throw new Error(`migration ${name} is not after PROD head ${PROD_MIGRATION_HEAD}`);
  }
  return { path: `supabase/migrations/${matches[0]}`, version };
}

const migrations = Object.fromEntries(names.map((name) => [name, migrationFile(name)]));
const versions = names.map((name) => migrations[name].version);
if (new Set(versions).size !== versions.length || [...versions].sort().join() !== versions.join()) {
  throw new Error("candidate migration timestamps must be unique and increasing");
}

const src027 = show(SOURCE_DEV_SHA, "supabase/migrations-legacy/active-pre-brownfield/027_provider_intake_edge_support.sql");
const src029 = show(SOURCE_DEV_SHA, "supabase/migrations-legacy/active-pre-brownfield/029_provider_intake_triage.sql");
const src030 = show(SOURCE_DEV_SHA, "supabase/migrations-legacy/active-pre-brownfield/030_provider_intake_action_fingerprint.sql");
const src031 = show(SOURCE_DEV_SHA, "supabase/migrations-legacy/active-pre-brownfield/031_provider_intake_matching.sql");
const src043 = show(SOURCE_DEV_SHA, "supabase/migrations/20260811035346_043_provider_intake_payment_draft.sql");
const src044 = show(SOURCE_DEV_SHA, "supabase/migrations/20260811215129_044_provider_intake_payment_conversion.sql");
const src045 = show(SOURCE_DEV_SHA, "supabase/migrations/20260811230137_045_provider_intake_ramon_uat_product_improvements.sql");
const src046 = show(SOURCE_DEV_SHA, "supabase/migrations/20260812001555_046_provider_aware_intake_links.sql");

const t1 = String.raw`-- Provider Portal PROD forward chain T1/4: authoritative runtime gate.
-- Target captured read-only: ${PROD_PROJECT}; current PROD head: ${PROD_MIGRATION_HEAD}.
-- Default is deliberately disabled. No identity, business data, Storage object, or notification data is seeded.

begin;

do $$
begin
  if to_regclass('public.intake_links') is null
     or to_regclass('public.payment_intake') is null
     or to_regclass('public.payment_intake_files') is null
     or to_regclass('public.payment_intake_events') is null then
    raise exception 'provider_portal_prod_precheck: foundation tables are unavailable';
  end if;
  if to_regclass('public.provider_intake_runtime_control') is not null then
    raise exception 'provider_portal_prod_precheck: runtime control already exists';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'provider_intake_runtime%'
  ) then
    raise exception 'provider_portal_prod_precheck: unexpected runtime function collision';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'intake-uploads'
      and public is false
      and file_size_limit = 10485760
      and allowed_mime_types = array[
        'application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp'
      ]::text[]
  ) then
    raise exception 'provider_portal_prod_precheck: intake-uploads material contract mismatch';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%intake-uploads%' or coalesce(with_check, '') ilike '%intake-uploads%')
      and ('anon' = any(roles) or 'public' = any(roles))
  ) then
    raise exception 'provider_portal_prod_precheck: intake-uploads has a public policy';
  end if;
end
$$;

create table public.provider_intake_runtime_control (
  singleton boolean primary key default true,
  mode text not null default 'disabled',
  updated_by_profile_id uuid null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint provider_intake_runtime_control_singleton_check check (singleton is true),
  constraint provider_intake_runtime_control_mode_check check (mode in ('disabled', 'sysadmin_only', 'full'))
);

create table public.provider_intake_runtime_control_events (
  id bigint generated always as identity primary key,
  previous_mode text not null,
  new_mode text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint provider_intake_runtime_events_previous_check check (previous_mode in ('disabled', 'sysadmin_only', 'full')),
  constraint provider_intake_runtime_events_new_check check (new_mode in ('disabled', 'sysadmin_only', 'full'))
);

alter table public.provider_intake_runtime_control enable row level security;
alter table public.provider_intake_runtime_control_events enable row level security;
revoke all on table public.provider_intake_runtime_control from public, anon, authenticated, service_role;
revoke all on table public.provider_intake_runtime_control_events from public, anon, authenticated, service_role;

insert into public.provider_intake_runtime_control(singleton, mode)
values (true, 'disabled');

create function public.provider_intake_runtime_mode()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when count(*) = 1 and min(mode) in ('disabled', 'sysadmin_only', 'full') then min(mode)
    else 'disabled'
  end
  from public.provider_intake_runtime_control
  where singleton is true
$$;

create function public.provider_intake_public_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.provider_intake_runtime_mode() in ('sysadmin_only', 'full')
$$;

create function public.provider_intake_internal_access_allowed(p_company_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := public.provider_intake_runtime_mode();
  v_profile_id uuid := public.current_profile_id();
begin
  if v_mode = 'disabled' or v_profile_id is null then return false; end if;
  if v_mode = 'sysadmin_only' then
    return public.current_user_has_role(public.flux_sysadmin_roles());
  end if;
  if v_mode = 'full' then
    return public.current_user_has_role(public.flux_sysadmin_roles())
      or (
        public.current_user_has_role(public.flux_finance_roles())
        and (p_company_id is null or public.has_active_company_membership(v_profile_id, p_company_id))
      );
  end if;
  return false;
end
$$;

create function public.provider_intake_require_internal_access(p_company_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.provider_intake_internal_access_allowed(p_company_id) then
    if public.provider_intake_runtime_mode() = 'disabled' then
      raise exception 'provider_intake_disabled';
    end if;
    raise exception 'provider_intake_access_denied';
  end if;
end
$$;

create function public.provider_intake_require_emergency_sysadmin_access(p_company_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'provider_intake_access_denied';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_company_id and coalesce(c.active, true)
  ) then
    raise exception 'provider_intake_company_not_available';
  end if;
  return v_profile_id;
end
$$;

create function public.get_provider_intake_module_access()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'mode', public.provider_intake_runtime_mode(),
    'allowed', public.provider_intake_internal_access_allowed(null),
    'profile_id', case when public.provider_intake_internal_access_allowed(null) then public.current_profile_id() else null end
  )
$$;

create function public.set_provider_intake_runtime_mode(p_mode text, p_confirmed boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_previous text;
begin
  if p_confirmed is not true then raise exception 'provider_intake_mode_confirmation_required'; end if;
  if v_mode not in ('disabled', 'sysadmin_only', 'full') then
    raise exception 'provider_intake_mode_invalid';
  end if;
  if v_actor is null or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'provider_intake_access_denied';
  end if;

  select mode into v_previous
  from public.provider_intake_runtime_control
  where singleton is true
  for update;
  if not found or v_previous not in ('disabled', 'sysadmin_only', 'full') then
    raise exception 'provider_intake_runtime_control_invalid';
  end if;

  if v_previous <> v_mode then
    update public.provider_intake_runtime_control
    set mode = v_mode, updated_by_profile_id = v_actor, updated_at = now()
    where singleton is true;
    insert into public.provider_intake_runtime_control_events(previous_mode, new_mode, actor_profile_id)
    values (v_previous, v_mode, v_actor);
  end if;

  return jsonb_build_object('previous_mode', v_previous, 'mode', v_mode, 'changed', v_previous <> v_mode);
end
$$;

drop policy if exists intake_links_select_admins on public.intake_links;
drop policy if exists payment_intake_select_finance_company on public.payment_intake;
drop policy if exists payment_intake_files_select_finance_company on public.payment_intake_files;
drop policy if exists payment_intake_events_select_finance_company on public.payment_intake_events;

create policy intake_links_select_provider_portal_mode
  on public.intake_links for select to authenticated
  using (public.provider_intake_internal_access_allowed(company_id));

create policy payment_intake_select_provider_portal_mode
  on public.payment_intake for select to authenticated
  using (public.provider_intake_internal_access_allowed(company_id));

create policy payment_intake_files_select_provider_portal_mode
  on public.payment_intake_files for select to authenticated
  using (exists (
    select 1 from public.payment_intake intake
    where intake.id = payment_intake_files.payment_intake_id
      and public.provider_intake_internal_access_allowed(intake.company_id)
  ));

create policy payment_intake_events_select_provider_portal_mode
  on public.payment_intake_events for select to authenticated
  using (exists (
    select 1 from public.payment_intake intake
    where intake.id = payment_intake_events.payment_intake_id
      and public.provider_intake_internal_access_allowed(intake.company_id)
  ));

revoke all on function public.provider_intake_runtime_mode() from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_public_access_allowed() from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_internal_access_allowed(uuid) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_require_internal_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_require_emergency_sysadmin_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_provider_intake_module_access() from public, anon, authenticated, service_role;
revoke all on function public.set_provider_intake_runtime_mode(text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.provider_intake_runtime_mode() to authenticated, service_role;
grant execute on function public.provider_intake_public_access_allowed() to service_role;
grant execute on function public.provider_intake_internal_access_allowed(uuid) to authenticated, service_role;
grant execute on function public.get_provider_intake_module_access() to authenticated;
grant execute on function public.set_provider_intake_runtime_mode(text, boolean) to authenticated;

comment on table public.provider_intake_runtime_control is
  'Singleton fail-closed release gate for the Provider Portal. Migrations always seed disabled.';
comment on function public.provider_intake_public_access_allowed() is
  'Public token routes are enabled in sysadmin_only/full and denied in disabled; login is never required.';

commit;
`;

let actorContext = extractLastFunction(src029, "provider_intake_actor_context");
actorContext = injectAfterBegin(actorContext, "perform public.provider_intake_require_internal_access();");
let attachFiles = extractLastFunction(src027, "attach_provider_intake_files_internal");
attachFiles = injectAfterBegin(attachFiles, "if not public.provider_intake_public_access_allowed() then raise exception 'provider_intake_disabled'; end if;");
let markIssue = extractLastFunction(src027, "mark_provider_intake_upload_issue_internal");
markIssue = injectAfterBegin(markIssue, "if not public.provider_intake_public_access_allowed() then raise exception 'provider_intake_disabled'; end if;");

const t2Functions = [
  attachFiles,
  markIssue,
  actorContext,
  extractLastFunction(src029, "provider_intake_assert_company_access"),
  extractLastFunction(src029, "provider_intake_mask_value"),
  extractLastFunction(src029, "list_provider_intakes"),
  extractLastFunction(src029, "get_provider_intake_detail"),
  extractLastFunction(src030, "provider_intake_action_fingerprint"),
  extractLastFunction(src030, "transition_provider_intake"),
  extractLastFunction(src030, "add_provider_intake_note"),
  extractLastFunction(src031, "normalize_provider_match_text"),
  extractLastFunction(src031, "normalize_provider_match_digits"),
  extractLastFunction(src031, "provider_intake_match_fingerprint"),
  extractLastFunction(src031, "find_provider_intake_candidates"),
  extractLastFunction(src031, "get_provider_intake_match_comparison"),
  extractLastFunction(src031, "set_provider_intake_match"),
];

const t2 = `-- Provider Portal PROD forward chain T2/4: final Edge support, triage, idempotency, and matching.\n-- Derived selectively from DEV ${SOURCE_DEV_SHA}; notification producers are intentionally absent.\n\nbegin;\n\ndo $$\nbegin\n  if public.provider_intake_runtime_mode() <> 'disabled' then\n    raise exception 'provider_portal_prod_precheck: runtime must remain disabled during install';\n  end if;\n  if exists (\n    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace\n    where n.nspname='public' and p.proname = any(array[\n      'attach_provider_intake_files_internal','mark_provider_intake_upload_issue_internal',\n      'provider_intake_actor_context','list_provider_intakes','get_provider_intake_detail',\n      'transition_provider_intake','add_provider_intake_note','find_provider_intake_candidates',\n      'get_provider_intake_match_comparison','set_provider_intake_match'\n    ]::text[])\n  ) then\n    raise exception 'provider_portal_prod_precheck: unexpected core workflow collision';\n  end if;\nend\n$$;\n\nalter table public.payment_intake_events drop constraint if exists payment_intake_events_event_type_check;\nalter table public.payment_intake_events add constraint payment_intake_events_event_type_check check (\n  event_type in ('received','status_changed','file_uploaded','file_reviewed','provider_matched',\n    'correction_requested','rejected','converted','internal_note')\n);\n\ncreate index payment_intake_company_created_idx\n  on public.payment_intake(company_id, created_at desc);\ncreate unique index payment_intake_events_action_id_uidx\n  on public.payment_intake_events(payment_intake_id, (metadata ->> 'action_id'))\n  where metadata ? 'action_id';\n\n${t2Functions.join("\n\n")}\n\ndo $$\ndeclare r record;\nbegin\n  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace\n    where n.nspname='public' and p.proname = any(array[\n      'attach_provider_intake_files_internal','mark_provider_intake_upload_issue_internal',\n      'provider_intake_actor_context','provider_intake_assert_company_access','provider_intake_mask_value',\n      'list_provider_intakes','get_provider_intake_detail','provider_intake_action_fingerprint',\n      'transition_provider_intake','add_provider_intake_note','normalize_provider_match_text',\n      'normalize_provider_match_digits','provider_intake_match_fingerprint','find_provider_intake_candidates',\n      'get_provider_intake_match_comparison','set_provider_intake_match'\n    ]::text[])\n  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', r.signature); end loop;\nend\n$$;\n\ngrant execute on function public.attach_provider_intake_files_internal(uuid, jsonb) to service_role;\ngrant execute on function public.mark_provider_intake_upload_issue_internal(uuid, text) to service_role;\ngrant execute on function public.list_provider_intakes(uuid, text, text, integer, integer) to authenticated;\ngrant execute on function public.get_provider_intake_detail(uuid) to authenticated;\ngrant execute on function public.transition_provider_intake(uuid, text, timestamptz, text, text, uuid) to authenticated;\ngrant execute on function public.add_provider_intake_note(uuid, timestamptz, text, uuid) to authenticated;\ngrant execute on function public.find_provider_intake_candidates(uuid, text, integer) to authenticated;\ngrant execute on function public.get_provider_intake_match_comparison(uuid, uuid) to authenticated;\ngrant execute on function public.set_provider_intake_match(uuid, uuid, timestamptz, uuid) to authenticated;\n\ncommit;\n`;

const draftTableStart = src043.indexOf("create table public.payment_intake_conversion_drafts");
const draftFunctionStart = src043.indexOf("create function public.provider_intake_conversion_draft_fingerprint", draftTableStart);
if (draftTableStart < 0 || draftFunctionStart < 0) throw new Error("draft DDL source anchors missing");
let draftDdl = src043.slice(draftTableStart, draftFunctionStart).trim();
draftDdl = draftDdl.replace(
  "alter table public.payment_intake_events\n  drop constraint payment_intake_events_event_type_check;",
  "alter table public.payment_intake_events\n  drop constraint if exists payment_intake_events_event_type_check;",
);

const t3Functions = [
  extractLastFunction(src043, "provider_intake_conversion_draft_fingerprint"),
  extractLastFunction(src043, "provider_intake_payment_draft_state"),
  extractLastFunction(src043, "get_provider_intake_payment_draft_context"),
  extractLastFunction(src043, "save_provider_intake_payment_draft"),
  extractLastFunction(src044, "convert_provider_intake_to_payment_request"),
];

const t3 = `-- Provider Portal PROD forward chain T3/4: 2B.1 draft plus 2B.2 exactly-once conversion.\n-- Runtime remains disabled; no draft, intake, payment_request, batch, layout, or payment row is created.\n\nbegin;\n\ndo $$\nbegin\n  if public.provider_intake_runtime_mode() <> 'disabled' then\n    raise exception 'provider_portal_prod_precheck: runtime must remain disabled during install';\n  end if;\n  if to_regclass('public.payment_intake_conversion_drafts') is not null then\n    raise exception 'provider_portal_prod_precheck: draft table collision';\n  end if;\n  if to_regprocedure('public.convert_provider_intake_to_payment_request(uuid,timestamp with time zone,integer,uuid)') is not null then\n    raise exception 'provider_portal_prod_precheck: conversion function collision';\n  end if;\nend\n$$;\n\n${draftDdl}\n\n${t3Functions.join("\n\n")}\n\ndo $$\ndeclare r record;\nbegin\n  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace\n    where n.nspname='public' and p.proname = any(array[\n      'provider_intake_conversion_draft_fingerprint','provider_intake_payment_draft_state',\n      'get_provider_intake_payment_draft_context','save_provider_intake_payment_draft',\n      'convert_provider_intake_to_payment_request'\n    ]::text[])\n  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', r.signature); end loop;\nend\n$$;\n\ngrant execute on function public.get_provider_intake_payment_draft_context(uuid) to authenticated;\ngrant execute on function public.save_provider_intake_payment_draft(uuid, integer, uuid, uuid, date, uuid, text, uuid, uuid, numeric, text, date, text, text, text, uuid) to authenticated;\ngrant execute on function public.convert_provider_intake_to_payment_request(uuid, timestamptz, integer, uuid) to authenticated;\n\ncommit;\n`;

const customActorAuthorized = String.raw`create function public.provider_intake_link_actor_authorized(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_profile_id is not null
    and p_profile_id = public.current_profile_id()
    and p_company_id is not null
    and exists (
      select 1 from public.companies company
      where company.id = p_company_id and coalesce(company.active, true)
    )
    and public.provider_intake_internal_access_allowed(p_company_id)
$$;`;

let revokeLink = extractLastFunction(src045, "revoke_provider_intake_link");
revokeLink = replaceOnce(
  revokeLink,
  "v_actor := public.provider_intake_link_require_company_access(v_link.company_id);",
  "v_actor := public.provider_intake_require_emergency_sysadmin_access(v_link.company_id);",
  "emergency revoke",
);
let resolveAware = extractLastFunction(src046, "resolve_provider_aware_intake_link_internal");
resolveAware = injectAfterBegin(resolveAware, "if not public.provider_intake_public_access_allowed() then raise exception 'provider_intake_disabled'; end if;");
let createAware = extractLastFunction(src046, "create_provider_aware_intake_internal");
createAware = injectAfterBegin(createAware, "if not public.provider_intake_public_access_allowed() then raise exception 'provider_intake_disabled'; end if;");

const t4Functions = [
  extractLastFunction(src045, "provider_intake_mask_text"),
  extractLastFunction(src046, "provider_intake_banking_difference_state"),
  extractLastFunction(src045, "confirm_provider_intake_master_banking"),
  extractLastFunction(src045, "get_provider_intake_provider_proposal"),
  customActorAuthorized,
  extractLastFunction(src045, "provider_intake_link_require_company_access"),
  extractLastFunction(src046, "get_provider_intake_link_management_context"),
  revokeLink,
  extractLastFunction(src046, "find_provider_intake_link_providers"),
  extractLastFunction(src046, "get_provider_intake_link_scope"),
  extractLastFunction(src046, "create_provider_intake_link_v2"),
  extractLastFunction(src046, "regenerate_provider_intake_link_v2"),
  resolveAware,
  createAware,
  extractLastFunction(src046, "get_provider_intake_link_target"),
  extractLastFunction(src045, "provider_intake_payment_draft_state"),
];

const t4 = `-- Provider Portal PROD forward chain T4/4: final provider-aware links and banking review.\n-- Historical V1 create/regenerate/resolve overloads and all notification producers are excluded.\n\nbegin;\n\ndo $$\nbegin\n  if public.provider_intake_runtime_mode() <> 'disabled' then\n    raise exception 'provider_portal_prod_precheck: runtime must remain disabled during install';\n  end if;\n  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='intake_links' and column_name='proveedor_id')\n     or exists (select 1 from information_schema.columns where table_schema='public' and table_name='payment_intake' and column_name='link_target_proveedor_id') then\n    raise exception 'provider_portal_prod_precheck: provider-aware column collision';\n  end if;\nend\n$$;\n\nalter table public.payment_intake_events drop constraint if exists payment_intake_events_event_type_check;\nalter table public.payment_intake_events add constraint payment_intake_events_event_type_check check (\n  event_type in ('received','status_changed','file_uploaded','file_reviewed','provider_matched',\n    'correction_requested','rejected','converted','internal_note','conversion_draft_created',\n    'conversion_draft_updated','banking_resolution')\n) not valid;\nalter table public.payment_intake_events validate constraint payment_intake_events_event_type_check;\n\nalter table public.intake_links add column proveedor_id uuid null;\nalter table public.intake_links add constraint intake_links_proveedor_id_fkey\n  foreign key (proveedor_id) references public.proveedores(id) on delete restrict;\nalter table public.payment_intake\n  add column link_target_proveedor_id uuid null,\n  add column bank_data_confirmation text null;\nalter table public.payment_intake\n  add constraint payment_intake_link_target_proveedor_id_fkey\n    foreign key (link_target_proveedor_id) references public.proveedores(id) on delete restrict,\n  add constraint payment_intake_bank_data_confirmation_check\n    check (bank_data_confirmation is null or bank_data_confirmation in ('MASTER_CONFIRMED','CHANGE_DECLARED'));\n\ndrop index public.intake_links_one_active_per_company_uidx;\ncreate unique index intake_links_one_active_generic_per_company_uidx\n  on public.intake_links(company_id) where status='active' and proveedor_id is null;\ncreate unique index intake_links_one_active_per_company_provider_uidx\n  on public.intake_links(company_id, proveedor_id) where status='active' and proveedor_id is not null;\ncreate index intake_links_proveedor_id_idx on public.intake_links(proveedor_id) where proveedor_id is not null;\ncreate index payment_intake_link_target_proveedor_id_idx\n  on public.payment_intake(link_target_proveedor_id) where link_target_proveedor_id is not null;\n\n${t4Functions.join("\n\n")}\n\ndo $$\ndeclare r record;\nbegin\n  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace\n    where n.nspname='public' and p.proname = any(array[\n      'provider_intake_mask_text','provider_intake_banking_difference_state',\n      'confirm_provider_intake_master_banking','get_provider_intake_provider_proposal',\n      'provider_intake_link_actor_authorized','provider_intake_link_require_company_access',\n      'get_provider_intake_link_management_context','revoke_provider_intake_link',\n      'find_provider_intake_link_providers','get_provider_intake_link_scope',\n      'create_provider_intake_link_v2','regenerate_provider_intake_link_v2',\n      'resolve_provider_aware_intake_link_internal','create_provider_aware_intake_internal',\n      'get_provider_intake_link_target','provider_intake_payment_draft_state'\n    ]::text[])\n  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', r.signature); end loop;\nend\n$$;\n\ngrant execute on function public.confirm_provider_intake_master_banking(uuid, timestamptz, timestamptz, uuid) to authenticated;\ngrant execute on function public.get_provider_intake_provider_proposal(uuid) to authenticated;\ngrant execute on function public.get_provider_intake_link_management_context() to authenticated;\ngrant execute on function public.revoke_provider_intake_link(uuid, boolean) to authenticated;\ngrant execute on function public.find_provider_intake_link_providers(uuid, text, integer) to authenticated;\ngrant execute on function public.get_provider_intake_link_scope(uuid, uuid) to authenticated;\ngrant execute on function public.create_provider_intake_link_v2(uuid, uuid, text, integer, integer, integer) to authenticated;\ngrant execute on function public.regenerate_provider_intake_link_v2(uuid, boolean, integer) to authenticated;\ngrant execute on function public.get_provider_intake_link_target(uuid) to authenticated;\ngrant execute on function public.resolve_provider_aware_intake_link_internal(text) to service_role;\ngrant execute on function public.create_provider_aware_intake_internal(text, jsonb, text, text, text, text, text, integer) to service_role;\n\ncomment on column public.intake_links.proveedor_id is\n  'Optional server-side target provider. NULL preserves generic links.';\ncomment on column public.payment_intake.link_target_proveedor_id is\n  'Immutable intake provenance copied from the validated link target; never an automatic master match.';\n\ncommit;\n`;

write(migrations.provider_portal_prod_runtime_control.path, t1);
write(migrations.provider_portal_prod_core_workflow.path, t2);
write(migrations.provider_portal_prod_draft_conversion.path, t3);
write(migrations.provider_portal_prod_provider_aware_links.path, t4);

const edgePaths = run("git", ["ls-tree", "-r", "--name-only", SOURCE_DEV_SHA, "supabase/functions/provider-intake"])
  .trim().split("\n").filter(Boolean);
for (const edgePath of edgePaths) {
  let content = show(SOURCE_DEV_SHA, edgePath);
  if (edgePath.endsWith(".ts")) {
    content = content
      .replaceAll("https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app", "https://flux.quantta.mx")
      .replaceAll("https://scsirgbuqjcwoaxfacth.functions.supabase.co", "https://ucantptjhwttexzmslvm.functions.supabase.co")
      .replaceAll("https://example.test/privacy", "https://privacy.quantta.mx/provider-intake")
      .replaceAll("Operadora DEV", "Operadora shadow");
  }
  write(edgePath, content);
}

write("supabase/functions/provider-intake/prod-config.ts", String.raw`export const PROVIDER_INTAKE_PROD_CONTRACT = Object.freeze({
  captchaProvider: "turnstile",
  hostname: "flux.quantta.mx",
  action: "provider_intake_submit",
  allowedOrigin: "https://flux.quantta.mx",
});

const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

type EnvReader = (name: string) => string | undefined;

function required(reader: EnvReader, name: string): string {
  const value = reader(name)?.trim() || "";
  if (!value) throw new Error("missing_required_secret:" + name);
  return value;
}

export function readProviderIntakeProdSecurityConfig(reader: EnvReader) {
  const captchaProvider = required(reader, "CAPTCHA_PROVIDER").toLowerCase();
  const captchaSecret = required(reader, "CAPTCHA_SECRET");
  const expectedHostname = required(reader, "CAPTCHA_EXPECTED_HOSTNAME").toLowerCase();
  const expectedAction = required(reader, "CAPTCHA_EXPECTED_ACTION");
  const allowedOrigins = required(reader, "INTAKE_ALLOWED_ORIGINS");
  const privacyNoticeUrl = required(reader, "INTAKE_PRIVACY_NOTICE_URL");
  const allowNoOrigin = (reader("INTAKE_ALLOW_NO_ORIGIN") || "false").trim().toLowerCase();
  const allowQueryToken = (reader("INTAKE_ALLOW_QUERY_TOKEN") || "false").trim().toLowerCase();

  if (captchaProvider !== PROVIDER_INTAKE_PROD_CONTRACT.captchaProvider) throw new Error("invalid_configuration:CAPTCHA_PROVIDER");
  if (TURNSTILE_TEST_SECRETS.has(captchaSecret)) throw new Error("invalid_configuration:CAPTCHA_SECRET_test_key_forbidden");
  if (expectedHostname !== PROVIDER_INTAKE_PROD_CONTRACT.hostname) throw new Error("invalid_configuration:CAPTCHA_EXPECTED_HOSTNAME");
  if (expectedAction !== PROVIDER_INTAKE_PROD_CONTRACT.action) throw new Error("invalid_configuration:CAPTCHA_EXPECTED_ACTION");
  if (allowedOrigins !== PROVIDER_INTAKE_PROD_CONTRACT.allowedOrigin) throw new Error("invalid_configuration:INTAKE_ALLOWED_ORIGINS");
  if (allowNoOrigin !== "false") throw new Error("invalid_configuration:INTAKE_ALLOW_NO_ORIGIN");
  if (allowQueryToken !== "false") throw new Error("invalid_configuration:INTAKE_ALLOW_QUERY_TOKEN");

  let privacyUrl: URL;
  try { privacyUrl = new URL(privacyNoticeUrl); } catch { throw new Error("invalid_configuration:INTAKE_PRIVACY_NOTICE_URL"); }
  if (privacyUrl.protocol !== "https:" || privacyUrl.username || privacyUrl.password) {
    throw new Error("invalid_configuration:INTAKE_PRIVACY_NOTICE_URL");
  }
  return { captchaProvider, captchaSecret, expectedHostname, expectedAction, privacyNoticeUrl: privacyUrl.href };
}
`);

let edgeIndex = fs.readFileSync("supabase/functions/provider-intake/index.ts", "utf8");
edgeIndex = replaceOnce(edgeIndex,
  'import { readIntakeConfig } from "./validation.ts";',
  'import { readIntakeConfig } from "./validation.ts";\nimport { readProviderIntakeProdSecurityConfig } from "./prod-config.ts";',
  "edge prod config import",
);
const oldCaptchaBlock = `if (\n  (Deno.env.get("INTAKE_ALLOW_QUERY_TOKEN") || "false").trim().toLowerCase() !==\n    "false"\n) {\n  throw new Error(\n    "invalid_configuration:INTAKE_ALLOW_QUERY_TOKEN_must_be_false",\n  );\n}\n\nconst captchaProvider = requiredEnv("CAPTCHA_PROVIDER").toLowerCase();\nif (captchaProvider !== "turnstile") {\n  throw new Error("invalid_configuration:CAPTCHA_PROVIDER");\n}`;
edgeIndex = replaceOnce(edgeIndex, oldCaptchaBlock,
  `const prodSecurity = readProviderIntakeProdSecurityConfig((name) => Deno.env.get(name));`,
  "edge captcha bootstrap",
);
edgeIndex = replaceOnce(edgeIndex,
  `const captcha = new TurnstileVerifier({\n  secret: requiredEnv("CAPTCHA_SECRET"),\n  expectedHostname: optionalEnv("CAPTCHA_EXPECTED_HOSTNAME"),\n  expectedAction: optionalEnv("CAPTCHA_EXPECTED_ACTION"),\n});`,
  `const captcha = new TurnstileVerifier({\n  secret: prodSecurity.captchaSecret,\n  expectedHostname: prodSecurity.expectedHostname,\n  expectedAction: prodSecurity.expectedAction,\n});`,
  "edge captcha strict config",
);
edgeIndex = edgeIndex.replace(/\nfunction optionalEnv[\s\S]*?\n}\n/, "\n");
write("supabase/functions/provider-intake/index.ts", edgeIndex);

let edgeTest = fs.readFileSync("supabase/functions/provider-intake/provider-intake_test.ts", "utf8");
edgeTest = edgeTest.replaceAll("https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app", "https://flux.quantta.mx");
edgeTest = edgeTest.replaceAll("https://example.test/privacy", "https://privacy.quantta.mx/provider-intake");
edgeTest = edgeTest.replaceAll("Operadora DEV", "Operadora shadow");
write("supabase/functions/provider-intake/provider-intake_test.ts", edgeTest);

write("supabase/functions/provider-intake/prod-config_test.ts", String.raw`import { readProviderIntakeProdSecurityConfig } from "./prod-config.ts";
import { TurnstileVerifier } from "./captcha.ts";

function assert(value: unknown, message = "assertion_failed"): asserts value { if (!value) throw new Error(message); }
function validEnv(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    CAPTCHA_PROVIDER: "turnstile",
    CAPTCHA_SECRET: "prod_candidate_secret_not_a_real_value",
    CAPTCHA_EXPECTED_HOSTNAME: "flux.quantta.mx",
    CAPTCHA_EXPECTED_ACTION: "provider_intake_submit",
    INTAKE_ALLOWED_ORIGINS: "https://flux.quantta.mx",
    INTAKE_ALLOW_NO_ORIGIN: "false",
    INTAKE_ALLOW_QUERY_TOKEN: "false",
    INTAKE_PRIVACY_NOTICE_URL: "https://privacy.quantta.mx/provider-intake",
    ...overrides,
  };
  return (name: string) => values[name];
}
function mustFail(overrides: Record<string, string>, code: string) {
  let failure = "";
  try { readProviderIntakeProdSecurityConfig(validEnv(overrides)); } catch (error) { failure = String(error); }
  assert(failure.includes(code), "expected " + code + "; got " + failure);
}

Deno.test("production Edge contract accepts only the exact public boundary", () => {
  const config = readProviderIntakeProdSecurityConfig(validEnv());
  assert(config.expectedHostname === "flux.quantta.mx");
  assert(config.expectedAction === "provider_intake_submit");
});

Deno.test("production Edge contract rejects test secret, hostname, action, origin, flags, and privacy gaps", () => {
  mustFail({ CAPTCHA_SECRET: "1x0000000000000000000000000000000AA" }, "test_key_forbidden");
  mustFail({ CAPTCHA_EXPECTED_HOSTNAME: "preview.example" }, "CAPTCHA_EXPECTED_HOSTNAME");
  mustFail({ CAPTCHA_EXPECTED_ACTION: "other_action" }, "CAPTCHA_EXPECTED_ACTION");
  mustFail({ INTAKE_ALLOWED_ORIGINS: "*" }, "INTAKE_ALLOWED_ORIGINS");
  mustFail({ INTAKE_ALLOW_NO_ORIGIN: "true" }, "INTAKE_ALLOW_NO_ORIGIN");
  mustFail({ INTAKE_ALLOW_QUERY_TOKEN: "true" }, "INTAKE_ALLOW_QUERY_TOKEN");
  mustFail({ INTAKE_PRIVACY_NOTICE_URL: "http://quantta.mx/privacy" }, "INTAKE_PRIVACY_NOTICE_URL");
  mustFail({ INTAKE_PRIVACY_NOTICE_URL: "" }, "INTAKE_PRIVACY_NOTICE_URL");
});

Deno.test("Turnstile verifier rejects wrong hostname, wrong action, invalid and replayed tokens", async () => {
  let calls = 0;
  const verifier = new TurnstileVerifier({
    secret: "prod_candidate_secret_not_a_real_value",
    expectedHostname: "flux.quantta.mx",
    expectedAction: "provider_intake_submit",
    now: () => Date.parse("2026-08-17T23:00:00Z"),
    fetchImpl: (() => {
      calls += 1;
      const payload = calls === 1
        ? { success: true, hostname: "flux.quantta.mx", action: "provider_intake_submit", challenge_ts: "2026-08-17T22:59:30Z" }
        : { success: false };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    }) as typeof fetch,
  });
  assert(await verifier.verify({ token: "first-use" }));
  assert(!(await verifier.verify({ token: "first-use" })), "replayed token must fail when Turnstile reports spent");

  for (const payload of [
    { success: true, hostname: "evil.example", action: "provider_intake_submit", challenge_ts: "2026-08-17T22:59:30Z" },
    { success: true, hostname: "flux.quantta.mx", action: "wrong", challenge_ts: "2026-08-17T22:59:30Z" },
    { success: false },
  ]) {
    const candidate = new TurnstileVerifier({
      secret: "prod_candidate_secret_not_a_real_value",
      expectedHostname: "flux.quantta.mx",
      expectedAction: "provider_intake_submit",
      now: () => Date.parse("2026-08-17T23:00:00Z"),
      fetchImpl: (() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))) as typeof fetch,
    });
    assert(!(await candidate.verify({ token: "invalid" })));
  }
});
`);

for (const entry of fs.readdirSync("supabase/functions/provider-intake")) {
  if (!entry.endsWith(".ts")) continue;
  const file = path.join("supabase/functions/provider-intake", entry);
  const cleaned = fs.readFileSync(file, "utf8")
    .replaceAll("catalogo-proveedores-flux-git-dev", "flux")
    .replaceAll("scsirgbuqjcwoaxfacth", "ucantptjhwttexzmslvm")
    .replaceAll("Ambiente DEV", "Producci?n");
  write(file, cleaned);
}

write("supabase/config.toml", `[functions.provider-intake]\nverify_jwt = false\n`);

const fixture = String.raw`\set ON_ERROR_STOP on
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
set search_path = public, extensions;

create table public.companies(id uuid primary key default gen_random_uuid(), name text, legal_name text, active boolean default true);
create table public.profiles(id uuid primary key default gen_random_uuid(), auth_user_id uuid, email text, full_name text, active boolean default true);
create table public.proveedores(
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id),
  alias text, razon_social text, nombre_comercial text, rfc text, email text, telefono text,
  banco text, cuenta text, clabe text, beneficiario text, active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.cost_centers(id uuid primary key default gen_random_uuid(), company_id uuid, name text, active boolean default true);
create table public.budget_categories(id uuid primary key default gen_random_uuid(), name text, active boolean default true);
create table public.company_bank_accounts(id uuid primary key default gen_random_uuid(), company_id uuid, active boolean default true);
create table public.approver_assignments(id uuid primary key default gen_random_uuid());
create table public.payment_requests(id uuid primary key default gen_random_uuid());

create function public.next_payment_intake_public_folio() returns text language sql as $$ select 'INT-2099-000001'::text $$;
create function public.current_profile_id() returns uuid language sql stable as $$ select nullif(current_setting('app.test_profile_id', true), '')::uuid $$;
create function public.flux_sysadmin_roles() returns text[] language sql immutable as $$ select array['sysadmin']::text[] $$;
create function public.flux_finance_roles() returns text[] language sql immutable as $$ select array['finance','director','admin','operativo']::text[] $$;
create function public.current_user_has_role(p_roles text[]) returns boolean language sql stable as $$
  select exists (select 1 from unnest(string_to_array(coalesce(current_setting('app.test_roles', true), ''), ',')) r where btrim(r) = any(p_roles))
$$;
create function public.has_active_company_membership(p_profile_id uuid, p_company_id uuid) returns boolean language sql stable as $$ select p_profile_id is not null and p_company_id is not null $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_auth_uid', true), '')::uuid $$;

create table public.intake_links(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), label text not null,
  token_hash text not null, token_prefix text not null, status text not null default 'active', expires_at timestamptz,
  max_submissions_per_day integer not null default 20,
  allowed_file_types text[] not null default array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp'],
  max_file_mb integer not null default 10, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id), revoked_at timestamptz,
  regenerated_from_id uuid references public.intake_links(id)
);
create unique index intake_links_id_company_uidx on public.intake_links(id, company_id);
create unique index intake_links_one_active_per_company_uidx on public.intake_links(company_id) where status='active';
create unique index intake_links_token_hash_uidx on public.intake_links(token_hash);
alter table public.intake_links enable row level security;

create table public.payment_intake(
  id uuid primary key default gen_random_uuid(), public_folio text not null default public.next_payment_intake_public_folio(),
  intake_link_id uuid not null, company_id uuid not null references public.companies(id), status text not null default 'received',
  provider_name text not null, provider_rfc text, provider_email text not null, provider_phone text,
  concept text not null, description text, amount_requested numeric not null, currency text not null default 'MXN',
  requested_payment_date date, invoice_folio text, invoice_uuid text, invoice_date date,
  bank_name text, bank_account text, bank_clabe text, beneficiary_name text,
  submission_fingerprint text not null, idempotency_key text, client_ip_hash text, user_agent_hash text,
  payload_version integer not null default 1, captcha_provider text, captcha_verified_at timestamptz,
  matched_proveedor_id uuid references public.proveedores(id), created_payment_request_id uuid references public.payment_requests(id),
  triaged_by uuid references public.profiles(id), triaged_at timestamptz, rejection_reason text, retention_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (intake_link_id, company_id) references public.intake_links(id, company_id)
);
create unique index payment_intake_created_request_uidx on public.payment_intake(created_payment_request_id) where created_payment_request_id is not null;
alter table public.payment_intake enable row level security;

create table public.payment_intake_files(
  id uuid primary key default gen_random_uuid(), payment_intake_id uuid not null references public.payment_intake(id),
  bucket_id text not null default 'intake-uploads', storage_path text not null, original_filename text not null,
  mime_type text not null, size_bytes bigint not null, file_kind text not null, quarantine_status text not null default 'pending',
  sha256 text, created_at timestamptz not null default now(), reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz, rejection_reason text
);
alter table public.payment_intake_files enable row level security;
create table public.payment_intake_events(
  id uuid primary key default gen_random_uuid(), payment_intake_id uuid not null references public.payment_intake(id),
  event_type text not null, actor_profile_id uuid references public.profiles(id), actor_type text not null,
  from_status text, to_status text, notes text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  constraint payment_intake_events_event_type_check check (event_type in ('received','status_changed','file_uploaded','file_reviewed','provider_matched','correction_requested','rejected','converted'))
);
alter table public.payment_intake_events enable row level security;

create policy intake_links_select_admins on public.intake_links for select to authenticated using (public.current_user_has_role(public.flux_sysadmin_roles()));
create policy payment_intake_select_finance_company on public.payment_intake for select to authenticated using (true);
create policy payment_intake_files_select_finance_company on public.payment_intake_files for select to authenticated using (true);
create policy payment_intake_events_select_finance_company on public.payment_intake_events for select to authenticated using (true);

create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
insert into storage.buckets values ('intake-uploads', false, 10485760, array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp']);
`;
write("scripts/qa/provider-portal-prod-shadow-fixture.sql", fixture);

write("scripts/qa/provider-portal-prod-shadow-assertions.sql", String.raw`\set ON_ERROR_STOP on
do $$
declare v_count integer;
begin
  if public.provider_intake_runtime_mode() <> 'disabled' then raise exception 'default mode is not disabled'; end if;
  perform set_config('app.test_profile_id','11111111-1111-4111-8111-111111111111',false);
  perform set_config('app.test_roles','sysadmin',false);
  if public.provider_intake_internal_access_allowed(null) then raise exception 'disabled mode allowed internal access'; end if;
  if public.provider_intake_public_access_allowed() then raise exception 'disabled mode allowed public access'; end if;

  begin
    update public.provider_intake_runtime_control set mode='unknown' where singleton;
    raise exception 'unknown mode was accepted';
  exception when check_violation then null;
  end;

  update public.provider_intake_runtime_control set mode='sysadmin_only' where singleton;
  if not public.provider_intake_internal_access_allowed(null) then raise exception 'sysadmin denied in pilot'; end if;
  if not public.provider_intake_public_access_allowed() then raise exception 'public token boundary denied in pilot'; end if;

  foreach v_count in array array[1,2,3,4] loop
    perform set_config('app.test_roles', case v_count when 1 then 'finance' when 2 then 'director' when 3 then 'admin' else 'operativo' end, false);
    if public.provider_intake_internal_access_allowed(null) then raise exception 'non-sysadmin allowed in pilot'; end if;
  end loop;
  perform set_config('app.test_roles','',false);
  if public.provider_intake_internal_access_allowed(null) then raise exception 'anonymous-like context allowed internally'; end if;

  update public.provider_intake_runtime_control set mode='disabled' where singleton;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='payment_intake_conversion_drafts') then
    raise exception 'draft table missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='intake_links' and column_name='proveedor_id') then
    raise exception 'provider-aware link column missing';
  end if;
  if to_regprocedure('public.create_provider_intake_link(uuid,text,integer,integer,integer)') is not null
     or to_regprocedure('public.regenerate_provider_intake_link(uuid,boolean,integer)') is not null
     or to_regprocedure('public.resolve_provider_intake_link_internal(text)') is not null then
    raise exception 'obsolete V1 overload present';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname ilike '%notification%' or p.proname ilike '%notify%')) then
    raise exception 'notification delta detected';
  end if;
  if (select count(*) from public.intake_links) <> 0 or (select count(*) from public.payment_intake) <> 0
     or (select count(*) from public.payment_requests) <> 0 or (select count(*) from storage.objects) <> 0 then
    raise exception 'shadow chain created business or storage data';
  end if;
  if (select count(*) from storage.buckets where id='intake-uploads' and public is false and file_size_limit=10485760) <> 1 then
    raise exception 'storage material contract changed';
  end if;
end
$$;

select 'FRESH_PROD_FORWARD_CHAIN_PASS=true' as result;
select 'SYSADMIN_ONLY_GATE_PROVEN=true' as result;
select 'PUBLIC_PROVIDER_LINK_BOUNDARY_PROVEN=true' as result;
select 'PROVIDER_INTAKE_NOTIFICATION_RELEASE_DELTA=0' as result;
`);

write("scripts/qa/provider-portal-prod-db-edge-contract.test.mjs", String.raw`import fs from "node:fs";
import path from "node:path";

const fail = (message) => { throw new Error(message); };
const manifest = JSON.parse(fs.readFileSync("docs/ops/provider-portal-prod-runtime-manifest.json", "utf8"));
const migrationFiles = fs.readdirSync("supabase/migrations").filter((f) => /_provider_portal_prod_.*\.sql$/.test(f)).sort();
if (migrationFiles.length !== 4) fail("expected 4 forward migrations; got " + migrationFiles.length);
const versions = migrationFiles.map((f) => f.slice(0, 14));
if (new Set(versions).size !== 4 || versions.some((v) => v <= "20260817230000")) fail("invalid forward migration versions");
const sql = migrationFiles.map((f) => fs.readFileSync(path.join("supabase/migrations", f), "utf8")).join("\n");

for (const required of [
  "provider_intake_runtime_control", "disabled", "sysadmin_only", "full",
  "provider_intake_public_access_allowed", "provider_intake_internal_access_allowed",
  "payment_intake_conversion_drafts", "convert_provider_intake_to_payment_request",
  "create_provider_intake_link_v2", "resolve_provider_aware_intake_link_internal",
  "create_provider_aware_intake_internal", "MASTER_CONFIRMED", "CHANGE_DECLARED",
]) if (!sql.includes(required)) fail("missing SQL contract: " + required);
for (const forbidden of [
  "create function public.create_provider_intake_link(",
  "create function public.regenerate_provider_intake_link(",
  "create function public.resolve_provider_intake_link_internal(",
  "notification_outbox", "enqueue_notification", "n8n", "resend",
]) if (sql.toLowerCase().includes(forbidden.toLowerCase())) fail("forbidden SQL delta: " + forbidden);
if (!/default 'disabled'/.test(sql) || !sql.includes("values (true, 'disabled')")) fail("runtime does not fail closed");
if (!sql.includes("provider_intake_require_emergency_sysadmin_access")) fail("emergency revoke contract missing");

const edge = fs.readdirSync("supabase/functions/provider-intake");
for (const required of ["index.ts","handler.ts","repository.ts","captcha.ts","cors.ts","files.ts","validation.ts","prod-config.ts","prod-config_test.ts"]) {
  if (!edge.includes(required)) fail("missing Edge source: " + required);
}
const edgeText = edge.filter((f) => f.endsWith(".ts")).map((f) => fs.readFileSync(path.join("supabase/functions/provider-intake", f), "utf8")).join("\n");
for (const required of [
  "INTAKE_ALLOW_QUERY_TOKEN", "INTAKE_ALLOWED_ORIGINS", "CAPTCHA_EXPECTED_HOSTNAME",
  "CAPTCHA_EXPECTED_ACTION", "INTAKE_PRIVACY_NOTICE_URL", "intake-uploads",
  "resolve_provider_aware_intake_link_internal", "create_provider_aware_intake_internal",
]) if (!edgeText.includes(required)) fail("missing Edge contract: " + required);
for (const forbidden of ["scsirgbuqjcwoaxfacth", "catalogo-proveedores-flux-git-dev", "Ambiente DEV", "?token=", "notification_outbox", "enqueue_notification", "resend.com"]) {
  if (edgeText.toLowerCase().includes(forbidden.toLowerCase())) fail("forbidden Edge delta: " + forbidden);
}
const nonTestEdge = edge.filter((f) => f.endsWith(".ts") && !f.endsWith("_test.ts") && f !== "prod-config.ts")
  .map((f) => fs.readFileSync(path.join("supabase/functions/provider-intake", f), "utf8")).join("\n");
if (nonTestEdge.includes("1x0000000000000000000000000000000AA")) fail("Turnstile test secret in runtime source");
const prodConfig = fs.readFileSync("supabase/functions/provider-intake/prod-config.ts", "utf8");
if (!prodConfig.includes("TURNSTILE_TEST_SECRETS") || !prodConfig.includes("test_key_forbidden")) fail("Turnstile test-key denylist missing");
if (!fs.readFileSync("supabase/config.toml", "utf8").includes("verify_jwt = false")) fail("public Edge JWT contract missing");
if (manifest.default_mode !== "disabled" || manifest.legal_content_approval_pending !== true) fail("release manifest is not fail-closed");
if (manifest.provider_intake_notification_release_delta !== 0) fail("notification release delta is non-zero");
console.log("PROVIDER_PORTAL_PROD_DB_EDGE_CONTRACT_PASS=true");
`);

const runtimeManifest = {
  schema: "flux.provider-portal-prod-runtime-manifest/v1",
  generated_from_main_sha: SOURCE_MAIN_SHA,
  derived_provider_source_dev_sha: SOURCE_DEV_SHA,
  prod_project: PROD_PROJECT,
  prod_migration_head_at_build: PROD_MIGRATION_HEAD,
  forward_migrations: names.map((name) => ({ name, version: migrations[name].version, file: migrations[name].path })),
  default_mode: "disabled",
  pilot_mode: "sysadmin_only",
  public_valid_link_without_login: true,
  provider_intake_notification_release_delta: 0,
  required_edge_variables: {
    CAPTCHA_PROVIDER: "turnstile",
    CAPTCHA_SECRET: "required_secret_not_committed",
    CAPTCHA_EXPECTED_HOSTNAME: "flux.quantta.mx",
    CAPTCHA_EXPECTED_ACTION: "provider_intake_submit",
    INTAKE_ALLOWED_ORIGINS: "https://flux.quantta.mx",
    INTAKE_ALLOW_NO_ORIGIN: "false",
    INTAKE_ALLOW_QUERY_TOKEN: "false",
    INTAKE_PRIVACY_NOTICE_URL: "required_https_provider_specific_url_not_committed",
    INTAKE_HASH_PEPPER: "required_secret_not_committed",
    SUPABASE_URL: "platform_managed",
    SUPABASE_SERVICE_ROLE_KEY: "platform_managed_secret",
  },
  turnstile_production_secret_configured: false,
  turnstile_production_site_key_configured: false,
  legal_content_approval_pending: true,
  prod_apply_executed: false,
  edge_deploy_executed: false,
};
write("docs/ops/provider-portal-prod-runtime-manifest.json", `${JSON.stringify(runtimeManifest, null, 2)}\n`);

write("docs/ops/provider-portal-prod-db-edge-release.md", `# Provider Portal ? PROD DB/Edge release candidate\n\n- Build base: \`${SOURCE_MAIN_SHA}\`.\n- Provider source reference: \`${SOURCE_DEV_SHA}\`.\n- Target: Supabase PROD \`${PROD_PROJECT}\`; captured migration head \`${PROD_MIGRATION_HEAD}\`.\n- Default mode: \`disabled\`; pilot mode after a separate approval: \`sysadmin_only\`.\n- Public valid-link traffic is anonymous and token-authorized only; disabled mode denies it.\n- Notification delta: **0**. No #286/#282 producer or dispatcher is present.\n\n## Forward-only apply plan (not executed by this PR)\n\n1. Re-run the read-only preflight and verify the target/head have not moved.\n2. Review and merge this PR only with Ram?n's explicit authorization.\n3. Apply T1 ? T2 ? T3 ? T4 exactly once while the runtime remains \`disabled\`.\n4. Confirm schema, grants, RLS, row counts, bucket material contract, and migration ledger.\n5. Configure approved production-only Edge secrets without reading them back.\n6. Deploy \`provider-intake\` with \`verify_jwt=false\`; the function enforces token auth and strict origin/CAPTCHA itself.\n7. Keep mode \`disabled\` until the Product PR, approved privacy notice, production Turnstile site/secret, and deployment checks are complete.\n\n## P0 release blockers intentionally left open\n\n- Production Turnstile secret/site key are not configured by this candidate.\n- Provider-intake-specific legal notice is not approved or published.\n- No migration, Edge deployment, mode change, link, intake, or submit has been executed.\n`);

const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const candidateManifest = {
  schema: "flux.provider-portal-prod-db-edge-candidate/v1",
  generated_from_main_sha: SOURCE_MAIN_SHA,
  derived_provider_source_dev_sha: SOURCE_DEV_SHA,
  migrations: names.map((name) => ({ ...migrations[name], sha256: digest(migrations[name].path) })),
  edge_files: [...edgePaths, "supabase/functions/provider-intake/prod-config.ts", "supabase/functions/provider-intake/prod-config_test.ts"]
    .filter((value, index, list) => list.indexOf(value) === index).sort(),
  notification_release_delta: 0,
};
write("docs/ops/provider-portal-prod-db-edge-candidate.json", `${JSON.stringify(candidateManifest, null, 2)}\n`);

console.log(JSON.stringify({ generated: true, versions, sourceMain: SOURCE_MAIN_SHA, sourceDev: SOURCE_DEV_SHA }));
