begin;

alter table public.payment_layout_lines
  add column if not exists convenio_number text;

comment on column public.payment_layout_lines.convenio_number is
  'Immutable raw convenio snapshot captured when a convenio layout line is inserted. Never parse destination_value to build CIE.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_layout_lines'::regclass
      and conname = 'payment_layout_lines_convenio_snapshot_chk'
  ) then
    alter table public.payment_layout_lines
      add constraint payment_layout_lines_convenio_snapshot_chk
      check (
        convenio_number is null
        or (
          lower(btrim(destination_type)) = 'convenio'
          and convenio_number ~ '^[0-9]+$'
        )
      );
  end if;
end
$$;

create or replace function public.snapshot_payment_layout_line_convenio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_convenio_number text;
begin
  if tg_op = 'UPDATE'
     and new.proveedor_id is not distinct from old.proveedor_id
     and lower(btrim(new.destination_type)) is not distinct from lower(btrim(old.destination_type))
     and new.convenio_number is distinct from old.convenio_number then
    raise exception 'payment_layout_line_convenio_snapshot_immutable';
  end if;

  if tg_op = 'INSERT'
     or new.proveedor_id is distinct from old.proveedor_id
     or lower(btrim(new.destination_type)) is distinct from lower(btrim(old.destination_type)) then
    if lower(btrim(new.destination_type)) = 'convenio' then
      select nullif(btrim(p.convenio_number), '')
        into v_convenio_number
      from public.proveedores p
      where p.id = new.proveedor_id;

      if v_convenio_number is null then
        raise exception 'cie_convenio_number_required';
      end if;

      new.convenio_number := v_convenio_number;
    else
      new.convenio_number := null;
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.snapshot_payment_layout_line_convenio() from public, anon, authenticated;

drop trigger if exists snapshot_payment_layout_line_convenio_trg
  on public.payment_layout_lines;

create trigger snapshot_payment_layout_line_convenio_trg
before insert or update of proveedor_id, destination_type, convenio_number
on public.payment_layout_lines
for each row
execute function public.snapshot_payment_layout_line_convenio();

commit;
