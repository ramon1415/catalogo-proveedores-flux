-- Prod · Seed de RESPONSABLES por partida de Fersana (54 de 60; faltan 5 de Gerardo, sin correo).
-- Requiere la migración 20260831130000 (columna responsible_email) aplicada.
-- Correos: Yulma=ychavez@fluxfinanciera.com (CONFIRMAR vs @soportef.com), Lis=lisette@dezdez.earth,
--          Yanin=ynavarrete@soportef.com, Alfredo=afajardo@soportef.com.

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
