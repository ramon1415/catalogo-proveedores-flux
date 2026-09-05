begin;

do $precheck$
begin
  if not exists (
    select 1 from public.companies
    where id='144042c1-e493-4256-a86c-cd088a8898ce'::uuid
      and name='Operadora Tlacatecpan'
      and active
  ) or not exists (
    select 1 from public.companies
    where id='20cd72aa-f281-4985-931b-a83422404b66'::uuid
      and name='Soporte Fersana'
      and active
  ) then
    raise exception 'partida_prediction_company_identity_mismatch';
  end if;
end
$precheck$;

insert into public.partida_predictions
  (company_id, rfc_emisor, cuenta_gasto_dominante, share_dominante, n_cfdis, partida_candidates, is_confident)
values
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SFE100825TM9', '60202002000', 0.6187, 104, '[{"budget_category_id": "02c30f4a-c8cb-4266-b537-a4fc694a5ac3", "name": "Gastos extraordinarios"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ZME171011K13', '60203004000', 1.0, 45, '[{"budget_category_id": "86e95420-e37b-499d-978b-4ac8c162e56e", "name": "Servicio Seguridad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'NWM9709244W4', '60204014000', 0.4565, 34, '[{"budget_category_id": "07773ec4-a401-4330-9816-6047d7eb8df8", "name": "Articulos de limpieza"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'PCE1710038M4', '60204004000', 1.0, 32, '[{"budget_category_id": "aa5e01fd-37ec-4d48-9baf-8bc2e05557af", "name": "Peajes"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'WOR171123FG8', '60202006000', 1.0, 26, '[{"budget_category_id": "10589295-a66b-408e-93bc-43c3198ea755", "name": "Servicios de Personal"}, {"budget_category_id": "255d9610-798d-4462-9231-51b308e2d883", "name": "Software RRHH"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ROJA670908J9A', '60205001000', 0.3333, 25, '[{"budget_category_id": "2307cdd1-b006-42fd-891f-c4242a119601", "name": "Adquisiciòn de herramientas"}, {"budget_category_id": "ec50ec34-428e-4dc2-8c49-112ca4000d8b", "name": "Compra de desmalezadoras"}, {"budget_category_id": "c7a87628-5797-4bf3-b49e-9aa651ebecdc", "name": "compra de podadora"}, {"budget_category_id": "b17bf95a-8cb2-4ce4-8e73-176e5e1f3e75", "name": "cortadora de pasto grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CLA180313MU7', '60204005000', 1.0, 24, '[{"budget_category_id": "6a279d68-650a-4d8d-b76f-a69a270f9d57", "name": "Alimento de animales"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CBA160804R80', '60202012000', 1.0, 19, '[{"budget_category_id": "78ec5e0f-79b2-4dc3-98ed-ad36de201197", "name": "Arrendamiento Pick Up JAC"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GABN810612UV3', '60204005000', 0.85, 19, '[{"budget_category_id": "6a279d68-650a-4d8d-b76f-a69a270f9d57", "name": "Alimento de animales"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'FULA910514EC7', '60208004000', 0.5833, 16, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'HDM001017AS1', '60205001000', 0.2105, 15, '[{"budget_category_id": "2307cdd1-b006-42fd-891f-c4242a119601", "name": "Adquisiciòn de herramientas"}, {"budget_category_id": "ec50ec34-428e-4dc2-8c49-112ca4000d8b", "name": "Compra de desmalezadoras"}, {"budget_category_id": "c7a87628-5797-4bf3-b49e-9aa651ebecdc", "name": "compra de podadora"}, {"budget_category_id": "b17bf95a-8cb2-4ce4-8e73-176e5e1f3e75", "name": "cortadora de pasto grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'TPT890516JP5', '60207009000', 1.0, 15, '[{"budget_category_id": "0283da92-6e75-41ac-ae46-3047565b4a04", "name": "sky"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AUSI600201CC2', '60208011000', 0.8571, 12, '[{"budget_category_id": "97ff81d9-072e-41ed-8451-cbcc54278d80", "name": "Mantenimiento pintura"}, {"budget_category_id": "29a2d47d-db9e-4489-8d57-c348c809b7aa", "name": "pintura de alberca"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CCF121101KQ4', '60204004000', 0.1579, 11, '[{"budget_category_id": "aa5e01fd-37ec-4d48-9baf-8bc2e05557af", "name": "Peajes"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SGA931013440', '60204003000', 1.0, 11, '[{"budget_category_id": "5b293b4a-6528-4282-bc19-91d55e5971b0", "name": "Consumo Gas"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'BLU030710A50', '60208019000', 0.5, 8, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'BUAA820827NS8', '60204014000', 1.0, 8, '[{"budget_category_id": "07773ec4-a401-4330-9816-6047d7eb8df8", "name": "Articulos de limpieza"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'COLG550830NZ8', '60208019000', 1.0, 8, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'DGC170313257', '60204004000', 1.0, 8, '[{"budget_category_id": "aa5e01fd-37ec-4d48-9baf-8bc2e05557af", "name": "Peajes"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'FULA950107TQ2', '60208004000', 0.8889, 8, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'REDJ931122639', '60208004000', 0.5714, 8, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'TBO140305DH0', '60207009000', 1.0, 8, '[{"budget_category_id": "0283da92-6e75-41ac-ae46-3047565b4a04", "name": "sky"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'HEFM640904TS0', '60208019000', 0.7143, 7, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SPI921209935', '60204011000', 1.0, 7, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CAVL710818ET4', '60204011000', 0.1429, 6, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CCR190809G71', '60204003000', 0.8333, 6, '[{"budget_category_id": "5b293b4a-6528-4282-bc19-91d55e5971b0", "name": "Consumo Gas"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ECE111116MP2', '60204003000', 1.0, 6, '[{"budget_category_id": "5b293b4a-6528-4282-bc19-91d55e5971b0", "name": "Consumo Gas"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SPL130430175', '60204011000', 1.0, 5, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AASH730505RW8', '60204014000', 1.0, 4, '[{"budget_category_id": "07773ec4-a401-4330-9816-6047d7eb8df8", "name": "Articulos de limpieza"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'BTE940323Q97', '60208010000', 0.5, 4, '[{"budget_category_id": "027c9650-3dc8-4871-874f-d7ce7e3d170b", "name": "Mantenimiento bombas"}, {"budget_category_id": "45496536-902b-4d6c-b6f0-528462e943f9", "name": "Mantto equipos hidroneumáticos"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MARF3309137P8', '60208019000', 1.0, 4, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AME970109GW0', '60208004000', 0.6, 3, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ASE901221SM4', '60208020000', 1.0, 3, '[{"budget_category_id": "7cff5f60-65c5-492c-ab75-1225b026c800", "name": "Seguros vehículos"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CME910715UB9', '60202006000', 0.25, 3, '[{"budget_category_id": "10589295-a66b-408e-93bc-43c3198ea755", "name": "Servicios de Personal"}, {"budget_category_id": "255d9610-798d-4462-9231-51b308e2d883", "name": "Software RRHH"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'TCH850701RM1', '60204014000', 0.6667, 3, '[{"budget_category_id": "07773ec4-a401-4330-9816-6047d7eb8df8", "name": "Articulos de limpieza"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AMC1301318Q1', '60204011000', 0.5, 2, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AOCM6809288X1', '60207005000', 0.5, 2, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CFR5604255C9', '60208019000', 1.0, 2, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CLV0602102I4', '60207005000', 1.0, 2, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CUBL8308142V6', '60207005000', 0.5, 2, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'DCL121128AC9', '60207004000', 1.0, 2, '[{"budget_category_id": "19a5d65a-0ed0-4bf9-b35a-177d88317a7d", "name": "Aportacionea a la comunidad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GEM850101BJ3', '60202005000', 1.0, 2, '[{"budget_category_id": "23e74fe4-b65d-4d13-bcdc-c2b46589bd4c", "name": "ISR"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GUR080409BCA', '60204011000', 1.0, 2, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'INF891031LT4', '60208004000', 0.5, 2, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MACM850116QJA', '60203004000', 0.5, 2, '[{"budget_category_id": "86e95420-e37b-499d-978b-4ac8c162e56e", "name": "Servicio Seguridad"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MACR650831TX7', '60208005000', 1.0, 2, '[{"budget_category_id": "68ae779a-12a9-4286-aea3-5a4d8d4c0b22", "name": "Herrajes"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MAGF9405079B5', '60208004000', 1.0, 2, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MOPD800626AG4', '60207005000', 1.0, 2, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'NCL150130CI2', '60204004000', 0.2, 2, '[{"budget_category_id": "aa5e01fd-37ec-4d48-9baf-8bc2e05557af", "name": "Peajes"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'NUBR480728599', '60202003000', 0.5, 2, '[{"budget_category_id": "06ff1e28-2a4c-4598-b453-9cadeb0c0553", "name": "Elaboracion e inscripción Reglamento Trabajo"}, {"budget_category_id": "d86f9275-e47e-4075-a19d-d9a198ea396d", "name": "Mantenimiento Corporativo (Legal)"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'OEMP560124B96', '60207005000', 0.5, 2, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SAIC620502EZ8', '60208004000', 1.0, 2, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SALM720822MG8', '60205001000', 0.5, 2, '[{"budget_category_id": "2307cdd1-b006-42fd-891f-c4242a119601", "name": "Adquisiciòn de herramientas"}, {"budget_category_id": "ec50ec34-428e-4dc2-8c49-112ca4000d8b", "name": "Compra de desmalezadoras"}, {"budget_category_id": "c7a87628-5797-4bf3-b49e-9aa651ebecdc", "name": "compra de podadora"}, {"budget_category_id": "b17bf95a-8cb2-4ce4-8e73-176e5e1f3e75", "name": "cortadora de pasto grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SCI9810206Y6', '60204011000', 1.0, 2, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SPR090925LYA', '60204005000', 0.5, 2, '[{"budget_category_id": "6a279d68-650a-4d8d-b76f-a69a270f9d57", "name": "Alimento de animales"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SSD940316IF7', '60204011000', 1.0, 2, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'VEAL810525FX9', '60208009000', 1.0, 2, '[{"budget_category_id": "90629449-56a8-427c-9c94-4cc41ed5d929", "name": "Mantenimiento equipos refrigeración"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ZMO190325P99', '60207005000', 1.0, 2, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AEI070602P84', '60208004000', 1.0, 1, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AEL050620TJ9', '60205001000', 1.0, 1, '[{"budget_category_id": "2307cdd1-b006-42fd-891f-c4242a119601", "name": "Adquisiciòn de herramientas"}, {"budget_category_id": "ec50ec34-428e-4dc2-8c49-112ca4000d8b", "name": "Compra de desmalezadoras"}, {"budget_category_id": "c7a87628-5797-4bf3-b49e-9aa651ebecdc", "name": "compra de podadora"}, {"budget_category_id": "b17bf95a-8cb2-4ce4-8e73-176e5e1f3e75", "name": "cortadora de pasto grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AIGP580111DQ2', '60208019000', 1.0, 1, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ALU830902ST5', '60204002000', 0.2, 1, '[{"budget_category_id": "83ab5d76-3408-4f15-b5c1-16766bcbbc55", "name": "Veterinario"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'ANF940707EP6', '60206001000', 1.0, 1, '[{"budget_category_id": "a7fea2e4-1c68-41a7-aac4-87ac51e54bc9", "name": "cristaleria"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'AORL741019KV6', '60202007000', 1.0, 1, '[{"budget_category_id": "666c9066-1dde-4522-a417-2b31ab603414", "name": "Cartas antecedentes No Penales"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'BAIH960828DT8', '60207008000', 0.3333, 1, '[{"budget_category_id": "803560ae-d20a-4aba-8cc8-0d982705ddaa", "name": "Telmex"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'BCA120831AE6', '60202003000', 1.0, 1, '[{"budget_category_id": "06ff1e28-2a4c-4598-b453-9cadeb0c0553", "name": "Elaboracion e inscripción Reglamento Trabajo"}, {"budget_category_id": "d86f9275-e47e-4075-a19d-d9a198ea396d", "name": "Mantenimiento Corporativo (Legal)"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CGP970522EE4', '60204011000', 1.0, 1, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CIV920714RL1', '60208005000', 1.0, 1, '[{"budget_category_id": "68ae779a-12a9-4286-aea3-5a4d8d4c0b22", "name": "Herrajes"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'COP920428Q20', '60202010000', 1.0, 1, '[{"budget_category_id": "b9f35dbd-265d-4cb9-ba0f-91e81c0b3c98", "name": "compra de lavadora y/o secadora"}, {"budget_category_id": "cc602b36-8ba0-437e-9dd6-67bfc8f227c2", "name": "Reparación / compra electrodomésticos"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'CSD161207R2A', '60204002000', 0.3333, 1, '[{"budget_category_id": "83ab5d76-3408-4f15-b5c1-16766bcbbc55", "name": "Veterinario"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'EOLI911115SE9', '60208004000', 1.0, 1, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'FCS140320836', '60208015000', 1.0, 1, '[{"budget_category_id": "3f8436ce-3399-4143-9d41-f25cf184dfd8", "name": "Mantenimiento camaras"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'FELJ830314K51', '60208016000', 1.0, 1, '[{"budget_category_id": "38799454-67f9-4197-9e94-d91a18d386ed", "name": "Mantenimineto Extintores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GARE7601176D9', '60205002000', 0.25, 1, '[{"budget_category_id": "19d9ed68-07d8-4428-a093-a85aad627edf", "name": "Reparacion de herramienta"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GARF700627P19', '60208017000', 1.0, 1, '[{"budget_category_id": "c83006f2-54c4-4965-be37-8a874886d15b", "name": "Mantenimiento invernadero"}, {"budget_category_id": "3b2c6272-00a2-4885-a51b-b4daec81af46", "name": "Mantenimiento Invernadero"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GDI1205025W4', '60208011000', 1.0, 1, '[{"budget_category_id": "97ff81d9-072e-41ed-8451-cbcc54278d80", "name": "Mantenimiento pintura"}, {"budget_category_id": "29a2d47d-db9e-4489-8d57-c348c809b7aa", "name": "pintura de alberca"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GFE180913IE6', '60204002000', 0.2, 1, '[{"budget_category_id": "83ab5d76-3408-4f15-b5c1-16766bcbbc55", "name": "Veterinario"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GIM000908TM9', '60208004000', 1.0, 1, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GORB960806V68', '60205001000', 1.0, 1, '[{"budget_category_id": "2307cdd1-b006-42fd-891f-c4242a119601", "name": "Adquisiciòn de herramientas"}, {"budget_category_id": "ec50ec34-428e-4dc2-8c49-112ca4000d8b", "name": "Compra de desmalezadoras"}, {"budget_category_id": "c7a87628-5797-4bf3-b49e-9aa651ebecdc", "name": "compra de podadora"}, {"budget_category_id": "b17bf95a-8cb2-4ce4-8e73-176e5e1f3e75", "name": "cortadora de pasto grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GORS7411297D2', '60205002000', 0.5, 1, '[{"budget_category_id": "19d9ed68-07d8-4428-a093-a85aad627edf", "name": "Reparacion de herramienta"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'GTU060808IE6', '60204013000', 1.0, 1, '[{"budget_category_id": "c630bc04-0e08-40c1-a322-a8a5ad848f87", "name": "Combustible Seguridad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'KAI210922657', '60207004000', 1.0, 1, '[{"budget_category_id": "19a5d65a-0ed0-4bf9-b35a-177d88317a7d", "name": "Aportacionea a la comunidad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'LOBA8310016U9', '60202007000', 1.0, 1, '[{"budget_category_id": "666c9066-1dde-4522-a417-2b31ab603414", "name": "Cartas antecedentes No Penales"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MACJ8612194H3', '60208016000', 1.0, 1, '[{"budget_category_id": "38799454-67f9-4197-9e94-d91a18d386ed", "name": "Mantenimineto Extintores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'METE940904HR7', '60208019000', 1.0, 1, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'MUPN940723M96', '60205001000', 1.0, 1, '[{"budget_category_id": "2307cdd1-b006-42fd-891f-c4242a119601", "name": "Adquisiciòn de herramientas"}, {"budget_category_id": "ec50ec34-428e-4dc2-8c49-112ca4000d8b", "name": "Compra de desmalezadoras"}, {"budget_category_id": "c7a87628-5797-4bf3-b49e-9aa651ebecdc", "name": "compra de podadora"}, {"budget_category_id": "b17bf95a-8cb2-4ce4-8e73-176e5e1f3e75", "name": "cortadora de pasto grande"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'NPD110823FU8', '60202003000', 1.0, 1, '[{"budget_category_id": "06ff1e28-2a4c-4598-b453-9cadeb0c0553", "name": "Elaboracion e inscripción Reglamento Trabajo"}, {"budget_category_id": "d86f9275-e47e-4075-a19d-d9a198ea396d", "name": "Mantenimiento Corporativo (Legal)"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'OIVR721020JH4', '60207005000', 1.0, 1, '[{"budget_category_id": "3f033f12-93f4-4633-abc7-819abe430830", "name": "Mantenimiento Vehiculos"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'PIMA040618RI1', '60204017000', 1.0, 1, '[{"budget_category_id": "eed20c8a-cef1-449b-b702-f5a8caef85a0", "name": "Servicios y suministros"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'PMA1805167L1', '60208019000', 1.0, 1, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'PME620604V71', '60204011000', 1.0, 1, '[{"budget_category_id": "20558848-ddc1-42a6-b92e-83eed5c66908", "name": "Combustible Casa grande"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'POAS771102NG8', '60202002000', 1.0, 1, '[{"budget_category_id": "02c30f4a-c8cb-4266-b537-a4fc694a5ac3", "name": "Gastos extraordinarios"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'RADL8706208BA', '60208004000', 1.0, 1, '[{"budget_category_id": "10fab56d-22af-48bf-9f3b-2040e8500882", "name": "Mantenimiento tractores"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SAT1101252F3', '60207004000', 1.0, 1, '[{"budget_category_id": "19a5d65a-0ed0-4bf9-b35a-177d88317a7d", "name": "Aportacionea a la comunidad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SDC170418224', '60207004000', 1.0, 1, '[{"budget_category_id": "19a5d65a-0ed0-4bf9-b35a-177d88317a7d", "name": "Aportacionea a la comunidad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'SNP0001285P6', '60204013000', 1.0, 1, '[{"budget_category_id": "c630bc04-0e08-40c1-a322-a8a5ad848f87", "name": "Combustible Seguridad"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'TUB060831GK1', '60208002000', 1.0, 1, '[{"budget_category_id": "aacf596e-6df1-420f-a259-196152656c1b", "name": "Mantenimiento Pozos"}]'::jsonb, true),
  ('144042c1-e493-4256-a86c-cd088a8898ce', 'VIOV680314PNA', '60208019000', 1.0, 1, '[{"budget_category_id": "7d815f64-4cb5-4a2b-9bc4-0cfa29cc54e2", "name": "cambio de techo de oficina"}, {"budget_category_id": "d8cd354c-6ac6-4581-af01-bd59bf1a3600", "name": "Mantenimiento trasformadores"}, {"budget_category_id": "2846b1a5-9425-4c39-83eb-ce6c3e7d6b60", "name": "remplazamiento de tanque de gas"}, {"budget_category_id": "2971c300-c207-4869-8615-ae0a8631c1df", "name": "Suministro y colocacion Cámaras Casa Barbara"}, {"budget_category_id": "714d1fd0-e4da-4a10-b3b0-32a68f3df2eb", "name": "Sustitución vigas Casa Lorenzo"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ERE010302IP6', '5031600', 1.0, 125, '[{"budget_category_id": "ec894c48-a8ea-4549-bcf1-ff271b439d75", "name": "Vales de Gasolina (Reembolso no gasto)"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'EFE8908015L3', '5031600', 0.5082, 61, '[{"budget_category_id": "ec894c48-a8ea-4549-bcf1-ff271b439d75", "name": "Vales de Gasolina (Reembolso no gasto)"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'BLU030710A50', '5034100', 0.6458, 45, '[{"budget_category_id": "8c8b3ce1-1b45-4f05-b139-b15187cf5ae8", "name": "Reparacion y Mantto Bluepath"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'MIBG870909FQ0', '5036800', 1.0, 35, '[{"budget_category_id": "64310102-34a7-4aa1-bc76-bbcbaec8220f", "name": "Diseño comunicación interna"}, {"budget_category_id": "d0b1bb9f-ee0b-426e-b284-263b1bbb186b", "name": "Fotos profesionales colaboradores"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'WOR171123FG8', '5037100', 1.0, 33, '[{"budget_category_id": "569f1bb2-bffe-4461-9524-412081fc7bcf", "name": "Worky maquila"}, {"budget_category_id": "c0944a47-911f-4ea3-9529-ef78b75820ee", "name": "Worky plataforma"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ZME171011K13', '5036200', 1.0, 32, '[{"budget_category_id": "d1cd39a4-4f86-4bfd-9fb0-3100549e8e5b", "name": "Servicio de Escolta"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'NWM9709244W4', '5036000', 0.9394, 31, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'PWT121112485', '5035800', 1.0, 31, '[{"budget_category_id": "8f62dc4f-c71e-4229-862e-e53db79c4a4e", "name": "Dispensador de Agua"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'CSA1201053I4', '5037500', 0.8261, 23, '[{"budget_category_id": "7c7619c1-8fc7-4c70-9e39-8565e453e1b3", "name": "Renta Servidor y Mtto."}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'IJE801118A28', '5031900', 0.5, 18, '[{"budget_category_id": "dad892f6-fef9-46a9-bab7-d624ab21ef88", "name": "Renta"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'PMO8010234J5', '5031900', 0.625, 16, '[{"budget_category_id": "dad892f6-fef9-46a9-bab7-d624ab21ef88", "name": "Renta"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SAB160302869', '5037500', 0.8235, 16, '[{"budget_category_id": "7c7619c1-8fc7-4c70-9e39-8565e453e1b3", "name": "Renta Servidor y Mtto."}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SAGE5908061R6', '5037600', 0.5455, 15, '[{"budget_category_id": "076cfca3-2641-44cf-b212-26b018478bae", "name": "Actualización y Mtto. Contpaq"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DCA100825FW0', '5030400', 1.0, 13, '[{"budget_category_id": "7912337d-8835-4554-92f9-3e1706b97c0a", "name": "Comisiones Bancarias"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'CME910715UB9', '5036000', 1.0, 11, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ASE901221SM4', '5030700', 1.0, 8, '[{"budget_category_id": "aae81a06-dba9-471c-849f-79bfc317a889", "name": "Seguros de Gastos Médicos"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'LUGR8103115D5', '5037600', 0.4444, 6, '[{"budget_category_id": "076cfca3-2641-44cf-b212-26b018478bae", "name": "Actualización y Mtto. Contpaq"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'BAS200403II9', '5030200', 0.8, 5, '[{"budget_category_id": "6d02f650-6d3d-4424-8d79-a1a6bd5ada3a", "name": "Congresos"}, {"budget_category_id": "31c37665-70fd-49ca-b23b-807362fdbee2", "name": "Membresía B-Salud"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'CBA160804R80', '5030100', 0.8, 5, '[{"budget_category_id": "6134a547-c756-42df-9efe-7913740ad864", "name": "Iguala Blanco Carrillo"}, {"budget_category_id": "31214f94-1794-472c-8658-1c495d0453eb", "name": "Servicios notariales y auditoría"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'AME880912I89', '5031500', 1.0, 4, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'CFE370814QI0', '5035600', 1.0, 3, '[{"budget_category_id": "7679b7d3-0114-48dc-a771-efd458c5edd6", "name": "Luz"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ETL130528FC1', '5036000', 1.0, 3, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'LOSH810813G18', '5036000', 1.0, 3, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'PCE1710038M4', '5031500', 1.0, 3, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SAT1101252F3', '5034600', 0.3333, 3, '[{"budget_category_id": "81721549-a18f-4fd2-bdd8-75eccfcf4cd3", "name": "Correos y Mensajeria"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'TCH850701RM1', '5036000', 0.6667, 3, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DUCP711123SFA', '5036000', 0.6667, 2, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'GNP9211244P0', '5030700', 1.0, 2, '[{"budget_category_id": "aae81a06-dba9-471c-849f-79bfc317a889", "name": "Seguros de Gastos Médicos"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'HEFF901210897', '5038000', 1.0, 2, '[{"budget_category_id": "d5fd9199-7180-4ccd-a4c7-0a7c41dd9788", "name": "Kits de identidad"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'HER170522M19', '5036000', 0.5, 2, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'MAGG770221KV1', '5036500', 0.5, 2, '[{"budget_category_id": "f6c19dd8-58d1-4bcf-be27-0434059e86ad", "name": "Aseoría Recursos Humanos"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'MCO1710069L6', '5036600', 1.0, 2, '[{"budget_category_id": "b81f4f8e-f4bf-4608-9b9a-4fbb4744e903", "name": "Bolsas de empleo (OCC, Computrabajo)"}, {"budget_category_id": "17cd674e-382e-47bd-9c20-39c544c7f16c", "name": "Estudios socioeconomicos"}, {"budget_category_id": "125a96e0-4160-41e7-8db5-b2089d14b881", "name": "Evaluatest"}, {"budget_category_id": "0324c3a4-dd5f-4640-8cbf-b13a6076953f", "name": "LinkedIn"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SET210217N74', '5036600', 1.0, 2, '[{"budget_category_id": "b81f4f8e-f4bf-4608-9b9a-4fbb4744e903", "name": "Bolsas de empleo (OCC, Computrabajo)"}, {"budget_category_id": "17cd674e-382e-47bd-9c20-39c544c7f16c", "name": "Estudios socioeconomicos"}, {"budget_category_id": "125a96e0-4160-41e7-8db5-b2089d14b881", "name": "Evaluatest"}, {"budget_category_id": "0324c3a4-dd5f-4640-8cbf-b13a6076953f", "name": "LinkedIn"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'TSO991022PB6', '5036000', 1.0, 2, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'UTA820628TV3', '5036000', 1.0, 2, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'APM240411QJ0', '5030800', 1.0, 1, '[{"budget_category_id": "db1e1262-4de4-4d5e-b35e-98781299c609", "name": "Capacitación interna"}, {"budget_category_id": "a0284598-3974-4347-8a20-e3a2addb8ddf", "name": "Capacitación técnica"}, {"budget_category_id": "24d5301f-b387-4181-989a-d582ad6a5acd", "name": "Curso brigadistas"}, {"budget_category_id": "1e37f829-e2ed-43d5-8603-af808fa30d42", "name": "Cursos primeros auxilios"}, {"budget_category_id": "00fd0da7-6702-4df3-b091-5bc5cb3f44f6", "name": "Talleres bienestar"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ASE931116231', '5030700', 1.0, 1, '[{"budget_category_id": "aae81a06-dba9-471c-849f-79bfc317a889", "name": "Seguros de Gastos Médicos"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ATU231004JR0', '5039100', 1.0, 1, '[{"budget_category_id": "9a5c98ae-60e0-4434-804c-062f3d12bf97", "name": "Partidas no Deducibles"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'CGP970522EE4', '5031600', 1.0, 1, '[{"budget_category_id": "ec894c48-a8ea-4549-bcf1-ff271b439d75", "name": "Vales de Gasolina (Reembolso no gasto)"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DEM8801152E9', '5034600', 1.0, 1, '[{"budget_category_id": "81721549-a18f-4fd2-bdd8-75eccfcf4cd3", "name": "Correos y Mensajeria"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DGC170313257', '5031500', 1.0, 1, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DIGR861118VD0', '5030800', 1.0, 1, '[{"budget_category_id": "db1e1262-4de4-4d5e-b35e-98781299c609", "name": "Capacitación interna"}, {"budget_category_id": "a0284598-3974-4347-8a20-e3a2addb8ddf", "name": "Capacitación técnica"}, {"budget_category_id": "24d5301f-b387-4181-989a-d582ad6a5acd", "name": "Curso brigadistas"}, {"budget_category_id": "1e37f829-e2ed-43d5-8603-af808fa30d42", "name": "Cursos primeros auxilios"}, {"budget_category_id": "00fd0da7-6702-4df3-b091-5bc5cb3f44f6", "name": "Talleres bienestar"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DIN161117J74', '5037000', 1.0, 1, '[{"budget_category_id": "3a505595-5090-4fef-bb46-8793a4d8fb0b", "name": "Regalos día de las madres"}, {"budget_category_id": "89b46d35-9a99-47f8-9c10-20db774ebe0f", "name": "Regalos día del padre"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'DRA1708027Y8', '5031600', 1.0, 1, '[{"budget_category_id": "ec894c48-a8ea-4549-bcf1-ff271b439d75", "name": "Vales de Gasolina (Reembolso no gasto)"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ETE1912132Q2', '5036600', 1.0, 1, '[{"budget_category_id": "b81f4f8e-f4bf-4608-9b9a-4fbb4744e903", "name": "Bolsas de empleo (OCC, Computrabajo)"}, {"budget_category_id": "17cd674e-382e-47bd-9c20-39c544c7f16c", "name": "Estudios socioeconomicos"}, {"budget_category_id": "125a96e0-4160-41e7-8db5-b2089d14b881", "name": "Evaluatest"}, {"budget_category_id": "0324c3a4-dd5f-4640-8cbf-b13a6076953f", "name": "LinkedIn"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'FBW151214A52', '5031500', 0.5, 1, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'FFR120807ID0', '5031500', 1.0, 1, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'FGU830930PD3', '5036000', 0.5, 1, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'GRU220829KL8', '5031500', 1.0, 1, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'GTM2403077M2', '5036900', 1.0, 1, '[{"budget_category_id": "724f5a22-76e3-4729-aa70-0af03ef9b5c6", "name": "Consultoria Medicion de Impacto"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'IPO061221HF2', '5039100', 1.0, 1, '[{"budget_category_id": "9a5c98ae-60e0-4434-804c-062f3d12bf97", "name": "Partidas no Deducibles"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'MFX170517TT1', '5036000', 1.0, 1, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'MVA020806C26', '5031500', 0.5, 1, '[{"budget_category_id": "dc28ed59-d962-4d4c-9777-f077b7835b86", "name": "Gastos de Viaje"}, {"budget_category_id": "ed0f717d-747b-4036-a1e4-01da03b497e7", "name": "Offsite Equipo Directivo"}, {"budget_category_id": "3fb37d1b-755c-442b-9dd3-560abadcc85c", "name": "Viajes T&E (Hospedaje, Comidas)"}, {"budget_category_id": "303c6595-9787-4ba0-b311-edd180d96c7d", "name": "Viajes Transporte"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'ODM950324V2A', '5036000', 1.0, 1, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'OTE2003102G1', '5036400', 1.0, 1, '[{"budget_category_id": "80349acf-dab5-45d6-b227-192bdedb19cd", "name": "Gastos Automatización"}, {"budget_category_id": "b0dbf2b1-f01f-4d94-9e23-e9fe2cad1211", "name": "Google y MS Office"}, {"budget_category_id": "0852039a-89d6-41d4-8b17-5ece6c9d0fce", "name": "Plataforma de Portfolio Management"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'POL171213UB2', '5030800', 1.0, 1, '[{"budget_category_id": "db1e1262-4de4-4d5e-b35e-98781299c609", "name": "Capacitación interna"}, {"budget_category_id": "a0284598-3974-4347-8a20-e3a2addb8ddf", "name": "Capacitación técnica"}, {"budget_category_id": "24d5301f-b387-4181-989a-d582ad6a5acd", "name": "Curso brigadistas"}, {"budget_category_id": "1e37f829-e2ed-43d5-8603-af808fa30d42", "name": "Cursos primeros auxilios"}, {"budget_category_id": "00fd0da7-6702-4df3-b091-5bc5cb3f44f6", "name": "Talleres bienestar"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SCO1611173G9', '5037000', 1.0, 1, '[{"budget_category_id": "3a505595-5090-4fef-bb46-8793a4d8fb0b", "name": "Regalos día de las madres"}, {"budget_category_id": "89b46d35-9a99-47f8-9c10-20db774ebe0f", "name": "Regalos día del padre"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SET110616D8A', '5031600', 1.0, 1, '[{"budget_category_id": "ec894c48-a8ea-4549-bcf1-ff271b439d75", "name": "Vales de Gasolina (Reembolso no gasto)"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'SPL130430175', '5031600', 1.0, 1, '[{"budget_category_id": "ec894c48-a8ea-4549-bcf1-ff271b439d75", "name": "Vales de Gasolina (Reembolso no gasto)"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'TIN090211JC9', '5036000', 1.0, 1, '[{"budget_category_id": "26cc1f9d-1974-4793-baa7-2b42658fdf56", "name": "Enseres"}]'::jsonb, true),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'TOMA730614J34', '5030800', 1.0, 1, '[{"budget_category_id": "db1e1262-4de4-4d5e-b35e-98781299c609", "name": "Capacitación interna"}, {"budget_category_id": "a0284598-3974-4347-8a20-e3a2addb8ddf", "name": "Capacitación técnica"}, {"budget_category_id": "24d5301f-b387-4181-989a-d582ad6a5acd", "name": "Curso brigadistas"}, {"budget_category_id": "1e37f829-e2ed-43d5-8603-af808fa30d42", "name": "Cursos primeros auxilios"}, {"budget_category_id": "00fd0da7-6702-4df3-b091-5bc5cb3f44f6", "name": "Talleres bienestar"}]'::jsonb, false),
  ('20cd72aa-f281-4985-931b-a83422404b66', 'VAF181109CQ5', '5030100', 1.0, 1, '[{"budget_category_id": "6134a547-c756-42df-9efe-7913740ad864", "name": "Iguala Blanco Carrillo"}, {"budget_category_id": "31214f94-1794-472c-8658-1c495d0453eb", "name": "Servicios notariales y auditoría"}]'::jsonb, false)
on conflict (company_id, rfc_emisor) do update set
  cuenta_gasto_dominante = excluded.cuenta_gasto_dominante,
  share_dominante = excluded.share_dominante,
  n_cfdis = excluded.n_cfdis,
  partida_candidates = excluded.partida_candidates,
  is_confident = excluded.is_confident,
  source = excluded.source;


-- Resolve every historical candidate to the current PROD budget-category UUID.
-- Rules are deliberately conservative:
--   1) exact case-sensitive PROD name wins (this disambiguates the two distinct Invernadero rows),
--   2) one explicit historical typo alias is allowed,
--   3) exactly two retired historical categories are dropped instead of guessed,
--   4) every other missing or ambiguous category aborts the entire transaction.
do $category_precheck$
declare
  v record;
  v_matches integer;
  v_target_name text;
begin
  for v in
    select distinct
      p.company_id,
      c.name as company_name,
      candidate.value->>'name' as category_name
    from public.partida_predictions p
    join public.companies c on c.id = p.company_id
    cross join lateral jsonb_array_elements(p.partida_candidates) candidate(value)
    where p.company_id in ('144042c1-e493-4256-a86c-cd088a8898ce'::uuid, '20cd72aa-f281-4985-931b-a83422404b66'::uuid)
      and p.source = 'contpaq_historical_2024_2026'
  loop
    v_target_name := case v.category_name
      when 'Adquisiciòn de herramientas' then 'Adquisición de herramientas'
      else v.category_name
    end;

    select count(distinct bc.id)
      into v_matches
    from public.company_cost_center_budget_categories ccb
    join public.budget_categories bc on bc.id = ccb.budget_category_id
    where ccb.company_id = v.company_id
      and coalesce(ccb.active, true)
      and coalesce(bc.active, true)
      and btrim(bc.name) = btrim(v_target_name);

    if v_matches = 0 and v.category_name in ('Gastos extraordinarios', 'Servicios y suministros') then
      continue;
    end if;

    if v.category_name is null or v_matches <> 1 then
      raise exception 'partida_prediction_category_resolution_failed:%:%:%',
        v.company_name, coalesce(v.category_name, '<null>'), v_matches;
    end if;
  end loop;
end
$category_precheck$;

with resolved_candidates as (
  select
    p.id as prediction_id,
    coalesce(
      jsonb_agg(
        (candidate.value - 'budget_category_id' - 'name')
        || jsonb_build_object(
          'budget_category_id', resolved.id::text,
          'name', resolved.name
        )
        order by candidate.ordinality
      ) filter (where resolved.id is not null),
      '[]'::jsonb
    ) as resolved_json,
    count(resolved.id) as resolved_count
  from public.partida_predictions p
  cross join lateral jsonb_array_elements(p.partida_candidates) with ordinality
    as candidate(value, ordinality)
  left join lateral (
    select bc.id, bc.name
    from public.company_cost_center_budget_categories ccb
    join public.budget_categories bc on bc.id = ccb.budget_category_id
    where ccb.company_id = p.company_id
      and coalesce(ccb.active, true)
      and coalesce(bc.active, true)
      and btrim(bc.name) = btrim(
        case candidate.value->>'name'
          when 'Adquisiciòn de herramientas' then 'Adquisición de herramientas'
          else candidate.value->>'name'
        end
      )
    group by bc.id, bc.name
    limit 1
  ) resolved on true
  where p.company_id in ('144042c1-e493-4256-a86c-cd088a8898ce'::uuid, '20cd72aa-f281-4985-931b-a83422404b66'::uuid)
    and p.source = 'contpaq_historical_2024_2026'
  group by p.id
)
update public.partida_predictions p
set partida_candidates = rc.resolved_json,
    is_confident = case when rc.resolved_count = 0 then false else p.is_confident end
from resolved_candidates rc
where p.id = rc.prediction_id;


do $postcheck$
declare
  v_operadora integer;
  v_fersana integer;
begin
  select count(*) into v_operadora from public.partida_predictions where company_id='144042c1-e493-4256-a86c-cd088a8898ce'::uuid;
  select count(*) into v_fersana from public.partida_predictions where company_id='20cd72aa-f281-4985-931b-a83422404b66'::uuid;
  if v_operadora <> 98 or v_fersana <> 62 then
    raise exception 'partida_prediction_seed_count_mismatch: %/%', v_operadora, v_fersana;
  end if;

  if exists (
    select 1
    from public.partida_predictions p
    cross join lateral jsonb_array_elements(p.partida_candidates) candidate(value)
    left join public.company_cost_center_budget_categories ccb
      on ccb.company_id = p.company_id
     and ccb.budget_category_id = nullif(candidate.value->>'budget_category_id', '')::uuid
     and coalesce(ccb.active, true)
    left join public.budget_categories bc
      on bc.id = ccb.budget_category_id
     and coalesce(bc.active, true)
    where p.company_id in ('144042c1-e493-4256-a86c-cd088a8898ce'::uuid, '20cd72aa-f281-4985-931b-a83422404b66'::uuid)
      and p.source = 'contpaq_historical_2024_2026'
      and bc.id is null
  ) then
    raise exception 'partida_prediction_resolved_candidate_invalid';
  end if;

  if exists (
    select 1
    from public.partida_predictions p
    where p.company_id in ('144042c1-e493-4256-a86c-cd088a8898ce'::uuid, '20cd72aa-f281-4985-931b-a83422404b66'::uuid)
      and p.source = 'contpaq_historical_2024_2026'
      and p.is_confident
      and jsonb_array_length(p.partida_candidates) = 0
  ) then
    raise exception 'partida_prediction_empty_candidate_still_confident';
  end if;

  if exists (
    select 1
    from public.partida_predictions p
    cross join lateral jsonb_array_elements(p.partida_candidates) candidate(value)
    where p.company_id in ('144042c1-e493-4256-a86c-cd088a8898ce'::uuid, '20cd72aa-f281-4985-931b-a83422404b66'::uuid)
      and candidate.value->>'name' in ('Gastos extraordinarios', 'Servicios y suministros', 'Adquisiciòn de herramientas')
  ) then
    raise exception 'partida_prediction_stale_candidate_survived';
  end if;
end
$postcheck$;

commit;
