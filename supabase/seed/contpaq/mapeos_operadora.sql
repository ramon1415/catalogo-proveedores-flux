-- Semilla de mapeos partida→cuenta · Operadora Tlacatecpan
-- Generado por scripts/generar_seed_mapeos.mjs — NO editar a mano.
-- Fuente: data/seed/mapeos_operadora.json (export de DEV, 87 mapeos aplicados y validados)
-- sha256 fuente: 1a5d5d0c35bf6838b6f3bc0aa465378fff84859e152321761131e94dfd4fa4c2
-- Método derivado: 22 nombre_exacto · 65 criterio · 6 needs_review
-- Validado contra el árbol: las 63 cuentas distintas existen, son hoja, son de
-- detalle (CtaMayor=2) y son de naturaleza gasto (tipo=G). Sin doble conteo.
-- Reemplazar :company_id antes de ejecutar.

insert into budget_account_mappings (company_id, budget_category_id, contpaq_account_code, needs_review)
values
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-101' limit 1), '60204005000', false),  -- criterio · Alimento de animales → Consumibles Animales
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-102' limit 1), '60208005000', false),  -- criterio · Herrajes → Mantenimiento caballos
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-100' limit 1), '60204002000', false),  -- nombre_exacto · Veterinario → Veterinario
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-107' limit 1), '60207004000', false),  -- criterio · Aportacionea a la comunidad → Vinculación comunitaria
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-105' limit 1), '60207003000', false),  -- nombre_exacto · Aportaciones Consumo Electrico → Aportaciones Consumo Electrico
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-106' limit 1), '60207002000', false),  -- nombre_exacto · Aportaciones Monjas → Aportaciones Monjas
  (:company_id, (select id from budget_categories where code = '602-08-011-000' limit 1), '60202012000', false),  -- criterio · Arrendamiento Pick Up JAC → Renta Automóvil
  (:company_id, (select id from budget_categories where code = '602-08-003-000' limit 1), '60204012000', false),  -- nombre_exacto · Combustible Campo → Combustible Campo
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-073' limit 1), '60204011000', false),  -- nombre_exacto · Combustible Casa grande → Combustible Casa Grande
  (:company_id, (select id from budget_categories where code = '602-08-004-000' limit 1), '60204013000', false),  -- nombre_exacto · Combustible Seguridad → Combustible Seguridad
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-092' limit 1), '60208001000', false),  -- criterio · Aulado de cortinas → Mantenimiento blancos y manteleria
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-087' limit 1), '60208001000', false),  -- criterio · cobija electricas → Mantenimiento blancos y manteleria
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-093' limit 1), '60208001000', false),  -- criterio · colchones → Mantenimiento blancos y manteleria
  (:company_id, (select id from budget_categories where code = '602-08-018-000' limit 1), '60206001000', false),  -- criterio · cristaleria → Compra de Cristaleria y Art. de Cocina
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-091' limit 1), '60208001000', false),  -- criterio · edredones → Mantenimiento blancos y manteleria
  (:company_id, (select id from budget_categories where code = '602-09-000-000' limit 1), '60208001000', false),  -- criterio · manteleria → Mantenimiento blancos y manteleria
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-094' limit 1), '60202009000', false),  -- criterio · Renovación equipo de computo Oficina → Mantenimiento Eqpo. de Computo
  (:company_id, (select id from budget_categories where code = '602-08-012-000' limit 1), '60208001000', false),  -- criterio · toallas → Mantenimiento blancos y manteleria
  (:company_id, (select id from budget_categories where code = 'OP-003' limit 1), '60202002000', true),  -- criterio · Gastos extraordinarios → Gastos Corporativos
  (:company_id, (select id from budget_categories where code = '602-02-002-000' limit 1), '60382000005', false),  -- criterio · Licencias de Software → Renta de Software
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-034' limit 1), '60202003000', false),  -- criterio · Mantenimiento Corporativo (Legal) → Gastos Legales
  (:company_id, (select id from budget_categories where code = '602-02-001-000' limit 1), '60202006000', true),  -- criterio · Servicios de Personal → Worky
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-035' limit 1), '60332000000', false),  -- criterio · Servicios Financieros y Contables → Servicios Contables
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-031' limit 1), '60203004000', false),  -- nombre_exacto · Servicio Seguridad → Servicio Seguridad
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-110' limit 1), '60205001000', false),  -- nombre_exacto · Adquisiciòn de herramientas → Adquisiciòn de herramientas
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-111' limit 1), '60277000000', false),  -- criterio · Adquisiciòn de uniformes → Uniformes
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-113' limit 1), '60202010000', false),  -- criterio · Reparación / compra electrodomésticos → Activos Menores
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-112' limit 1), '60205002000', false),  -- nombre_exacto · Reparacion de herramienta → Reparacion de herramienta
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-040' limit 1), '60204014000', false),  -- nombre_exacto · Articulos de limpieza → Articulos de limpieza
  (:company_id, (select id from budget_categories where code = '602-04-011-000' limit 1), '60256000000', false),  -- criterio · Mantenimiento alberca → Mantenimiento y conservación
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-048' limit 1), '60208010000', false),  -- nombre_exacto · Mantenimiento bombas → Mantenimiento bombas
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-059' limit 1), '60208015000', false),  -- criterio · Mantenimiento camaras → Mantenimiento Eqpo. de Comunicacion
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-050' limit 1), '60256000000', false),  -- criterio · Mantenimiento copetes alberca → Mantenimiento y conservación
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-052' limit 1), '60205003000', false),  -- criterio · mantenimiento cortadoras grandes → Herramientas de jardineria
  (:company_id, (select id from budget_categories where code = '602-03-004-000' limit 1), '60208008000', false),  -- criterio · Mantenimiento de lavadoras y secadoras → Mantenimiento Lavanderia
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-045' limit 1), '60208009000', false),  -- criterio · Mantenimiento equipos refrigeración → Mantto equipos refrigeración
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-057' limit 1), '60208017000', false),  -- nombre_exacto · Mantenimiento invernadero → Mantenimiento invernadero
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-055' limit 1), '60208017000', false),  -- nombre_exacto · Mantenimiento Invernadero → Mantenimiento invernadero
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-054' limit 1), '60208014000', false),  -- criterio · Mantenimiento Motos → Mantenimiento Moto
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-053' limit 1), '60208011000', false),  -- nombre_exacto · Mantenimiento pintura → Mantenimiento pintura
  (:company_id, (select id from budget_categories where code = '602-05-001-000' limit 1), '60208018000', false),  -- criterio · Mantenimiento Planta de emergencia → Mantenimeinto Planta de emergencia
  (:company_id, (select id from budget_categories where code = '602-04-012-000' limit 1), '60208018000', false),  -- criterio · Mantenimiento planta de luz → Mantenimeinto Planta de emergencia
  (:company_id, (select id from budget_categories where code = '602-03-000-000' limit 1), '60208002000', false),  -- nombre_exacto · Mantenimiento Pozos → Mantenimiento Pozos
  (:company_id, (select id from budget_categories where code = '602-03-005-000' limit 1), '60208004000', false),  -- nombre_exacto · Mantenimiento tractores → Mantenimiento tractores
  (:company_id, (select id from budget_categories where code = '602-04-006-000' limit 1), '60208019000', false),  -- criterio · Mantenimiento trasformadores → Infraestructura e instalaciones
  (:company_id, (select id from budget_categories where code = '602-03-001-000' limit 1), '60207005000', false),  -- nombre_exacto · Mantenimiento Vehiculos → Mantenimiento Vehìculos
  (:company_id, (select id from budget_categories where code = '602-05-000-000' limit 1), '60208016000', false),  -- nombre_exacto · Mantenimineto Extintores → Mantenimineto Extintores
  (:company_id, (select id from budget_categories where code = '602-04-005-000' limit 1), '60208010000', false),  -- criterio · Mantto equipos hidroneumáticos → Mantenimiento bombas
  (:company_id, (select id from budget_categories where code = 'OP-001' limit 1), '60256000000', false),  -- criterio · Mantenimiento general → Mantenimiento y conservación
  (:company_id, (select id from budget_categories where code = 'OP-002' limit 1), '60204017000', true),  -- criterio · Servicios y suministros → Consumibles Campo
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-116' limit 1), '60204004000', false),  -- nombre_exacto · Peajes → Peajes
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-097' limit 1), '60207007000', false),  -- criterio · Prediales 2026 → Prediales
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-068' limit 1), '60208019000', false),  -- criterio · cambio de techo de oficina → Infraestructura e instalaciones
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-063' limit 1), '60205001000', false),  -- criterio · Compra de desmalezadoras → Adquisiciòn de herramientas
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-064' limit 1), '60202010000', false),  -- criterio · compra de lavadora y/o secadora → Activos Menores
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-062' limit 1), '60205001000', false),  -- criterio · compra de podadora → Adquisiciòn de herramientas
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-066' limit 1), '60205001000', false),  -- criterio · cortadora de pasto grande → Adquisiciòn de herramientas
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-065' limit 1), '60208011000', false),  -- criterio · pintura de alberca → Mantenimiento pintura
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-069' limit 1), '60208019000', false),  -- criterio · remplazamiento de tanque de gas → Infraestructura e instalaciones
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-067' limit 1), '60208019000', false),  -- criterio · Suministro y colocacion Cámaras Casa Barbara → Infraestructura e instalaciones
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-070' limit 1), '60208019000', false),  -- criterio · Sustitución vigas Casa Lorenzo → Infraestructura e instalaciones
  (:company_id, (select id from budget_categories where code = 'REC-RSJT-2026-001' limit 1), '60204016000', false),  -- criterio · Gastos visitas rancho → Gastos por recuperar
  (:company_id, (select id from budget_categories where code = '602-01-006-000' limit 1), '60201006000', false),  -- nombre_exacto · Aguinaldos → Aguinaldos
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-013' limit 1), '60201002000', true),  -- criterio · Carga Social (IMSS, Infonavit, AFORES) → Cuota Patronal IMSS
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-018' limit 1), '60202007000', false),  -- criterio · Cartas antecedentes No Penales → Gestión de Tramites
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-020' limit 1), '60201007000', false),  -- criterio · Cursos Externos de Capacitación → Capacitaciones
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-026' limit 1), '60202003000', false),  -- criterio · Elaboracion e inscripción Reglamento Trabajo → Gastos Legales
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-019' limit 1), '60217000000', false),  -- criterio · Exámenes médicos → Servicio médico
  (:company_id, (select id from budget_categories where code = '602-01-005-000' limit 1), '60201005000', false),  -- criterio · Finiquitos o liquidaciones → Liquidaciones
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-025' limit 1), '60201008000', true),  -- criterio · Identificadores → Apoyo a personal
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-014' limit 1), '60201004000', false),  -- criterio · ISN → Impuesto Sobre Nomina
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-015' limit 1), '60202005000', true),  -- criterio · ISR → Impuestos
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-021' limit 1), '60201007000', false),  -- criterio · Materiales para Capacitación → Capacitaciones
  (:company_id, (select id from budget_categories where code = '602-01-001-000' limit 1), '60201001000', false),  -- criterio · Nómina → Sueldos
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-023' limit 1), '60382000002', false),  -- criterio · Posada → Gastos de fin de Año
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-016' limit 1), '60201014000', false),  -- criterio · Primas vacacionales → Prov. P. Vacacional
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-017' limit 1), '60382000004', false),  -- criterio · Reclutamiento en Campo → Reclutamiento de Personal
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-022' limit 1), '60201008000', false),  -- criterio · Reconocimientos por desempeño → Apoyo a personal
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-024' limit 1), '60382000002', false),  -- criterio · Regalos fin de año → Gastos de fin de Año
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-027' limit 1), '60202006000', false),  -- criterio · Software RRHH → Worky
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-010' limit 1), '60201010000', false),  -- nombre_exacto · Vales de despensa → Vales de despensa
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-028' limit 1), '60249000000', false),  -- criterio · Viáticos RRHH → Viáticos y gastos de viaje
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-119' limit 1), '60208020000', false),  -- criterio · Seguros vehículos → Seguros Equipo de Transporte
  (:company_id, (select id from budget_categories where code = '602-08-006-000' limit 1), '60252000000', false),  -- criterio · CFE → Energía eléctrica
  (:company_id, (select id from budget_categories where code = '602-08-007-000' limit 1), '60204003000', false),  -- nombre_exacto · Consumo Gas → Consumo Gas
  (:company_id, (select id from budget_categories where code = 'AUTO-RSJT-2026-ROW-078' limit 1), '60207009000', false),  -- criterio · sky → Televisión
  (:company_id, (select id from budget_categories where code = '602-08-005-000' limit 1), '60207008000', false)  -- criterio · Telmex → Comunicaciones
on conflict (company_id, budget_category_id, contpaq_account_code) do nothing;
