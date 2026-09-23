import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
test('provider company finance authorization and banking guards', async () => {
  const db = new PGlite()
  await db.exec(read('./fixtures/sin-partida-schema.sql'))
  await db.exec(`
    create table profile_company_memberships(profile_id uuid,company_id uuid,role_key text,active boolean);
    create table activity_log(entity_type text, entity_id uuid, action text, old_values jsonb,new_values jsonb,performed_by uuid,performed_at timestamptz,notes text);
    create function current_profile_id() returns uuid language sql stable as $$ select id from profiles where auth_user_id=nullif(current_setting('test.uid',true),'')::uuid and active $$;
    create function current_user_has_role(text[]) returns boolean language sql stable as $$ select exists(select 1 from user_roles u join roles r on r.id=u.role_id where u.profile_id=current_profile_id() and r.name=any($1)) $$;
    create function flux_member_roles() returns text[] language sql as $$ select array['finance','operator','sysadmin'] $$;
    create function flux_approver_roles() returns text[] language sql as $$ select array['finance','director','sysadmin'] $$;
    create function approval_batch_require_actor() returns uuid language plpgsql as $$ begin if current_profile_id() is null then raise exception 'not_authenticated'; end if; return current_profile_id(); end $$;
    create function approval_batch_require_finance() returns uuid language plpgsql as $$ begin perform approval_batch_require_actor(); if not current_user_has_role(array['finance','sysadmin']) then raise exception 'finance_role_required'; end if; return current_profile_id(); end $$;
    insert into profiles(id,auth_user_id,active) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',true);
    insert into companies(id,active) values ('00000000-0000-4000-8000-000000000003',true);
    insert into profile_company_memberships values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','finance',true);
    select set_config('test.uid','00000000-0000-4000-8000-000000000002',false);
  `)
  await db.exec(read('./fixtures/provider-catalog-before-finance.sql'))
  await db.exec(`create trigger provider_insert before insert on proveedores for each row execute function guard_provider_payment_execution_data_insert(); create trigger provider_update before update on proveedores for each row execute function mark_provider_payment_material_change();`)
  const payload = {alias:'QA transient provider',nombre_completo:'QA Provider',metodo_pago:'Transferencia bancaria',destination_type:'cuenta',cuenta_bancaria:'0123456789',beneficiary_name:'QA Provider',banco:'BBVA',tipo_cuenta:'Cuenta'}
  const save = (id=null, data=payload) => db.query('select save_provider_catalog_with_payment_execution_data($1,$2::jsonb) result',[id,JSON.stringify(data)])
  await assert.rejects(save(), /provider_create_role_required/)
  await db.exec(read('../../ops/provider-company-finance-hotfix.sql'))
  const id=(await save()).rows[0].result.id
  assert.ok(id)
  await save(id,{...payload,cuenta_bancaria:'0123456790'})
  assert.equal((await db.query('select count(*)::int n from activity_log')).rows[0].n,2)
  await assert.rejects(db.exec(`update proveedores set cuenta_bancaria='0123456791'`), /provider_payment_execution_rpc_required/)
  await assert.rejects(save(null,{...payload,clabe:'123',destination_type:'clabe'}),/provider_payment_execution_data_invalid/)
  await db.exec(`update profile_company_memberships set role_key='operator'`)
  await assert.rejects(save(),/provider_create_role_required/)
  await db.exec(`insert into roles(id,name) values ('00000000-0000-4000-8000-000000000004','operator'); insert into user_roles(profile_id,role_id) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004');`)
  await assert.rejects(save(),/finance_role_required/)
  await db.exec(`delete from user_roles; update profile_company_memberships set role_key='finance',active=false`)
  await assert.rejects(save(),/provider_create_role_required/)
  await db.exec(`update profile_company_memberships set active=true; update companies set active=false`)
  await assert.rejects(save(),/provider_create_role_required/)
  await db.exec(`update companies set active=true; update profiles set active=false`)
  await assert.rejects(save(),/not_authenticated/)
  await db.exec(`update profiles set active=true; select set_config('test.uid','',false)`)
  await assert.rejects(save(),/not_authenticated/)

  // Full catalog role cutover: validate RLS as authenticated, not only RPC guards.
  await db.exec(`
    update profiles set active=true;
    update companies set active=true;
    update profile_company_memberships set active=true,role_key='finance';
    select set_config('test.uid','00000000-0000-4000-8000-000000000002',false);
    create role authenticated;
    create schema storage;
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    alter table proveedores enable row level security;
    grant usage on schema public,storage to authenticated;
    grant select on all tables in schema public to authenticated;
    grant insert,update on proveedores to authenticated;
    grant select,insert on storage.objects to authenticated;
    create policy proveedores_select_members on proveedores for select to authenticated using (current_user_has_role(flux_member_roles()));
    create policy proveedores_insert_members on proveedores for insert to authenticated with check (current_user_has_role(flux_member_roles()));
    create policy proveedores_update_managers on proveedores for update to authenticated using (current_user_has_role(flux_approver_roles())) with check (current_user_has_role(flux_approver_roles()));
    create policy "Authenticated can upload provider CSF" on storage.objects for insert to authenticated with check (bucket_id='payment-receipts' and name like 'csf/%' and current_user_has_role(flux_approver_roles()));
    create policy "Authenticated can read provider CSF" on storage.objects for select to authenticated using (bucket_id='payment-receipts' and name like 'csf/%' and current_user_has_role(flux_approver_roles()));
  `)
  await db.exec(read('../../ops/provider-current-roles.sql'))
  for (const role of ['finance','director','sysadmin','operator']) {
    await db.query('update profile_company_memberships set role_key=$1',[role])
    await db.exec('set role authenticated')
    assert.ok((await db.query('select id from proveedores')).rows.length, role+' reads catalog')
    const basicId=(await save(null,{alias:'QA '+role,nombre_completo:'QA '+role,metodo_pago:'Efectivo'})).rows[0].result.id
    const updated=await db.query('update proveedores set activo=false,csf_file_path=$1 where id=$2 returning id',['csf/'+basicId+'/test.pdf',basicId])
    assert.equal(updated.rows.length,role==='operator'?0:1,role+' updates active and CSF metadata')
    if(role==='operator') {
      await assert.rejects(save(basicId,{nombre_completo:'Changed'}),/provider_update_role_required/)
      await assert.rejects(db.query('insert into storage.objects(bucket_id,name)values($1,$2)',['payment-receipts','csf/'+basicId+'/test.pdf']),/row-level security/)
    } else {
      await save(basicId,{nombre_completo:'Changed'})
      await db.query('insert into storage.objects(bucket_id,name)values($1,$2)',['payment-receipts','csf/'+basicId+'/test.pdf'])
      assert.ok((await db.query('select * from storage.objects')).rows.length)
    }
    if(['finance','sysadmin'].includes(role)) await save()
    else await assert.rejects(save(),/finance_role_required/)
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name)values($1,$2)',['other-bucket','csf/test.pdf']),/row-level security/)
    await db.exec('reset role')
  }
  for (const scenario of ['membership','company','profile','unknown']) {
    await db.exec(`update profile_company_memberships set active=true,role_key='finance';update companies set active=true;update profiles set active=true`)
    if(scenario==='membership') await db.exec('update profile_company_memberships set active=false')
    if(scenario==='company') await db.exec('update companies set active=false')
    if(scenario==='profile') await db.exec('update profiles set active=false')
    if(scenario==='unknown') await db.exec("update profile_company_memberships set role_key='unknown'")
    await db.exec('set role authenticated')
    assert.equal((await db.query('select * from proveedores')).rows.length,0,scenario+' cannot read catalog')
    assert.equal((await db.query('update proveedores set activo=false returning id')).rows.length,0)
    assert.equal((await db.query('select * from storage.objects')).rows.length,0)
    await assert.rejects(save(),/provider_create_role_required|not_authenticated/)
    await assert.rejects(db.exec("insert into storage.objects(bucket_id,name)values('payment-receipts','csf/test.pdf')"),/row-level security/)
    await db.exec('reset role')
  }
  await db.close()
})
