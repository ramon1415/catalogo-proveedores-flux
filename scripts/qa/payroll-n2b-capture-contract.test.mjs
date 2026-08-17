import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260817162934_payroll_n2b_capture_sessions.sql');
const capture = read('payroll_capture.js');
const parser = read('payroll_parser.js');
const html = read('solicitudes.html');
const requestTypeExtension = read('fase2_request_payment_method_extension.js');
const workflow = read('.github/workflows/payroll-n0-contract-tests.yml');
const fileTableDefinition = migration.match(
  /create table public\.payroll_capture_files \(([\s\S]*?)\n\);/i
)?.[1] || '';
const payrollHiddenFieldIds = capture.match(
  /const fieldIds = \[([\s\S]*?)\n\s*\];/
)?.[1] || '';
const storageSelectFunction = migration.match(
  /create function public\.payroll_capture_storage_select_allowed\(p_name text\)([\s\S]*?)\$\$;/i
)?.[1] || '';

test('migration adds only temporary payroll capture staging and preserves N0/N1 lifecycle', () => {
  assert.match(migration, /create table public\.payroll_capture_sessions/i);
  assert.match(migration, /create table public\.payroll_capture_files/i);
  assert.doesNotMatch(migration, /create\s+table\s+(?:public\.)?payroll_runs\b/i);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.payment_requests\b/i);
  assert.doesNotMatch(migration, /disable\s+trigger|drop\s+(?:constraint|trigger)/i);
  assert.match(migration, /validate constraint payment_requests_payroll_contract_check/i);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:approval_|payment_layout|notification_)/i);
});

test('staging mutations are RPC-only, Finance-only, forced-RLS and auditable without values', () => {
  for (const table of ['payroll_capture_sessions', 'payroll_capture_files']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}\\s+from public, anon, authenticated`, 'i'));
  }
  for (const rpc of [
    'save_payroll_capture_session',
    'reserve_payroll_capture_file',
    'confirm_payroll_capture_file',
    'get_payroll_capture_sessions'
  ]) {
    assert.match(migration, new RegExp(`create function public\\.${rpc}`, 'i'));
  }
  assert.ok((migration.match(/security definer/gi) || []).length >= 7);
  assert.ok((migration.match(/payroll_has_finance_pii_access\(\)/gi) || []).length >= 6);
  assert.match(migration, /grant execute on function public\.payroll_capture_channels_valid\(text\[\]\)\s+to service_role/i);
  assert.match(migration, /execute function public\.payroll_redacted_audit\(\)/i);
  assert.ok(fileTableDefinition);
  assert.doesNotMatch(fileTableDefinition, /original_filename|employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b|raw_parser|raw_payload/i);
});

test('private Storage uses an opaque reserved path, no XLSM, no update/delete and no upsert', () => {
  assert.match(migration, /v_session\.company_id::text, '\/',\s*v_session\.reserved_payment_request_id::text, '\/',\s*v_file_id::text/i);
  assert.match(migration, /create policy payroll_private_capture_finance_insert[\s\S]*for insert[\s\S]*payroll_capture_storage_insert_allowed/i);
  assert.match(migration, /create policy payroll_private_capture_finance_select[\s\S]*for select[\s\S]*payroll_capture_storage_select_allowed/i);
  assert.match(migration, /create policy payroll_private_capture_no_update[\s\S]*as restrictive[\s\S]*for update/i);
  assert.doesNotMatch(migration, /create policy payroll_private_capture[^;]+for delete/i);
  assert.doesNotMatch(migration, /xlsm|macroenabled/i);
  assert.match(capture, /upsert:\s*false/);
  assert.doesNotMatch(capture, /getPublicUrl|createSignedUrl|storage\.from\([^)]*\)\.remove/);
  assert.doesNotMatch(html, /accept="[^"]*\.xlsm/i);
});

test('capability matrix is fail-closed except for the certified SPEI parser', () => {
  assert.match(migration, /unsupported_pending_source_contract/);
  assert.match(migration, /pending_format_certification/);
  assert.match(migration, /supported_certified/);
  assert.match(migration, /pending_employee_breakdown_validation/);
  assert.match(migration, /bbva-simulator-pagos-interbancarios-128-v1/);
  assert.match(migration, /p_parser_version is distinct from 'payroll-normalized-v1'/);
  assert.match(migration, /parser_version is not distinct from 'payroll-normalized-v1'/);
  assert.match(migration, /client_parsed_unverified/);
  assert.match(migration, /browser_client_attested/);
  assert.match(migration, /p_expected_version integer/);
  assert.match(migration, /v_session\.version <> p_expected_version/);
  assert.match(migration, /channel is not distinct from 'spei'/);
  assert.match(migration, /account\.account_type::text = 'bank'/);
  assert.match(migration, /account\.currency = 'MXN'/);
  assert.match(parser, /summarizePayrollSpeiForCapture/);
  assert.match(parser, /MISSING_USER_FILE/);
  assert.match(parser, /FORMAT_NOT_CERTIFIED/);
  assert.match(parser, /PARSER_ERROR/);
  assert.match(parser, /TOTAL_MISMATCH/);
  assert.doesNotMatch(capture, /parsePayrollSameBank|parseCoverSheet|parsePayrollTokaXml\s*\(/);
});

test('Nómina has a dedicated Finance-only submit path and cannot enter approval/layout generation', () => {
  assert.match(requestTypeExtension, /\["nomina", "Nómina"\]/);
  assert.match(requestTypeExtension, /normalizeRequestType\(value\("requestType"\)\) === "nomina"\) return/);
  assert.match(capture, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(capture, /create_payment_request|decide_payment_request|create_payment_layout|approval_batch|notification_event/);
  assert.match(capture, /approval\.disabled = true/);
  assert.match(capture, /Validación completa — flujo de aprobación pendiente de habilitar/);
  assert.match(parser, /PAYROLL_N3_NOT_ENABLED/);
  assert.match(capture, /FINANCE_ROLES = \['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'\]/);
  assert.doesNotMatch(capture, /isAdminFinance/);
  assert.match(capture, /p_expected_version: state\.sessionVersion/);
});

test('payroll mode keeps shared concept and notes visible while hiding only field labels', () => {
  assert.ok(payrollHiddenFieldIds);
  assert.doesNotMatch(payrollHiddenFieldIds, /['"](?:description|notes)['"]/);
  assert.match(capture, /const target = control\.closest\('label'\);/);
  assert.doesNotMatch(capture, /control\.closest\('\.form-section'\)/);
  assert.match(capture, /descriptionSection\.querySelector\('h3'\)\.textContent = 'Concepto \/ descripci.n'/);
});

test('UI and persisted summaries avoid employee rows and sensitive banking output', () => {
  assert.match(capture, /La vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias/);
  assert.match(capture, /Cuenta enmascarada/);
  assert.doesNotMatch(capture, /localStorage|sessionStorage|console\.(?:log|debug|info|warn|error)/);
  assert.doesNotMatch(migration, /jsonb\s+(?:not\s+null\s+)?(?:default\s+[^,]+)?[,\n]/i);
  assert.doesNotMatch(migration, /storage_path[^\n]*jsonb|parser[^\n]*jsonb/i);
  assert.match(capture, /recordCount/);
  assert.match(capture, /totalAmountMinor/);
  assert.match(capture, /aria-label="Seleccionar TXT SPEI"/);
  assert.match(capture, /aria-describedby="payrollSpeiStatus"/);
  assert.ok(storageSelectFunction);
  assert.match(storageSelectFunction, /join public\.payroll_capture_sessions session on session\.id = file\.session_id/);
  assert.match(storageSelectFunction, /session\.expires_at > now\(\)/);
});

test('the protected workflow runs N2B syntax, model and migration/UI contracts', () => {
  assert.match(workflow, /payroll_capture\.js/);
  assert.match(workflow, /payroll_capture\.css/);
  assert.match(workflow, /payroll-n2b-\*\.test\.mjs/);
  assert.match(workflow, /20260817162934_payroll_n2b_capture_sessions\.sql/);
  assert.match(workflow, /node --check payroll_capture\.js/);
  assert.match(workflow, /payroll-n2b-capture-model\.test\.mjs/);
  assert.match(workflow, /payroll-n2b-capture-contract\.test\.mjs/);
});
