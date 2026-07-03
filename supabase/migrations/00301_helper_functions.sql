-- Flux Operadora - Migracion 003a
-- Funciones: current_profile_id, current_user_has_role, flux_sysadmin_roles, flux_finance_roles, flux_approver_roles, flux_member_roles

CREATE OR REPLACE FUNCTION public.current_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  select p.id

  from public.profiles p

  where p.auth_user_id = auth.uid()

    and coalesce(p.active, true) = true

  limit 1;

$function$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  select exists (

    select 1

    from public.user_roles ur

    join public.roles r on r.id = ur.role_id

    where ur.profile_id = public.current_profile_id()

      and lower(

        coalesce(

          to_jsonb(r)->>'name',

          to_jsonb(r)->>'nombre',

          to_jsonb(r)->>'role_name'

        )

      ) = any (

        select lower(x)

        from unnest(p_roles) as x

      )

  );

$function$;

CREATE OR REPLACE FUNCTION public.flux_sysadmin_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ARRAY['sysadmin','system_admin','admin','superadmin']
$function$;

CREATE OR REPLACE FUNCTION public.flux_finance_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public.flux_sysadmin_roles() ||
         ARRAY['finance','finanzas','treasury','tesoreria','administracion']
$function$;

CREATE OR REPLACE FUNCTION public.flux_approver_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public.flux_finance_roles() ||
         ARRAY['approver_2','aprobador_2','direccion','director']
$function$;

CREATE OR REPLACE FUNCTION public.flux_member_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public.flux_approver_roles() ||
         ARRAY['solicitante','operator','default','seller','celebraciones','producciones','planner']
$function$;
