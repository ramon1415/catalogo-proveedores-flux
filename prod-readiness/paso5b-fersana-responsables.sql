-- Prod · Seed de RESPONSABLES por partida de Fersana (60 de 60).
-- Requiere la migración 20260831130000 (columna responsible_email) aplicada.
-- Correos observados en DEV: Yulma=ychavez@fluxfinanciera.com, Lis=lisette@dezdez.earth,
-- Yanin=ynavarrete@soportef.com, Alfredo=afajardo@soportef.com y
-- Contabilidad=contabilidad2@soportef.com. Confirmar la lista en el gate GO/NO-GO.

update public.company_cost_center_budget_categories rel
set responsible_email = d.email
from (values
  ('Renta', 'afajardo@soportef.com'),
  ('Mantenimiento Inmueble', 'afajardo@soportef.com'),
  ('Reparacion y Mantto Bluepath', 'afajardo@soportef.com'),
  ('Luz', 'afajardo@soportef.com'),
  ('Dispensador de Agua', 'afajardo@soportef.com'),
  ('Enseres', 'afajardo@soportef.com'),
  ('Seguros de Gastos Médicos', 'ynavarrete@soportef.com'),
  ('Gastos de Viaje', 'ynavarrete@soportef.com'),
  ('Vales de Gasolina (Reembolso no gasto)', 'ynavarrete@soportef.com'),
  ('Correos y Mensajeria', 'ynavarrete@soportef.com'),
  ('Comisiones Efectivale', 'ynavarrete@soportef.com'),
  ('Servicio de Escolta', 'ynavarrete@soportef.com'),
  ('Google y MS Office', 'ynavarrete@soportef.com'),
  ('Activos Fijos Menores Bluepath', 'ychavez@fluxfinanciera.com'),
  ('Bolsas de empleo (OCC, Computrabajo)', 'ychavez@fluxfinanciera.com'),
  ('LinkedIn', 'ychavez@fluxfinanciera.com'),
  ('Evaluatest', 'ychavez@fluxfinanciera.com'),
  ('Estudios socioeconomicos', 'ychavez@fluxfinanciera.com'),
  ('Kits de bienvenida onboarding', 'ychavez@fluxfinanciera.com'),
  ('Capacitación interna', 'ychavez@fluxfinanciera.com'),
  ('Curso brigadistas', 'ychavez@fluxfinanciera.com'),
  ('Cursos primeros auxilios', 'ychavez@fluxfinanciera.com'),
  ('Capacitación técnica', 'ychavez@fluxfinanciera.com'),
  ('Membresía B-Salud', 'ychavez@fluxfinanciera.com'),
  ('Talleres bienestar', 'ychavez@fluxfinanciera.com'),
  ('Actividades de voluntariado', 'ychavez@fluxfinanciera.com'),
  ('Convivios( San Valentín, Independencia)', 'ychavez@fluxfinanciera.com'),
  ('Regalos día del padre', 'ychavez@fluxfinanciera.com'),
  ('Regalos día de las madres', 'ychavez@fluxfinanciera.com'),
  ('Pasteles', 'ychavez@fluxfinanciera.com'),
  ('Snacks saludables viernes', 'ychavez@fluxfinanciera.com'),
  ('Kits de identidad', 'ychavez@fluxfinanciera.com'),
  ('Actividades de integración', 'ychavez@fluxfinanciera.com'),
  ('Evento de fin de año', 'ychavez@fluxfinanciera.com'),
  ('Café', 'ychavez@fluxfinanciera.com'),
  ('Papelería', 'ychavez@fluxfinanciera.com'),
  ('Adornos oficina', 'ychavez@fluxfinanciera.com'),
  ('Equipos de cómputo nuevos integrantes', 'ychavez@fluxfinanciera.com'),
  ('Diseño comunicación interna', 'ychavez@fluxfinanciera.com'),
  ('Fotos profesionales colaboradores', 'ychavez@fluxfinanciera.com'),
  ('Aseoría Recursos Humanos', 'ychavez@fluxfinanciera.com'),
  ('Asesoría laboral', 'ychavez@fluxfinanciera.com'),
  ('Worky plataforma', 'ychavez@fluxfinanciera.com'),
  ('Worky maquila', 'ychavez@fluxfinanciera.com'),
  ('Comisiones Bancarias', 'contabilidad2@soportef.com'),
  ('Depreciaciones', 'contabilidad2@soportef.com'),
  ('Renta Servidor y Mtto.', 'contabilidad2@soportef.com'),
  ('Actualización y Mtto. Contpaq', 'contabilidad2@soportef.com'),
  ('Partidas no Deducibles', 'contabilidad2@soportef.com'),
  ('Servicios notariales y auditoría', 'lisette@dezdez.earth'),
  ('Iguala Blanco Carrillo', 'lisette@dezdez.earth'),
  ('Viajes Transporte', 'lisette@dezdez.earth'),
  ('Congresos', 'lisette@dezdez.earth'),
  ('Viajes T&E (Hospedaje, Comidas)', 'lisette@dezdez.earth'),
  ('Pagina Web Dezdez & Branding Material', 'lisette@dezdez.earth'),
  ('Plataforma de Portfolio Management', 'lisette@dezdez.earth'),
  ('Offsite Equipo Directivo', 'lisette@dezdez.earth'),
  ('Comidas Representación', 'lisette@dezdez.earth'),
  ('Consultoria Medicion de Impacto', 'lisette@dezdez.earth'),
  ('Otros', 'lisette@dezdez.earth')
) d(cat_name, email)
join public.budget_categories bc on bc.name = d.cat_name
join public.companies c on c.rfc = 'SFE100825TM9'
where rel.budget_category_id = bc.id and rel.company_id = c.id;
-- Fix: 'Gastos Automatización' (SF-2026-060) = el 'Otros' de Lis en el modelo nuevo.
update company_cost_center_budget_categories rel set responsible_email='lisette@dezdez.earth'
from budget_categories bc, companies c
where rel.budget_category_id=bc.id and rel.company_id=c.id and c.rfc='SFE100825TM9' and bc.code='SF-2026-060';

do $$
declare
  v_total bigint;
  v_with_email bigint;
begin
  select count(*), count(*) filter (where nullif(btrim(rel.responsible_email), '') is not null)
    into v_total, v_with_email
  from company_cost_center_budget_categories rel
  join companies c on c.id = rel.company_id
  join cost_centers cc on cc.id = rel.cost_center_id
  where c.rfc = 'SFE100825TM9'
    and cc.code = 'SF'
    and rel.active;

  if v_total <> 60 or v_with_email <> 60 then
    raise exception 'fersana_responsible_postcheck_failed: total=%, with_email=%', v_total, v_with_email;
  end if;
end;
$$;
