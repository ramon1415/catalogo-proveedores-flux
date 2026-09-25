-- Recreated RPCs must preserve the existing PROD execution boundary.
-- Run in the same release transaction as the six multipartida migrations.
begin;

revoke all on function public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,boolean,jsonb) from public, anon;
grant execute on function public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,boolean,jsonb) to authenticated, service_role;

revoke all on function public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,jsonb) from public, anon;
grant execute on function public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,jsonb) to authenticated, service_role;

revoke all on function public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,boolean,jsonb) from public, anon;
grant execute on function public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,boolean,jsonb) to authenticated, service_role;

commit;
