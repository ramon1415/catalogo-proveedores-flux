-- Forward-only correction: authorization follows active company memberships.
-- Global sysadmins retain access for platform administration.
do $$
begin
  if to_regprocedure('private.current_profile_has_company_role(uuid,text[])') is null then
    raise exception 'private.current_profile_has_company_role(uuid,text[]) is required';
  end if;
end
$$;

alter table public.historical_actuals enable row level security;
alter table public.historical_actuals force row level security;

drop policy if exists historical_actuals_select_finance
  on public.historical_actuals;

create policy historical_actuals_select_finance
  on public.historical_actuals
  for select
  to authenticated
  using (
    (select public.current_user_has_role(
      array['sysadmin','system_admin','superadmin']::text[]
    ))
    or private.current_profile_has_company_role(
      company_id,
      array['finance','director']::text[]
    )
  );

revoke all on table public.historical_actuals from anon;
grant select on table public.historical_actuals to authenticated;
grant select, insert, update, delete on table public.historical_actuals to service_role;

comment on policy historical_actuals_select_finance
  on public.historical_actuals is
  'Company-scoped read for active finance/director memberships; global sysadmin fallback.';
