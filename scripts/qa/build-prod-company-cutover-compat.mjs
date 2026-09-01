import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const wave1Source = resolve(root, 'supabase/migrations/20260901062149_company_scoped_rls_rpc_cutover.sql')
const rpcSource = resolve(root, 'supabase/migrations/20260901063043_company_scoped_rpc_cutover.sql')
const outputDir = resolve(root, 'prod-readiness/generated')
const wave1Output = resolve(outputDir, 'company_scoped_rls_rpc_cutover_prod.sql')
const rpcOutput = resolve(outputDir, 'company_scoped_rpc_cutover_prod.sql')

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  const last = source.lastIndexOf(before)
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one marker`)
  }
  return source.replace(before, after)
}

function removeBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex < 0 || source.indexOf(start, startIndex + 1) >= 0) {
    throw new Error(`${label}: marker drift`)
  }
  return source.slice(0, startIndex) + replacement + source.slice(endIndex)
}

let wave1 = await readFile(wave1Source, 'utf8')
wave1 = replaceOnce(
  wave1,
  '-- Company-scoped authorization cutover, wave 1.',
  `-- Company-scoped authorization cutover, PROD compatibility wave.\n--\n-- Generated from the DEV-certified wave. PROD intentionally lacks the optional\n-- CFDI preview and operational Payroll tables; their modules remain out of\n-- scope. The guards below fail if that inventory changes.`,
  'wave1 header',
)
wave1 = removeBetween(
  wave1,
  '-- CFDI preview inherits the company-scoped payment-request authorization.',
  '-- Finance ingestion data is visible only to Finance in the row\'s company.',
  `-- Optional CFDI preview is not released in PROD.
do $prod_cfdi_inventory$
begin
  if to_regclass('public.payment_request_cfdi_facts') is not null then
    raise exception 'prod_company_cutover_cfdi_inventory_changed';
  end if;
end
$prod_cfdi_inventory$;

`,
  'CFDI policy block',
)
wave1 = removeBetween(
  wave1,
  'drop policy if exists payroll_provision_settings_finance_read',
  '-- Fail the migration if the central policy wave accidentally leaves a global',
  `do $prod_payroll_inventory$
declare
  v_present text;
begin
  select string_agg(name, ', ' order by name)
  into v_present
  from unnest(array[
    'payroll_provision_settings',
    'payroll_provision_entries',
    'payroll_contpaq_role_mappings',
    'payroll_contpaq_bank_mappings'
  ]) name
  where to_regclass('public.' || name) is not null;

  if v_present is not null then
    raise exception 'prod_company_cutover_payroll_inventory_changed: %', v_present;
  end if;
end
$prod_payroll_inventory$;

`,
  'Payroll policy block',
)

let rpc = await readFile(rpcSource, 'utf8')
rpc = replaceOnce(
  rpc,
  '-- Company-scoped authorization cutover, RPC wave.',
  `-- Company-scoped authorization cutover, PROD-compatible RPC wave.\n--\n-- Missing CONTPAQ mapper write RPCs are allowed only for their exact signatures;\n-- every released Finance/approval RPC remains drift-checked and mandatory.`,
  'RPC header',
)
rpc = replaceOnce(
  rpc,
  `    if v_target is null then
      raise exception 'company_role_rpc_missing: %', v_item.signature;
    end if;`,
  `    if v_target is null then
      if v_item.signature = any(array[
        'public.contpaq_mapper_save_mapping(uuid,uuid,text,text,text,boolean)',
        'public.contpaq_mapper_set_review(uuid,uuid,text,text)'
      ]) then
        continue;
      end if;
      raise exception 'company_role_rpc_missing: %', v_item.signature;
    end if;`,
  'optional CONTPAQ RPC guard',
)
rpc = replaceOnce(
  rpc,
  '-- Batch context is a cross-company directory. Access is true only when the',
  `-- PROD retains two legacy compatibility RPCs that DEV no longer exposes.
-- Rewrite their exact predicates with count checks before the global postcheck.
do $prod_legacy_rpc_cutover$
declare
  v_target regprocedure;
  v_definition text;
  v_rewritten text;
  v_old text;
  v_new text;
  v_count integer;
begin
  v_target := to_regprocedure(
    'public.get_payment_request_execution_context_pre_037(uuid)'
  );
  if v_target is null then
    raise exception 'prod_company_role_rpc_missing: get_payment_request_execution_context_pre_037';
  end if;
  v_definition := pg_get_functiondef(v_target);
  v_old := 'v_is_finance := public.current_user_has_role(public.flux_finance_roles());';
  v_count := (
    char_length(v_definition) - char_length(replace(v_definition, v_old, ''))
  ) / char_length(v_old);
  if v_count <> 1 then
    raise exception 'prod_execution_context_finance_drift: expected 1, found %', v_count;
  end if;
  v_rewritten := replace(v_definition, v_old, 'v_is_finance := false;');

  v_old := 'if not found then raise exception ''payment_request_not_found''; end if;';
  v_new := v_old || E'\\n  v_is_finance := private.current_profile_has_company_role(\\n    v_request.company_id,\\n    array[''finance'']::text[]\\n  );';
  v_count := (
    char_length(v_rewritten) - char_length(replace(v_rewritten, v_old, ''))
  ) / char_length(v_old);
  if v_count <> 1 then
    raise exception 'prod_execution_context_request_guard_drift: expected 1, found %', v_count;
  end if;
  execute replace(v_rewritten, v_old, v_new);

  v_target := to_regprocedure(
    'public.provider_intake_internal_access_allowed(uuid)'
  );
  if v_target is null then
    raise exception 'prod_company_role_rpc_missing: provider_intake_internal_access_allowed';
  end if;
  v_definition := pg_get_functiondef(v_target);
  v_old := 'public.current_user_has_role(public.flux_finance_roles())'
    || E'\\n        and (p_company_id is null or public.has_active_company_membership(v_profile_id, p_company_id))';
  v_new := 'private.current_profile_has_company_role(p_company_id, array[''finance'']::text[])';
  v_count := (
    char_length(v_definition) - char_length(replace(v_definition, v_old, ''))
  ) / char_length(v_old);
  if v_count <> 1 then
    raise exception 'prod_provider_intake_company_predicate_drift: expected 1, found %', v_count;
  end if;
  execute replace(v_definition, v_old, v_new);
end
$prod_legacy_rpc_cutover$;

-- Batch context is a cross-company directory. Access is true only when the`,
  'PROD legacy RPC cutover',
)

await mkdir(outputDir, { recursive: true })
await writeFile(wave1Output, wave1)
await writeFile(rpcOutput, rpc)

console.log(wave1Output)
console.log(rpcOutput)
