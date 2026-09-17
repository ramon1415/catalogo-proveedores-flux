-- The first scheduler tick checks the deployed worker without sending email.
-- This validates secrets/configuration without making the dispatcher callable by end users.
alter table private.weekly_request_digest_settings add column preflight_request_id bigint;
alter table private.weekly_request_digest_settings add column preflight_requested_at timestamptz;
create or replace function private.wake_weekly_request_digest(p_dry_run boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; secret_value text; s private.weekly_request_digest_settings%rowtype; request_id bigint;
begin
 select * into s from private.weekly_request_digest_settings where singleton for update;
 if not found or not s.enabled then return null; end if;
 if s.preflight_request_id is null then p_dry_run:=true; end if;
 if not p_dry_run and s.next_cutoff>now() and not exists(select 1 from private.weekly_request_digest_runs where status in ('pending','processing') and (lease_until is null or lease_until<=now())) then return null; end if;
 select max(decrypted_secret) filter(where name='notification_payment_outcome_dispatcher_url'),max(decrypted_secret) filter(where name='notification_dispatcher_secret')
 into endpoint,secret_value from vault.decrypted_secrets where name in ('notification_payment_outcome_dispatcher_url','notification_dispatcher_secret');
 if endpoint is distinct from 'https://'||s.project_ref||'.supabase.co/functions/v1/notification-dispatcher' or nullif(secret_value,'') is null then raise exception 'DIGEST_DISPATCHER_CONFIGURATION_INVALID'; end if;
 select net.http_post(url:=replace(endpoint,'/notification-dispatcher','/weekly-request-digest'),
 body:=jsonb_build_object('dry_run',p_dry_run),headers:=jsonb_build_object('Content-Type','application/json','x-notification-dispatcher-secret',secret_value),timeout_milliseconds:=10000) into request_id;
 if p_dry_run then update private.weekly_request_digest_settings set preflight_request_id=request_id,preflight_requested_at=now() where singleton; end if;
 return request_id;
end;
$$;
revoke all on function private.wake_weekly_request_digest(boolean) from public,anon,authenticated;
