-- Export of the migration already applied in PROD via Supabase on 2026-09-23.
-- Approved-only selection applies equally to the email and attached PDF.
CREATE OR REPLACE FUNCTION private.weekly_request_digest_document(p_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select jsonb_build_object('id',p_id,'environment',s.environment,'recipient',s.recipient,
 'period_start',p_start,'period_end',p_end,'rows',coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',r.id,'folio',coalesce(r.request_number,r.id::text),'company',c.name,
   'beneficiary',coalesce(bp.full_name,p.alias,p.nombre_completo,rq.full_name,'Sin beneficiario'),
   'description',coalesce(r.description,r.concept,''),'cost_center',coalesce(cc.code||' - ','')||coalesce(cc.name,'Sin centro'),
   'category',case when bc.name='Sin partida' then 'Sin partida'||case when nullif(r.sin_partida_description,'') is not null then ' ('||r.sin_partida_description||')' else '' end else coalesce(bc.code||' - ','')||coalesce(bc.name,'Sin partida') end,
   'amount_minor',coalesce(round(r.amount_requested*100),0)::bigint,'currency',upper(coalesce(nullif(r.currency,''),'MXN')),
   'status',r.status,'request_type',r.request_type,'requester',coalesce(rq.full_name,'Sin solicitante'),'created_at',r.created_at
  ) order by c.name,r.created_at,r.id)
  from public.payment_requests r join public.companies c on c.id=r.company_id
  left join public.proveedores p on p.id=r.proveedor_id
  left join public.profiles bp on bp.id=r.beneficiary_profile_id
  left join public.profiles rq on rq.id=r.requested_by
  left join public.cost_centers cc on cc.id=r.cost_center_id
  left join public.budget_categories bc on bc.id=r.budget_category_id
  where r.created_at>=p_start and r.created_at<p_end
   and c.name in ('Operadora Tlacatecpan','Soporte Fersana')
   and r.status::text='approved'
   and coalesce(r.exception_status,'')<>'rejected'
   and not exists(select 1 from public.approval_batch_items i where i.payment_request_id=r.id
     and i.removed_at is null and i.director_status='rejected' and coalesce(i.rebatch_status,'')<>'released')
 ),'[]'::jsonb)) from private.weekly_request_digest_settings s where singleton;
$function$
