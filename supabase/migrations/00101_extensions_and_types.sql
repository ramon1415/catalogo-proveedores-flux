-- Flux Operadora - Migracion 001
-- Esquema base generado desde exports reales de Supabase dev. Revisar antes de ejecutar en prod.
create schema if not exists public;

-- Extensiones requeridas por el esquema de aplicacion.
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "btree_gist";

-- Enums publicos.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'autorizacion_enum'
  ) then
    create type public."autorizacion_enum" as enum ('Autorizado', 'Rechazado');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'booking_source_type'
  ) then
    create type public."booking_source_type" as enum ('celebration', 'production');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'booking_status'
  ) then
    create type public."booking_status" as enum ('interested_date', 'promised_date', 'blocked_date', 'cancelled');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'booking_type'
  ) then
    create type public."booking_type" as enum ('rent', 'mounting', 'dismounting');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'celebration_concept_type'
  ) then
    create type public."celebration_concept_type" as enum ('venue_rent', 'mounting', 'dismounting', 'extra_hour_event', 'extra_hour_power', 'deposit', 'audio_lighting', 'other');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'celebration_lead_status'
  ) then
    create type public."celebration_lead_status" as enum ('new', 'assigned', 'converted', 'lost');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'celebration_status'
  ) then
    create type public."celebration_status" as enum ('quoted', 'promised', 'blocked', 'cancelled');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'client_type'
  ) then
    create type public."client_type" as enum ('person', 'company');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'company_account_type'
  ) then
    create type public."company_account_type" as enum ('bank', 'cash', 'card_processor', 'other');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'document_file_type'
  ) then
    create type public."document_file_type" as enum ('invoice_pdf', 'invoice_xml', 'quote', 'contract', 'payment_receipt', 'bank_proof', 'other');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'estado_ticket_enum'
  ) then
    create type public."estado_ticket_enum" as enum ('Abierto', 'En proceso', 'Cerrado');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'event_usage_type'
  ) then
    create type public."event_usage_type" as enum ('reception', 'cocktail', 'after_party', 'ceremony', 'general');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'income_payment_method'
  ) then
    create type public."income_payment_method" as enum ('transfer_mxn', 'transfer_usd', 'cash', 'card', 'other');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'income_payment_type'
  ) then
    create type public."income_payment_type" as enum ('anticipo', 'abono', 'finiquito', 'deposito_garantia', 'other');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'metodo_pago_enum'
  ) then
    create type public."metodo_pago_enum" as enum ('Transferencia bancaria', 'Efectivo', 'Tarjeta en plataforma', 'DepÃ³sito a cuenta');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'moneda_enum'
  ) then
    create type public."moneda_enum" as enum ('MXN', 'USD', 'EUR');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payer_type'
  ) then
    create type public."payer_type" as enum ('client', 'parent', 'company', 'planner', 'other');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_flow'
  ) then
    create type public."payment_flow" as enum ('client_pays_company', 'client_pays_provider_directly', 'company_pays_provider');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_request_status'
  ) then
    create type public."payment_request_status" as enum ('draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'changes_requested', 'finance_validation', 'scheduled', 'paid', 'cancelled');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_request_type'
  ) then
    create type public."payment_request_type" as enum ('provider_payment', 'reimbursement', 'deposit_refund', 'other', 'cash', 'check');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'production_status'
  ) then
    create type public."production_status" as enum ('prospect', 'confirmed', 'planning', 'executing', 'closed', 'cancelled');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'profit_model'
  ) then
    create type public."profit_model" as enum ('price_minus_cost', 'commission', 'pass_through', 'mixed');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'provider_type'
  ) then
    create type public."provider_type" as enum ('company', 'person', 'employee');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'sales_invoice_status'
  ) then
    create type public."sales_invoice_status" as enum ('draft', 'issued', 'cancelled', 'paid');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'venue_connection_type'
  ) then
    create type public."venue_connection_type" as enum ('internal_door', 'same_property', 'nearby');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'venue_type'
  ) then
    create type public."venue_type" as enum ('owned', 'external');
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'vertical_enum'
  ) then
    create type public."vertical_enum" as enum ('Celebraciones', 'Hospitalidad', 'Comunidad');
  end if;
end $$;
