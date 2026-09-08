-- Make the invitation-link boundary explicit and cover access-request foreign keys.

drop policy if exists company_access_links_no_direct_access
  on public.company_access_links;

create policy company_access_links_no_direct_access
  on public.company_access_links
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create index if not exists company_access_requests_company_id_idx
  on public.company_access_requests (company_id);

create index if not exists company_access_requests_reviewed_by_idx
  on public.company_access_requests (reviewed_by)
  where reviewed_by is not null;
